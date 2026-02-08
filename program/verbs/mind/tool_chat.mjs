import { remember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { throwErrorSentence, surfaceErrorSentence } from "../../error.mjs";
import { resolveInterpret, callMindBackend } from "./backend.mjs";
import { mapDefChainFromName } from "./map_helpers.mjs";
import { mapSentenceToPyash } from "../exchange/json_map.mjs";
import { recordMindJson, stripContext } from "./logging.mjs";
import { appendLog } from "./history.mjs";
import { buildToolSentence } from "./tooling.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../../bridge/signature.mjs";
import { resolveRatifyDecision } from "../../agent/ratify_policy.mjs";

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

export async function runToolChat({
  sentence,
  ob,
  mindName,
  model,
  dialogue,
  callPrompt,
  resolvedConfigPrompt,
  historyMessages,
  toolMap,
  tools,
  toolBlock,
  backendName,
  ollamaHost,
  mindDebug,
  debugMind,
  inputs,
  onToolCall
} = {}) {
  let responseText = "";
  const inputText = inputs?.inputText ?? "";
  const mockResponseRaw = inputs?.mockResponseRaw ?? null;
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

  const buildRatifySentence = ({ capability, toolName, decision, raw, matchedKey }) => ({
    mood: "ya",
    be: "ratify",
    su: { name: capability?.su?.name ?? toolName ?? "tool approval" },
    ob: { boolean: decision === "truth" },
    totext: { text: raw ?? decision },
    fromtext: { text: matchedKey ? `policy ${matchedKey}` : "policy unanswered" }
  });

  while (turns < maxToolTurns) {
    turns += 1;
    const requestPayload = { mode: "chat", model, messages, tools, stream: false };
    requestPayload.prompt = buildPromptText(messages);
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
      const toolSignatureWords = deriveSignatureFromCall(capability, { remember });
      const toolSignature = joinSignatureWords(toolSignatureWords);
      if (typeof onToolCall === "function") {
        onToolCall({ stage: "call", toolName, toolSentence, toolCall: call });
      }
      if (capability?.be === "read" && !toolSentence.to) {
        toolSentence.to = { name: "result", nameTypeWords: ["text"] };
      }
      let toolResult = null;
      if (capability?.mood === "propose") {
        const ratify = await resolveRatifyDecision({
          mindName,
          toolName,
          toolSignature,
          subjectName: capability?.su?.name,
          rememberFn: remember
        });
        const decision = ratify?.decision ?? "lie";
        const raw = ratify?.raw ?? "unanswered";
        const matchedKey = ratify?.matchedKey ?? "default";
        const ratifySentence = buildRatifySentence({
          capability,
          toolName,
          decision,
          raw,
          matchedKey
        });
        if (typeof onToolCall === "function") {
          onToolCall({ stage: "ratify", toolName, toolSentence, toolCall: call, ratifySentence });
        }
        if (decision !== "truth") {
          toolResult = ratifySentence;
        }
      }
      try {
        if (!toolResult) {
          toolResult = await interpret(toolSentence);
        }
      } catch (err) {
        const surfaced = surfaceErrorSentence(err);
        if (surfaced?.mood && surfaced?.be) {
          toolResult = surfaced;
        } else {
          throw err;
        }
      }
      const surfacedTool = (toolResult && toolResult.mood)
        ? toolResult
        : remember("result");
      let toolText = "";
      if (surfacedTool && typeof surfacedTool === "object") {
        const mapName = surfacedTool.ob?.name;
        const mapFact = mapName ? remember(mapName) : null;
        if (surfacedTool.be === "read" && typeof surfacedTool.ob?.text === "string") {
          toolText = surfacedTool.ob.text;
        } else if (surfacedTool.be === "list" && Array.isArray(surfacedTool.ob?.ve?.values)) {
          toolText = surfacedTool.ob.ve.values.join("\n");
        } else if (mapFact && (mapFact.be === "json map" || mapFact.be === "map" || mapFact.be === "csv map")) {
          toolText = mapDefChainFromName(mapName, { rememberFn: remember });
        } else if (surfacedTool.ob?.map && (surfacedTool.be === "json map" || surfacedTool.be === "map" || surfacedTool.be === "csv map")) {
          toolText = mapSentenceToPyash(surfacedTool);
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
      if (typeof onToolCall === "function") {
        onToolCall({ stage: "result", toolName, toolSentence, toolCall: call, toolText });
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
  return responseText;
}
