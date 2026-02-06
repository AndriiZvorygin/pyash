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
    const role = String(msg.role ?? "assistant").toUpperCase();
    const content = msg.content ?? "";
    lines.push(`${role}: ${content}`);
  }
  return lines.join("\n");
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
  mindDebug,
  debugMind,
  outputName,
  historySeriesName,
  aspect,
  inputText
} = {}) {
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
  if (userContent) messages.push({ role: "user", content: userContent });
  const mockResponse = resolveConfigText("mind response", { rememberFn: remember });

  if (aspect === "stream") {
    const streamOutputPath = resolveStreamOutputPath(sentence, outputName);
    startStreamFile(streamOutputPath);
    const streamStdoutEnabled = resolveStreamStdoutEnabled({ rememberFn: remember });
    const requestPayload = { mode: "chat", model, messages, stream: true };
    requestPayload.prompt = buildPromptText(messages);
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
    return {
      stream: makeStream({
        name: outputName ?? sentence?.su?.name ?? `${mindName ?? "mind"} stream`,
        state: "open",
        ob: { filename: streamOutputPath, index: 0, kind: "mind", backend: "ollama" }
      })
    };
  }

  let responseText = "";
  if (mockResponse) {
    const requestPayload = { mode: "chat", model, messages, stream: false };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
    debugMind("request", requestPayload);
    responseText = mockResponse;
  } else {
    const requestPayload = { mode: "chat", model, messages, stream: false };
    requestPayload.prompt = buildPromptText(messages);
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

  return { responseText };
}
