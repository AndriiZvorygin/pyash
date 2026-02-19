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

function buildToolUseDirective(tools = []) {
  const names = Array.isArray(tools)
    ? tools
      .map((entry) => String(entry?.function?.name ?? "").trim())
      .filter(Boolean)
    : [];
  const list = names.length ? names.join(", ") : "(none)";
  return [
    "TOOL USAGE RULES:",
    "- You can call tools in this turn.",
    `- Available tool function names: ${list}.`,
    "- Do not claim tools are unavailable when a matching tool exists.",
    "- If user asks to search/download/read files/execute commands, call the matching tool first.",
    "- If a tool fails, report the failure reason and continue with best effort."
  ].join("\n");
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
  reasoningEffort,
  mindDebug,
  debugMind,
  inputs,
  onToolCall,
  checkInterrupted
} = {}) {
  let responseText = "";
  const inputText = inputs?.inputText ?? "";
  const mockResponseRaw = inputs?.mockResponseRaw ?? null;
  const visionInputs = Array.isArray(inputs?.imageInputs)
    ? inputs.imageInputs.map(normalizeVisionInput).filter(Boolean)
    : [];
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
  if (tools?.length) messages.push({ role: "system", content: buildToolUseDirective(tools) });
  if (historyMessages.length) messages.push(...historyMessages);
  const userContent = [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
  const userMessage = { role: "user", content: userContent };
  if (visionInputs.length && modelLooksVisionCapable(model)) {
    userMessage.imageFiles = visionInputs;
  }
  messages.push(userMessage);

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

  const emitToolCall = async (payload) => {
    if (typeof onToolCall !== "function") return;
    try {
      await onToolCall(payload);
    } catch {
      // Tool-call observers are best-effort and should not break response generation.
    }
  };

  while (turns < maxToolTurns) {
    if (typeof checkInterrupted === "function") {
      await checkInterrupted();
    }
    turns += 1;
    const requestPayload = { mode: "chat", model, messages, tools, stream: false };
    requestPayload.prompt = buildPromptText(messages);
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
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

    const observedToolEvents = Array.isArray(lastResponse?.message?.observed_tool_events)
      ? lastResponse.message.observed_tool_events
      : [];
    for (const observed of observedToolEvents) {
      const stage = String(observed?.stage ?? "").trim().toLowerCase();
      const toolName = String(observed?.toolName ?? observed?.tool_name ?? "").trim();
      if (!stage || !toolName) continue;
      await emitToolCall({
        stage,
        toolName,
        toolCall: observed?.toolCall ?? observed?.tool_call ?? null,
        toolText: observed?.toolText ?? observed?.tool_text ?? ""
      });
      if (stage === "result") {
        lastToolText = String(observed?.toolText ?? observed?.tool_text ?? "").trim();
      }
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
      if (typeof checkInterrupted === "function") {
        await checkInterrupted();
      }
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
      await emitToolCall({ stage: "call", toolName, toolSentence, toolCall: call });
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
        await emitToolCall({ stage: "ratify", toolName, toolSentence, toolCall: call, ratifySentence });
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
      const surfacedTool = (() => {
        if (toolResult && toolResult.mood) return toolResult;
        if (toolResult && typeof toolResult === "object" && toolResult.result && typeof toolResult.result === "object") {
          return {
            mood: "ya",
            su: { name: "result" },
            be: capability?.be ?? "result",
            ob: toolResult.result
          };
        }
        return remember("result");
      })();
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
      await emitToolCall({ stage: "result", toolName, toolSentence, toolCall: call, toolText });
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
