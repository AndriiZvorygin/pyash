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
import { getExchangeSentenceId } from "../../bridge/exchange.mjs";
import { resolveConfigBool, resolveConfigText } from "../../configure/env.mjs";

async function resolveInterpret() {
  const mod = await import("../../bridge/index.mjs");
  return mod.interpret;
}

async function callMindBackend({ backendName, payload }) {
  if (!backendName) return null;
  const interpret = await resolveInterpret();
  const response = await interpret({
    mood: "do",
    be: backendName,
    ob: { text: JSON.stringify(payload) }
  });
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

function recordMindAnswer({ mindName, dialogue, callPrompt, responseText, outputName }) {
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
  const dialogue = typeof sentence?.from?.text === "string"
    ? sentence.from.text
    : historyDialogueName({ callSentence: sentence, configSentence, targetName: mindName });
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

  // Prompt resolution: config accordingto (discourse) + call prompt/text
  const configPrompt = configSentence?.accordingto?.name ?? null;

  const callPrompt =
    sentence?.with?.text ??
    sentence?.ob?.text ??
    (sentence?.ob?.name && !sentence?.ob?.model ? sentence?.ob?.name : null) ??
    ob?.text ??
    (ob?.name && !ob?.model ? ob?.name : null);

  const toolMapName = sentence?.with?.name ?? null;
  const { tools, toolMap, toolBlock } = buildToolSchemas(toolMapName);

  const historyMessages = buildHistoryMessages(dialogue, { window: historyWindow });
  const backendName = resolveConfigText("mind backend", { rememberFn: remember }) ?? null;

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
    if (configPrompt) messages.push({ role: "system", content: configPrompt });
    if (toolBlock) messages.push({ role: "system", content: toolBlock });
    if (historyMessages.length) messages.push(...historyMessages);
    const userContent = [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
    messages.push({ role: "user", content: userContent });

    const interpret = await resolveInterpret();
    const maxToolTurns = 6;
    let turns = 0;
    let lastResponse = null;

    while (turns < maxToolTurns) {
      turns += 1;
      const requestPayload = { mode: "chat", model, messages, tools };
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
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
        lastResponse = await callMindBackend({ backendName, payload: requestPayload });
      }
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext(lastResponse) });

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
        const toolText = toolResult && typeof toolResult === "object" ? sentenceToPyash(toolResult) : String(toolResult ?? "");
        messages.push({ role: "tool", tool_name: toolName, content: toolText });
        appendLog(dialogue, { role: "tool", content: toolText });
      }
    }

    if (!responseText) {
      responseText = lastResponse?.message?.content ?? "";
    }
  } else {
    const promptParts = [];
    if (configPrompt) promptParts.push(configPrompt);
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
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
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
            writeStreamEnd(streamOutputPath);
            recordMindAnswer({ mindName, dialogue, callPrompt, responseText: finalText, outputName });
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
            writeStreamEnd(streamOutputPath);
            recordMindAnswer({ mindName, dialogue, callPrompt, responseText: streamedText.trim(), outputName });
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
      const requestPayload = { mode: "generate", model, prompt: fullPrompt.trim() };
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
      responseText = mockResponse;
    } else {
      const requestPayload = { mode: "generate", model, prompt: fullPrompt.trim() };
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
      if (!backendName) {
        throwErrorSentence({
          name: "mind backend missing",
          message: "mind backend missing for generate request",
          from: { name: "mind" },
          raw: { requestPayload }
        });
      }
      const backendResponse = await callMindBackend({ backendName, payload: requestPayload });
      responseText = backendResponse?.response ?? backendResponse?.message?.content ?? "";
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext(backendResponse ?? {}) });
    }
  }

  // Record turn so future calls have context
  const answerSentence = recordMindAnswer({ mindName, dialogue, callPrompt, responseText, outputName });
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
