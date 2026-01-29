// pyash/verbs/mind.mjs
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { remember, doRemember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { makeStream } from "../../library/runtimePrimitives.mjs";
import { appendLog, buildHistoryMessages, historyDialogueName, nextAnswerName, resetMindLogs as resetMindHistory } from "./history.mjs";
import { recordMindJson, resetMindDebugCounters, stripContext } from "./logging.mjs";
import { buildToolSchemas, buildToolSentence, toolListFromMap } from "./tooling.mjs";
import { mapSentenceToPyash } from "../exchange/json_map.mjs";
import { getExchangeSentenceId } from "../../bridge/exchange.mjs";
import { resolveConfigBool, resolveConfigText } from "../../configure/env.mjs";

async function resolveInterpret() {
  const mod = await import("../../bridge/index.mjs");
  return mod.interpret;
}

async function callMindBackend({ backendName, payload, debug }) {
  if (!backendName) return null;
  const interpret = await resolveInterpret();
  const response = await interpret({
    mood: "do",
    be: backendName,
    ob: { text: JSON.stringify(payload) }
  });
  if (debug) {
    const obText = response?.ob?.text;
    const valueText = response?.value?.text;
    const resultText = response?.result?.text ?? response?.result?.ob?.text;
    const summary = {
      label: "backend-raw",
      type: typeof response,
      keys: response && typeof response === "object" ? Object.keys(response) : [],
      obTextLength: typeof obText === "string" ? obText.length : null,
      valueTextLength: typeof valueText === "string" ? valueText.length : null,
      resultTextLength: typeof resultText === "string" ? resultText.length : null
    };
    // eslint-disable-next-line no-console
    console.error(`[mind debug] ${JSON.stringify(summary)}`);
  }
  const rawText =
    response?.ob?.text ??
    response?.value?.text ??
    response?.result?.text ??
    response?.result?.ob?.text ??
    response?.ob?.name ??
    "";
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return { response: rawText };
  }
}

async function callMindBackendStream({ backendName, payload }) {
  if (!backendName) return null;
  const interpret = await resolveInterpret();
  return interpret({
    mood: "do",
    be: backendName,
    ob: { text: JSON.stringify(payload) },
    vyah: { ve: { type: "name", values: ["stream"] } }
  });
}

function resolveStreamOutputPath(sentence, outputName) {
  const base = getExchangeSentenceId() || outputName || sentence?.su?.name || "mind-stream";
  const safeBase = String(base).replace(/[^A-Za-z0-9_.-]+/g, "-");
  return path.join("artifacts", "mind", `${safeBase}.stream.txt`);
}

function mapDefChainFromName(name, { rememberFn } = {}) {
  const visited = new Set();
  const defs = [];

  const visit = (mapName) => {
    if (!mapName || visited.has(mapName)) return;
    visited.add(mapName);
    const fact = rememberFn ? rememberFn(mapName) : null;
    if (!fact || (fact.be !== "json map" && fact.be !== "map" && fact.be !== "csv map")) return;
    const entries = fact?.ob?.map ?? {};
    for (const value of Object.values(entries)) {
      if (value?.name) visit(value.name);
      if (value?.ve?.type === "name") {
        for (const child of value.ve.values || []) {
          if (typeof child === "string") visit(child);
        }
      }
    }
    defs.push(fact);
  };

  visit(name);
  if (defs.length === 0) return "";
  return defs.map(mapSentenceToPyash).join("\n\n");
}

function writeStreamChunk(filePath, chunk) {
  const text = String(chunk ?? "");
  if (!text) return;
  fsSync.appendFileSync(filePath, `${JSON.stringify(text)}\n`, "utf8");
}

function writeStreamEnd(filePath) {
  fsSync.appendFileSync(filePath, "[PYA_STREAM_END]\n", "utf8");
}

function startStreamFile(filePath) {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, "", "utf8");
}

function startStreamTail({ filename, onLine, onEnd }) {
  let offset = 0;
  let pending = "";
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fsSync.statSync(filename);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fsSync.openSync(filename, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fsSync.readSync(fd, buffer, 0, buffer.length, offset);
    fsSync.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.length) continue;
      if (line.trim() === "[PYA_STREAM_END]") {
        if (onEnd) onEnd();
        return;
      }
      if (onLine) onLine(line);
    }
  }, 50);
  return () => clearInterval(interval);
}

function resolveStreamStdoutEnabled({ rememberFn } = {}) {
  const configured = resolveConfigBool("stream stdout", { rememberFn });
  if (configured !== undefined) return configured;
  return process?.stdout?.isTTY === true;
}

function appendSeriesEntries({ seriesName, callPrompt, responseText }) {
  if (!seriesName) return;
  const fact = remember(seriesName);
  if (!fact || fact.be !== "series" || !Array.isArray(fact.ob?.series)) return;
  const entries = [...fact.ob.series];
  if (callPrompt) {
    entries.push({
      mood: "ya",
      su: { name: "user" },
      ob: { text: callPrompt },
      be: "write"
    });
  }
  if (responseText !== undefined) {
    entries.push({
      mood: "ya",
      su: { name: "assistant" },
      ob: { text: responseText },
      be: "answer"
    });
  }
  doRemember({
    ...fact,
    ob: { series: entries }
  });
}

function recordMindAnswer({ mindName, dialogue, callPrompt, responseText, outputName, historySeriesName }) {
  const { count, name: answerName } = nextAnswerName(mindName, dialogue);
  if (callPrompt) {
    doRemember({
      mood: "ya",
      su: { name: `${mindName} ${dialogue} question ${count}` },
      be: "write",
      from: { name: "user" },
      ob: { text: callPrompt }
    });
    appendLog(dialogue, { role: "user", content: callPrompt });
  }
  const answerSentence = {
    mood: "ya",
    su: { name: answerName },
    be: "answer",
    from: { name: mindName },
    ob: { text: responseText }
  };
  doRemember(answerSentence);
  doRemember({
    ...answerSentence,
    su: { name: "result" }
  });
  if (outputName) {
    doRemember({
      ...answerSentence,
      su: { name: outputName }
    });
  }
  doRemember({
    mood: "ya",
    su: { name: `${mindName} ${dialogue} answer ${count}` },
    be: "answer",
    from: { name: mindName },
    ob: { text: responseText }
  });
  appendLog(dialogue, { role: "assistant", content: responseText });
  if (historySeriesName) {
    appendSeriesEntries({ seriesName: historySeriesName, callPrompt, responseText });
  }
  return answerSentence;
}

export async function mind_to_name_text(sentence, { inputs = [] } = {}) {
  const ob = sentence?.ob ?? {};
  const mindName = sentence?.for?.name ?? sentence?.to?.name ?? sentence?.su?.name ?? "mind";
  const outputName = sentence?.for?.name ? sentence?.to?.name : sentence?.totext?.name;
  const config = mindName ? remember(mindName) : null;
  const configSentence = config?.be === "mind" ? config : null;
  const vyahValues = Array.isArray(sentence?.vyah?.ve?.values)
    ? sentence.vyah.ve.values
    : (Array.isArray(configSentence?.vyah?.ve?.values) ? configSentence.vyah.ve.values : []);
  const aspect = getEffectiveVyahAspect(vyahValues, { verb: "mind", caseKey: "vyah" });
  const dialogue = historyDialogueName({ callSentence: sentence, configSentence, targetName: mindName });
  const historyWindow =
    sentence?.by?.num ??
    sentence?.by?.quantity?.num ??
    configSentence?.ob?.window?.num ??
    configSentence?.ob?.historyWindow?.num ??
    configSentence?.window ??
    configSentence?.historyWindow ??
    ob?.window?.num ??
    8;

  // Model resolution: explicit on call or from config via state (keyword "as")
  const explicitModel = sentence?.ob?.model ?? ob?.model ?? null;
  const configModel = configSentence?.as?.name ?? null;
  const model = explicitModel ?? configModel ?? "qwen3-vl:8b-instruct";

  // Prompt resolution: config/call fromtext (discourse source) + call prompt/text
  const configPromptValue = configSentence?.fromtext ?? null;
  const callPromptValue = sentence?.fromtext ?? null;

  const resolvePromptFromName = (name) => {
    if (!name) return null;
    const fact = remember(name);
    if (!fact?.ob) return null;
    if (fact.ob.text !== undefined) return String(fact.ob.text);
    if (fact.ob.num !== undefined) return String(fact.ob.num);
    if (fact.ob.boolean !== undefined) return fact.ob.boolean ? "truth" : "lie";
    if (fact.ob.hollow) return "null";
    if (fact.ob.genitive?.chain?.length) {
      let curr =
        typeof fact.ob.genitive.chain[0] === "string"
          ? remember(fact.ob.genitive.chain[0])
          : null;
      for (const part of fact.ob.genitive.chain.slice(1)) {
        if (curr && typeof curr === "object" && curr.name) {
          const nextFact = remember(curr.name);
          if (nextFact) curr = nextFact.ob ?? nextFact;
        }
        if (curr && typeof curr === "object") {
          if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
            curr = curr.ob.map[part];
          } else if (curr.ob && curr.ob[part] !== undefined) {
            curr = curr.ob[part];
          } else {
            curr = curr?.[part];
          }
        } else {
          curr = curr?.[part];
        }
      }
      if (typeof curr === "string") return curr;
      if (typeof curr === "number") return String(curr);
      if (curr && typeof curr === "object") {
        if (curr.text !== undefined) return String(curr.text);
        if (curr.num !== undefined) return String(curr.num);
        if (curr.boolean !== undefined) return curr.boolean ? "truth" : "lie";
      }
    }
    return null;
  };
  const resolvePromptValue = (value) => {
    if (!value) return null;
    if (typeof value?.text === "string") return value.text;
    if (value?.name) return resolvePromptFromName(value.name) ?? value.name;
    return null;
  };
  const obNamePrompt = sentence?.ob?.name && !sentence?.ob?.model
    ? (resolvePromptFromName(sentence.ob.name) ?? sentence.ob.name)
    : null;
  const inlineObNamePrompt = ob?.name && !ob?.model
    ? (resolvePromptFromName(ob.name) ?? ob.name)
    : null;
  const callPrompt =
    sentence?.with?.text ??
    sentence?.ob?.text ??
    obNamePrompt ??
    ob?.text ??
    inlineObNamePrompt;
  const resolvedConfigPrompt = resolvePromptValue(callPromptValue) ?? resolvePromptValue(configPromptValue);

  const toolMapName = sentence?.with?.name ?? null;
  const { tools, toolMap, toolBlock } = buildToolSchemas(toolMapName);

  const historySeriesName =
    sentence?.accordingto?.name ??
    sentence?.accordingto?.text ??
    configSentence?.accordingto?.name ??
    configSentence?.accordingto?.text ??
    null;
  let historyMessages = [];
  if (historySeriesName) {
    const historyFact = remember(historySeriesName);
    if (!historyFact || historyFact.be !== "series" || !Array.isArray(historyFact.ob?.series)) {
      throwErrorSentence({
        name: "series defective",
        message: `series history missing: ${historySeriesName}`,
        from: { name: "mind" },
        raw: { historySeriesName }
      });
    }
    historyMessages = historyFact.ob.series
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const role = entry?.role ?? entry?.su?.name ?? entry?.su?.text ?? entry?.from?.name ?? null;
        const content =
          entry?.content ??
          entry?.ob?.text ??
          (typeof entry?.ob?.num === "number" ? String(entry.ob.num) : null);
        if (!role || content == null) return null;
        return { role: String(role).toLowerCase(), content: String(content) };
      })
      .filter(Boolean);
    if (historyWindow > 0) {
      const max = historyWindow * 2;
      historyMessages = historyMessages.slice(-max);
    }
  } else {
    historyMessages = buildHistoryMessages(dialogue, { window: historyWindow });
  }
  const backendName = resolveConfigText("mind backend", { rememberFn: remember }) ?? null;
  const ollamaHost = resolveConfigText("ollama host", { rememberFn: remember }) ?? null;
  const mindDebug = resolveConfigBool("mind debug", { rememberFn: remember }) === true;

  const debugMind = (label, payload) => {
    if (!mindDebug) return;
    const mode = payload?.mode ?? "generate";
    const host = payload?.host ?? "(unset)";
    const endpoint = typeof payload?.host === "string"
      ? `${payload.host.replace(/\/$/, "")}/api/${mode === "chat" ? "chat" : "generate"}`
      : "(unset)";
    const summary = {
      label,
      mode,
      model: payload?.model ?? null,
      stream: !!payload?.stream,
      host,
      endpoint
    };
    // eslint-disable-next-line no-console
    console.error(`[mind debug] ${JSON.stringify(summary)}`);
  };

  // Combine upstream inputs into a context string
  let inputText = "";
  for (const inp of inputs) {
    if (typeof inp === "string") {
      inputText += inp + "\n";
    } else if (inp?.text) {
      inputText += inp.text + "\n";
    } else if (inp != null) {
      inputText += JSON.stringify(inp) + "\n";
    }
  }

  let responseText = "";
  if (toolMapName) {
    if (aspect === "stream") {
      throwErrorSentence({
        name: "mind aspect invalid",
        message: "mind stream is not supported with tools",
        from: { name: "mind" },
        raw: { aspect }
      });
    }
    const mockResponseRaw = resolveConfigText("mind response", { rememberFn: remember });
    let mockResponseQueue = null;
    if (mockResponseRaw) {
      try {
        const parsed = JSON.parse(mockResponseRaw);
        if (Array.isArray(parsed)) mockResponseQueue = parsed;
      } catch {
        // ignore; handled below as a raw string
      }
    }
    let mockIndex = 0;
    const nextMockResponse = () => {
      if (!mockResponseRaw) return null;
      if (mockResponseQueue && mockResponseQueue.length > 0) {
        const idx = Math.min(mockIndex, mockResponseQueue.length - 1);
        mockIndex += 1;
        return mockResponseQueue[idx];
      }
      return mockResponseRaw;
    };
    const messages = [];
    if (resolvedConfigPrompt) messages.push({ role: "system", content: resolvedConfigPrompt });
    if (toolBlock) messages.push({ role: "system", content: toolBlock });
    if (historyMessages.length) messages.push(...historyMessages);
    const userContent = [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
    messages.push({ role: "user", content: userContent });

    const interpret = await resolveInterpret();
    const maxToolTurns = 6;
    let turns = 0;
    let lastResponse = null;
    let lastToolText = "";

    while (turns < maxToolTurns) {
      turns += 1;
      const requestPayload = { mode: "chat", model, messages, tools, stream: false };
      if (ollamaHost) requestPayload.host = ollamaHost;
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
      debugMind("request", requestPayload);
      const mockResponse = nextMockResponse();
      if (mockResponse) {
        if (typeof mockResponse === "string") {
          try {
            lastResponse = JSON.parse(mockResponse);
          } catch {
            lastResponse = { message: { content: mockResponse } };
          }
        } else {
          lastResponse = mockResponse;
        }
      } else {
        if (!backendName) {
          throwErrorSentence({
            name: "mind backend missing",
            message: "mind backend missing for chat/tooling request",
            from: { name: "mind" },
            raw: { requestPayload }
          });
        }
        lastResponse = await callMindBackend({ backendName, payload: requestPayload, debug: mindDebug });
      }
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext(lastResponse) });
      if (mindDebug) {
        // eslint-disable-next-line no-console
        console.error(`[mind debug] ${JSON.stringify({ label: "response", hasToolCalls: Array.isArray(lastResponse?.message?.tool_calls), contentLength: (lastResponse?.message?.content ?? "").length })}`);
      }

      const toolCalls = lastResponse?.message?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        responseText = lastResponse?.message?.content ?? "";
        break;
      }

      const assistantMessage = {
        role: "assistant",
        content: lastResponse?.message?.content ?? "",
        tool_calls: toolCalls
      };
      messages.push(assistantMessage);
      appendLog(dialogue, { role: "assistant", content: assistantMessage.content });

      for (const call of toolCalls) {
        const toolName = call?.function?.name ?? call?.name;
        const toolCallId = call?.id ?? null;
        if (!toolName || !toolMap.has(toolName)) {
          throwErrorSentence({
            name: "tool defective",
            message: `unknown tool: ${toolName}`,
            from: { name: "mind" },
            raw: call
          });
        }
        const capability = toolMap.get(toolName);
        const toolSentence = buildToolSentence({
          capability,
          args: call?.function?.arguments ?? call?.arguments
        });
        const toolResult = await interpret(toolSentence);
        const surfacedTool = (toolResult && toolResult.mood)
          ? toolResult
          : remember("result");
        let toolText = "";
        if (surfacedTool && typeof surfacedTool === "object") {
          const mapName = surfacedTool.ob?.name;
          const mapFact = mapName ? remember(mapName) : null;
          if (mapFact && (mapFact.be === "json map" || mapFact.be === "map" || mapFact.be === "csv map")) {
            toolText = mapDefChainFromName(mapName, { rememberFn: remember });
          } else if (surfacedTool.be === "interpret" && typeof surfacedTool.ob?.text === "string") {
            const rawText = surfacedTool.ob.text;
            const match = rawText.match(/^quoted\.([^.]+)\.([\s\S]*?)\.\1\.quoted$/);
            toolText = match ? match[2] : rawText;
          } else {
            toolText = sentenceToPyash(surfacedTool);
          }
        } else {
          toolText = String(surfacedTool ?? "");
        }
        const toolMessage = { role: "tool", content: toolText };
        if (toolCallId) toolMessage.tool_call_id = toolCallId;
        toolMessage.tool_name = toolName;
        messages.push(toolMessage);
        appendLog(dialogue, { role: "tool", content: toolText });
        lastToolText = toolText;
      }
    }

    if (!responseText) {
      responseText = lastResponse?.message?.content ?? "";
    }
    if (!responseText && lastToolText) {
      responseText = lastToolText;
    }
    if (responseText === "DID_NOT_RECEIVE_TOOL_RESULT" && lastToolText) {
      responseText = lastToolText;
    }
    if (mindDebug && !responseText) {
      // eslint-disable-next-line no-console
      console.error(`[mind debug] ${JSON.stringify({ label: "empty-response", lastResponse: stripContext(lastResponse ?? {}) })}`);
    }
  } else {
    const promptParts = [];
    if (resolvedConfigPrompt) promptParts.push(resolvedConfigPrompt);
    const toolList = toolListFromMap(toolMapName);
    if (toolList) promptParts.push(toolList);
    if (historyMessages.length) {
      const histText = historyMessages
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
      promptParts.push(histText);
    }
    if (callPrompt) promptParts.push(callPrompt);
    const fullPrompt = promptParts.filter(Boolean).join("\n\n") + (inputText ? "\n\n" + inputText : "");
    const mockResponse = resolveConfigText("mind response", { rememberFn: remember });
    if (aspect === "stream") {
      const streamOutputPath = resolveStreamOutputPath(sentence, outputName);
      startStreamFile(streamOutputPath);
      const streamStdoutEnabled = resolveStreamStdoutEnabled({ rememberFn: remember });
      const requestPayload = { mode: "generate", model, prompt: fullPrompt.trim(), stream: true };
      if (ollamaHost) requestPayload.host = ollamaHost;
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
      debugMind("request", requestPayload);
      (async () => {
        let streamedText = "";
        try {
          if (mockResponse) {
            const chunks = String(mockResponse ?? "")
              .split(/\s+/)
              .filter(Boolean)
              .map(word => `${word} `);
            for (const chunk of chunks) {
              streamedText += chunk;
              writeStreamChunk(streamOutputPath, chunk);
              if (streamStdoutEnabled) {
                process.stdout.write(chunk);
              }
            }
            const finalText = String(mockResponse ?? "").trim();
            recordMindJson({ targetName: mindName, label: "response", payload: stripContext({ response: finalText, chunks }) });
            if (mindDebug) {
              // eslint-disable-next-line no-console
              console.error(`[mind debug] ${JSON.stringify({ label: "response", contentLength: finalText.length })}`);
            }
            writeStreamEnd(streamOutputPath);
            recordMindAnswer({ mindName, dialogue, callPrompt, responseText: finalText, outputName, historySeriesName });
          } else if (backendName) {
            const backendStream = await callMindBackendStream({ backendName, payload: requestPayload });
            const backendPath =
              backendStream?.ob?.filename ??
              backendStream?.result?.ob?.filename ??
              backendStream?.result?.filename ??
              null;
            if (!backendPath) {
              throw new Error("mind backend stream missing filename");
            }
            await new Promise((resolve) => {
              const stop = startStreamTail({
                filename: backendPath,
                onLine: (line) => {
                  try {
                    const chunk = JSON.parse(line);
                    const textChunk = String(chunk ?? "");
                    streamedText += textChunk;
                    writeStreamChunk(streamOutputPath, textChunk);
                    if (streamStdoutEnabled) process.stdout.write(textChunk);
                  } catch {
                    // ignore malformed chunk lines
                  }
                },
                onEnd: () => {
                  stop();
                  resolve();
                }
              });
            });
            recordMindJson({ targetName: mindName, label: "response", payload: stripContext({ response: streamedText }) });
            if (mindDebug) {
              // eslint-disable-next-line no-console
              console.error(`[mind debug] ${JSON.stringify({ label: "response", contentLength: streamedText.length })}`);
            }
            writeStreamEnd(streamOutputPath);
            recordMindAnswer({ mindName, dialogue, callPrompt, responseText: streamedText.trim(), outputName, historySeriesName });
          } else {
            throwErrorSentence({
              name: "mind backend missing",
              message: "mind backend missing for stream request",
              from: { name: "mind" },
              raw: { requestPayload }
            });
          }
        } catch (err) {
          writeStreamEnd(streamOutputPath);
          throwErrorSentence({
            name: "mind defective",
            message: `mind defective: ${err?.message ?? "stream failed"}`,
            from: { name: "mind" },
            raw: { error: err?.message ?? String(err ?? "") }
          });
        }
      })();
      return makeStream({
        name: outputName ?? sentence?.su?.name ?? `${mindName ?? "mind"} stream`,
        state: "open",
        ob: { filename: streamOutputPath, index: 0, kind: "mind", backend: "ollama" }
      });
    } else if (mockResponse) {
      const requestPayload = { mode: "generate", model, prompt: fullPrompt.trim(), stream: false };
      if (ollamaHost) requestPayload.host = ollamaHost;
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
      debugMind("request", requestPayload);
      responseText = mockResponse;
    } else {
      const requestPayload = { mode: "generate", model, prompt: fullPrompt.trim(), stream: false };
      if (ollamaHost) requestPayload.host = ollamaHost;
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
      debugMind("request", requestPayload);
      if (!backendName) {
        throwErrorSentence({
          name: "mind backend missing",
          message: "mind backend missing for generate request",
          from: { name: "mind" },
          raw: { requestPayload }
        });
      }
      const backendResponse = await callMindBackend({ backendName, payload: requestPayload, debug: mindDebug });
      responseText = backendResponse?.response ?? backendResponse?.message?.content ?? "";
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext(backendResponse ?? {}) });
      if (mindDebug) {
        // eslint-disable-next-line no-console
        console.error(`[mind debug] ${JSON.stringify({ label: "response", contentLength: responseText.length })}`);
        if (!responseText) {
          // eslint-disable-next-line no-console
          console.error(`[mind debug] ${JSON.stringify({ label: "empty-response", backendResponse: stripContext(backendResponse ?? {}) })}`);
        }
      }
      if (!responseText) {
        throwErrorSentence({
          name: "mind hollow answer",
          message: "mind hollow answer from backend",
          from: { name: "mind" },
          raw: { requestPayload, backendResponse: stripContext(backendResponse ?? {}) }
        });
      }
    }
  }

  // Record turn so future calls have context
  const answerSentence = recordMindAnswer({ mindName, dialogue, callPrompt, responseText, outputName, historySeriesName });
  return answerSentence;
}

export default mind_to_name_text;

export { buildHistoryMessages };
export function resetMindLogs() {
  resetMindHistory();
  resetMindDebugCounters();
}

export const signatures = [
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  // Type-style target: write ... to name mind
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  // New preferred form: for name <mind> to name <output>
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "by", "num", "for", "name", "mind", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "by", "num", "for", "name", "mind", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "by", "num", "for", "name", "mind", "ob", "text", "to", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "by", "num", "for", "name", "mind", "ob", "name", "text", "to", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  // Legacy compatibility: to name <mind> totext name <output>
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "vyah", "stream", "with", "name", "map"], handler: mind_to_name_text }
];
