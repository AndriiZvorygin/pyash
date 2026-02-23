import { resolveStreamOutputPath, writeStreamChunk, writeStreamEnd, startStreamFile, startStreamTail, resolveStreamStdoutEnabled } from "./stream.mjs";
import { recordMindJson, stripContext } from "./logging.mjs";
import { callMindBackend, callMindBackendStream } from "./backend.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { makeStream } from "../../library/runtimePrimitives.mjs";
import { toolListFromMap } from "./tooling.mjs";
import { recordMindAnswer } from "./series.mjs";
import { resolveConfigText } from "../../configure/env.mjs";
import { remember } from "../../remember/index.mjs";

function buildPromptText(messages) {
  if (!Array.isArray(messages)) return "";
  const lines = [];
  for (const msg of messages) {
    if (!msg) continue;
    const roleRaw = String(msg.role ?? "assistant").toLowerCase();
    const role = roleRaw === "assistant" ? "AGENT" : roleRaw.toUpperCase();
    const content = msg.content ?? "";
    lines.push(`${role}: ${content}`);
  }
  return lines.join("\n");
}

function modelLooksVisionCapable(model) {
  const text = String(model ?? "").toLowerCase().trim();
  if (!text) return false;
  return /(vl|vision|llava|minicpm-v|moondream|internvl|qvq)/.test(text);
}

function normalizeVisionInput(input) {
  if (!input || typeof input !== "object") return null;
  const kind = String(input?.kind ?? "").toLowerCase().trim();
  if (kind && kind !== "image") return null;
  const filename = String(input?.filename ?? "").trim();
  if (!filename) return null;
  return {
    filename,
    mimeType: String(input?.mimeType ?? "").trim()
  };
}

export async function runGenerate({
  sentence,
  ob,
  mindName,
  model,
  dialogue,
  historyMessages,
  callPrompt,
  resolvedConfigPrompt,
  toolMapName,
  backendName,
  ollamaHost,
  reasoningEffort,
  modelTuning,
  mindDebug,
  debugMind,
  outputName,
  historySeriesName,
  aspect,
  inputText,
  inputs = [],
  checkInterrupted
} = {}) {
  const applySampling = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const tuning = modelTuning && typeof modelTuning === "object" ? modelTuning : {};
    if (Number.isFinite(Number(tuning.temperature))) payload.temperature = Number(tuning.temperature);
    if (Number.isFinite(Number(tuning.topP))) payload.topP = Number(tuning.topP);
    if (Number.isFinite(Number(tuning.topK))) payload.topK = Number(tuning.topK);
    if (Number.isFinite(Number(tuning.minP))) payload.minP = Number(tuning.minP);
    if (Number.isFinite(Number(tuning.presencePenalty))) payload.presencePenalty = Number(tuning.presencePenalty);
    if (typeof tuning.think === "boolean") payload.think = tuning.think;
  };
  const visionInputs = Array.isArray(inputs) ? inputs.map(normalizeVisionInput).filter(Boolean) : [];
  const messages = [];
  const toolList = toolListFromMap(toolMapName);
  const systemParts = [];
  if (resolvedConfigPrompt) systemParts.push(resolvedConfigPrompt);
  if (toolList) systemParts.push(toolList);
  if (systemParts.length) {
    messages.push({ role: "system", content: systemParts.join("\n\n") });
  }
  if (historyMessages.length) messages.push(...historyMessages);
  const userContent = [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
  if (userContent || visionInputs.length) {
    const userMessage = { role: "user", content: userContent };
    if (visionInputs.length && modelLooksVisionCapable(model)) {
      userMessage.imageFiles = visionInputs.map(item => ({
        filename: item.filename,
        mimeType: item.mimeType
      }));
    }
    messages.push(userMessage);
  }
  const mockResponse = resolveConfigText("mind response", { rememberFn: remember });

  if (aspect === "stream") {
    if (typeof checkInterrupted === "function") {
      await checkInterrupted();
    }
    const streamOutputPath = resolveStreamOutputPath(sentence, outputName);
    startStreamFile(streamOutputPath);
    const streamStdoutEnabled = resolveStreamStdoutEnabled({ rememberFn: remember });
    const requestPayload = { mode: "chat", model, messages, stream: true };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
    applySampling(requestPayload);
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
    return {
      stream: makeStream({
        name: outputName ?? sentence?.su?.name ?? `${mindName ?? "mind"} stream`,
        state: "open",
        ob: { filename: streamOutputPath, index: 0, kind: "mind", backend: "ollama" }
      })
    };
  }

  let responseText = "";
  if (typeof checkInterrupted === "function") {
    await checkInterrupted();
  }
  if (mockResponse) {
    const requestPayload = { mode: "chat", model, messages, stream: false };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
    applySampling(requestPayload);
    recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
    debugMind("request", requestPayload);
    responseText = mockResponse;
  } else {
    const requestPayload = { mode: "chat", model, messages, stream: false };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
    applySampling(requestPayload);
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
    if (typeof checkInterrupted === "function") {
      await checkInterrupted();
    }
    let backendResponse = null;
    let attempts = 0;
    while (attempts < 2) {
      attempts += 1;
      backendResponse = await callMindBackend({ backendName, payload: requestPayload, debug: mindDebug });
      responseText = backendResponse?.response ?? backendResponse?.message?.content ?? "";
      if (responseText) break;
      if (attempts < 2) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    recordMindJson({ targetName: mindName, label: "response", payload: stripContext(backendResponse ?? {}) });
    if (mindDebug) {
      // eslint-disable-next-line no-console
      console.error(`[mind debug] ${JSON.stringify({ label: "response", contentLength: responseText.length, attempts })}`);
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

  return { responseText };
}
