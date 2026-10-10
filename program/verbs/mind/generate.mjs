import { resolveStreamOutputPath, writeStreamChunk, writeStreamTerminal, writeStreamEnd, startStreamFile, startStreamTail, resolveStreamStdoutEnabled } from "./stream.mjs";
import { recordMindJson, recordMindReply, stripContext } from "./logging.mjs";
import { callMindBackend, callMindBackendStream } from "./backend.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { makeStream } from "../../library/runtimePrimitives.mjs";
import { toolListFromMap } from "./tooling.mjs";
import { recordMindAnswer } from "./series.mjs";
import { resolveConfigNum, resolveConfigText } from "../../configure/env.mjs";
import { remember } from "../../remember/index.mjs";
import { normalizeMindReply, requireMindReplyText, mergeMindReplyChunks, errorReplyEnvelope } from "./reply.mjs";
import { buildErrorSentence } from "../../error.mjs";
import { doRemember } from "../../remember/index.mjs";

let mockResponseQueueRaw = null;
let mockResponseQueue = null;
let mockResponseQueueIndex = 0;

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

function isLoadingModelError(text) {
  const lower = String(text ?? "").toLowerCase();
  return lower.includes("llm server loading model")
    || lower.includes("loading model");
}

function nextMockGenerateResponse(mockResponseRaw) {
  if (!mockResponseRaw) return null;
  if (mockResponseRaw !== mockResponseQueueRaw) {
    mockResponseQueueRaw = mockResponseRaw;
    mockResponseQueue = null;
    mockResponseQueueIndex = 0;
    try {
      const parsed = JSON.parse(mockResponseRaw);
      if (Array.isArray(parsed)) {
        mockResponseQueue = parsed;
      }
    } catch {
      // Use the raw string when it is not a JSON array fixture.
    }
  }
  if (Array.isArray(mockResponseQueue) && mockResponseQueue.length > 0) {
    const idx = Math.min(mockResponseQueueIndex, mockResponseQueue.length - 1);
    mockResponseQueueIndex += 1;
    return mockResponseQueue[idx];
  }
  return mockResponseRaw;
}

function extractMockResponseText(mockResponse) {
  if (mockResponse == null) return "";
  if (typeof mockResponse === "string") return String(mockResponse);
  return normalizeMindReply(mockResponse).text;
}

function isLoadingBackendResponse(backendResponse, backendErrorText) {
  if (isLoadingModelError(backendErrorText)) return true;
  const doneReason = String(backendResponse?.done_reason ?? "").toLowerCase().trim();
  return doneReason === "load" || doneReason === "loading";
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
    if (Number.isFinite(Number(tuning.numPredict))) {
      payload.options = {
        ...(payload.options && typeof payload.options === "object" ? payload.options : {}),
        num_predict: Number(tuning.numPredict)
      };
    }
    if (typeof tuning.think === "boolean") payload.think = tuning.think;
  };
  const applyKeepAlive = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const configured = resolveConfigNum("mind keep alive", { rememberFn: remember });
    const keepAlive = Number.isFinite(Number(configured)) ? Math.max(0, Math.trunc(Number(configured))) : 300;
    payload.keep_alive = keepAlive;
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
  const mockResponseRaw = resolveConfigText("mind response", { rememberFn: remember });

  if (aspect === "stream") {
    if (typeof checkInterrupted === "function") {
      await checkInterrupted();
    }
    const streamOutputPath = resolveStreamOutputPath(sentence, outputName);
    const streamName = outputName ?? sentence?.su?.name ?? `${mindName ?? "mind"} stream`;
    startStreamFile(streamOutputPath);
    const streamStdoutEnabled = resolveStreamStdoutEnabled({ rememberFn: remember });
    const requestPayload = { mode: "chat", model, messages, stream: true };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
    applyKeepAlive(requestPayload);
    applySampling(requestPayload);
    recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
    debugMind("request", requestPayload);
    const recordStreamAnswer = (envelope) => {
      const prior = remember(streamName);
      const index = prior?.be === "stream" ? (prior.ob?.index ?? 0) : 0;
      recordMindAnswer({ mindName, dialogue, callPrompt, envelope, outputName, historySeriesName });
      doRemember(makeStream({
        name: streamName,
        state: "done",
        ob: { filename: streamOutputPath, index, kind: "mind", backend: "ollama", terminal: envelope }
      }));
    };
    let signalFirstRecord;
    const firstRecord = new Promise((resolve) => {
      signalFirstRecord = resolve;
    });
    (async () => {
      const streamedChunks = [];
      let terminalPayload = null;
      try {
        const mockResponse = nextMockGenerateResponse(mockResponseRaw);
        if (mockResponse) {
          const mockEnvelope = normalizeMindReply(mockResponse);
          const finalText = mockEnvelope.text;
          const chunks = String(finalText ?? "")
            .split(/\s+/)
            .filter(Boolean)
            .map(word => `${word} `);
          for (const chunk of chunks) {
            streamedChunks.push(chunk);
            writeStreamChunk(streamOutputPath, chunk);
            signalFirstRecord?.();
            if (streamStdoutEnabled) {
              process.stdout.write(chunk);
            }
          }
          terminalPayload = { ...mockEnvelope, response: finalText, done: true };
          const envelope = requireMindReplyText(mergeMindReplyChunks(streamedChunks, terminalPayload));
          recordMindReply({ targetName: mindName, envelope });
          if (mindDebug) {
            // eslint-disable-next-line no-console
            console.error(`[mind debug] ${JSON.stringify({ label: "response", contentLength: finalText.length })}`);
          }
          recordStreamAnswer(envelope);
          writeStreamTerminal(streamOutputPath, { envelope });
          writeStreamEnd(streamOutputPath);
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
          await new Promise((resolve, reject) => {
            const stop = startStreamTail({
              filename: backendPath,
              onLine: (line) => {
                const chunk = JSON.parse(line);
                if (chunk?.type === "terminal") {
                  if (chunk.ok === false) throw new Error(chunk.error?.message ?? "mind stream failed");
                  terminalPayload = chunk.envelope ?? {};
                  return;
                }
                const textChunk = chunk?.type === "chunk" ? chunk.text : chunk;
                if (typeof textChunk !== "string") throw new Error("mind stream malformed chunk");
                streamedChunks.push(textChunk);
                writeStreamChunk(streamOutputPath, textChunk);
                signalFirstRecord?.();
                if (streamStdoutEnabled) process.stdout.write(textChunk);
              },
              onEnd: () => {
                stop();
                resolve();
              },
              onError: (err) => {
                stop();
                reject(err);
              }
            });
          });
          if (!terminalPayload) throw new Error("mind stream missing terminal reply");
          const envelope = requireMindReplyText(mergeMindReplyChunks(streamedChunks, terminalPayload));
          recordMindReply({ targetName: mindName, envelope });
          if (mindDebug) {
            // eslint-disable-next-line no-console
            console.error(`[mind debug] ${JSON.stringify({ label: "response", contentLength: envelope.text.length })}`);
          }
          recordStreamAnswer(envelope);
          writeStreamTerminal(streamOutputPath, { envelope });
          writeStreamEnd(streamOutputPath);
          signalFirstRecord?.();
        } else {
          throwErrorSentence({
            name: "mind backend missing",
            message: "mind backend missing for stream request",
            from: { name: "mind" },
            raw: { requestPayload }
          });
        }
      } catch (err) {
        const errorEnvelope = errorReplyEnvelope(err);
        writeStreamTerminal(streamOutputPath, { error: errorEnvelope.error });
        writeStreamEnd(streamOutputPath);
        signalFirstRecord?.();
        const hollow = err?.code === "MIND_HOLLOW_ANSWER";
        const errorName = hollow ? "mind hollow answer" : "mind defective";
        const errorMessage = hollow
          ? "mind hollow answer from backend"
          : `mind defective: ${err?.message ?? "stream failed"}`;
        doRemember(buildErrorSentence({
          name: errorName,
          message: errorMessage,
          from: { name: "mind" },
          raw: { error: err?.message ?? String(err ?? "") }
        }));
      }
    })();
    await firstRecord;
    return {
      stream: makeStream({
        name: streamName,
        state: "open",
        ob: { filename: streamOutputPath, index: 0, kind: "mind", backend: "ollama" }
      })
    };
  }

  let responseText = "";
  let reply = null;
  if (typeof checkInterrupted === "function") {
    await checkInterrupted();
  }
  const mockResponse = nextMockGenerateResponse(mockResponseRaw);
  if (mockResponse) {
    const requestPayload = { mode: "chat", model, messages, stream: false };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
    applyKeepAlive(requestPayload);
    applySampling(requestPayload);
    recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
    debugMind("request", requestPayload);
    reply = normalizeMindReply(mockResponse);
    responseText = reply.text;
  } else {
    const requestPayload = { mode: "chat", model, messages, stream: false };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
    applyKeepAlive(requestPayload);
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
    let backendErrorText = "";
    let attempts = 0;
    // Retry once when the backend reports a model-loading style empty response.
    const maxAttempts = 2;
    while (attempts < maxAttempts) {
      attempts += 1;
      backendResponse = await callMindBackend({ backendName, payload: requestPayload, debug: mindDebug });
      backendErrorText = String(backendResponse?.error ?? "").trim();
      responseText = normalizeMindReply(backendResponse).text;
      if (responseText) break;
      const loadingModel = isLoadingBackendResponse(backendResponse, backendErrorText);
      if (attempts >= maxAttempts) break;
      if (!loadingModel) break;
      const waitMs = loadingModel ? Math.min(4000, 500 * attempts) : 250;
      await new Promise(resolve => setTimeout(resolve, waitMs));
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
    reply = normalizeMindReply(backendResponse ?? {});
    responseText = reply.text;
    if (!responseText) {
      if (backendErrorText) {
        throwErrorSentence({
          name: "mind defective",
          message: `mind defective: ${backendErrorText}`,
          from: { name: "mind" },
          raw: { requestPayload, backendResponse: stripContext(backendResponse ?? {}) }
        });
      }
      throwErrorSentence({
        name: "mind hollow answer",
        message: "mind hollow answer from backend",
        from: { name: "mind" },
        raw: { requestPayload, backendResponse: stripContext(backendResponse ?? {}) }
      });
    }
  }

  return { responseText, reply: reply ?? normalizeMindReply({ response: responseText }) };
}
