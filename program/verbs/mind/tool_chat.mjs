import { remember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { buildErrorSentence, throwErrorSentence, surfaceErrorSentence } from "../../error.mjs";
import { resolveInterpret, callMindBackend, callMindBackendStream } from "./backend.mjs";
import { startStreamTail } from "./stream.mjs";
import { mapDefChainFromName } from "./map_helpers.mjs";
import { mapSentenceToPyash } from "../exchange/json_map.mjs";
import { recordMindJson, stripContext } from "./logging.mjs";
import { appendLog } from "./history.mjs";
import { buildToolSentence, formatWebSearchToolResult } from "./tooling.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../../bridge/signature.mjs";
import { resolveRatifyDecision } from "../../agent/ratify_policy.mjs";
import { submitRunToolEvent } from "../../bridge/newspaper.mjs";
import { DEFAULT_MAX_MIND_TOOL_TURNS, normalizeMindToolCallLimit } from "../../runtime/mind-limits.mjs";
import { isInternalMindRunnerCommand } from "../command/execute.mjs";

const ZAI_TOOL_RESULT_CONTEXT_BUDGET = 96 * 1024;
const ZAI_TOOL_RESULT_MESSAGE_LIMIT = 12 * 1024;

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

function isZaiPromptLengthError(error) {
  return /(?:code\s*=\s*1261|prompt exceeds max length)/iu.test(String(error?.message ?? error));
}

function trimOldestHistoryMessages(messages, start, end) {
  const count = Math.max(0, end - start);
  if (!count) return { removed: 0, end };

  let removeCount = Math.max(1, Math.ceil(count / 2));
  if (removeCount < count && messages[start + removeCount]?.role !== "user") {
    const nextUser = messages.findIndex((message, index) => index >= start + removeCount && index < end && message?.role === "user");
    removeCount = nextUser >= 0 ? nextUser - start : count;
  }
  messages.splice(start, removeCount);
  return { removed: removeCount, end: end - removeCount };
}

function abbreviateToolResult(content, maxChars) {
  const source = String(content ?? "");
  if (source.length <= maxChars) return source;
  if (maxChars < 120) return "";
  const marker = `\n\n[Middle omitted for prompt size; original result: ${source.length} characters.]\n\n`;
  const contentBudget = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(contentBudget / 2);
  const tailLength = Math.floor(contentBudget / 2);
  return `${source.slice(0, headLength)}${marker}${tailLength ? source.slice(-tailLength) : ""}`;
}

function compactCurrentTurnToolResults(messages, startIndex, {
  totalBudget = ZAI_TOOL_RESULT_CONTEXT_BUDGET,
  perMessageLimit = ZAI_TOOL_RESULT_MESSAGE_LIMIT
} = {}) {
  const toolMessages = [];
  for (let index = Math.max(0, startIndex); index < messages.length; index += 1) {
    if (messages[index]?.role === "tool" && typeof messages[index]?.content === "string") toolMessages.push(messages[index]);
  }
  let remaining = totalBudget;
  let changed = 0;
  let removedCharacters = 0;
  for (let index = toolMessages.length - 1; index >= 0; index -= 1) {
    const message = toolMessages[index];
    const original = message.content;
    const cap = Math.min(perMessageLimit, remaining);
    const shortened = abbreviateToolResult(original, cap);
    if (shortened !== original) {
      message.content = shortened;
      changed += 1;
      removedCharacters += original.length - shortened.length;
    }
    remaining = Math.max(0, remaining - message.content.length);
  }
  return { changed, removedCharacters };
}

function requestSizeBreakdown(payload, { historyStart = 0, historyEnd = 0 } = {}) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const size = (value) => Buffer.byteLength(JSON.stringify(value ?? []), "utf8");
  const system = messages.slice(0, historyStart);
  const savedHistory = messages.slice(historyStart, historyEnd);
  const currentTurn = messages.slice(historyEnd);
  const toolsBytes = size(payload?.tools ?? []);
  const messageBytes = size(messages);
  return {
    totalBytes: messageBytes + toolsBytes,
    systemBytes: size(system),
    savedHistoryBytes: size(savedHistory),
    currentTurnBytes: size(currentTurn),
    toolsBytes
  };
}

export async function callStreamingToolTurn({
  backendName,
  payload,
  onAssistantDelta,
  onToolCall,
  streamBackend = callMindBackendStream
} = {}) {
  const stream = await streamBackend({ backendName, payload });
  const filename = stream?.ob?.filename ?? stream?.result?.ob?.filename ?? stream?.result?.filename;
  if (!filename) throw new Error("mind tool stream missing filename");
  let terminal = null;
  let processReport = "";
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      stop();
      if (error) reject(error);
      else resolve();
    };
    const stop = startStreamTail({
      filename,
      onLine: (line) => {
        const record = JSON.parse(line);
        if (record?.type === "terminal") {
          if (record.ok === false) throw new Error(record.error?.message ?? "mind stream failed");
          terminal = record.envelope ?? {};
        } else if (record?.type === "event") {
          onToolCall?.(record.event);
        } else {
          const text = record?.type === "chunk" ? record.text : record;
          if (typeof text !== "string") throw new Error("mind tool stream malformed record");
          if (text) onAssistantDelta?.(text);
        }
      },
      onEnd: (report) => {
        processReport = String(report ?? "");
        finish();
      },
      onError: (error) => finish(error)
    });
  });
  if (!terminal) {
    const detail = processReport ? `\n${processReport.trimEnd()}` : "";
    throw new Error(`mind tool stream missing terminal reply${detail}`);
  }
  return terminal;
}

function modelLooksVisionCapable(model) {
  const text = String(model ?? "").toLowerCase().trim();
  if (!text) return false;
  return /(strata|vl|vision|llava|minicpm-v|moondream|internvl|qvq)/.test(text);
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

function buildToolUseDirective() {
  return "Use supplied tools for requested actions; report tool failures truthfully.";
}

function toolNames(tools = [], toolMap = null) {
  const names = new Set(
    (Array.isArray(tools) ? tools : [])
      .map((entry) => String(entry?.function?.name ?? "").trim())
      .filter(Boolean)
  );
  if (toolMap instanceof Map) {
    for (const name of toolMap.keys()) {
      const text = String(name ?? "").trim();
      if (text) names.add(text);
    }
  }
  return names;
}

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeTextToolCall(value, allowedNames, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Array.isArray(value.tool_calls)) {
    return value.tool_calls
      .map((entry, childIndex) => normalizeTextToolCall(entry, allowedNames, childIndex))
      .filter(Boolean);
  }

  const nested = value.function && typeof value.function === "object" ? value.function : value;
  const name = String(
    nested.name ??
    value.tool ??
    value.tool_name ??
    value.function_name ??
    ""
  ).trim();
  if (!name || !allowedNames.has(name)) return null;
  const rawArguments = nested.arguments ?? value.arguments ?? value.args ?? {};
  const parsedArguments = typeof rawArguments === "string" ? parseJsonValue(rawArguments) : rawArguments;
  if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)) return null;
  return {
    id: String(value.id ?? `text-tool-call-${index + 1}`).trim(),
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(parsedArguments)
    }
  };
}

function balancedJsonAt(text, start) {
  const opening = text[start];
  if (opening !== "{" && opening !== "[") return null;
  const stack = [opening === "{" ? "}" : "]"];
  let quoted = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character === "{" ? "}" : "]");
      continue;
    }
    if (character !== stack[stack.length - 1]) continue;
    stack.pop();
    if (stack.length === 0) return text.slice(start, index + 1);
  }
  return null;
}

function explicitToolCallValues(content) {
  const text = String(content ?? "");
  const values = [];
  const tagged = /(?:<tool_call>|<\|tool_call\|>)([\s\S]*?)(?:<\/tool_call>|<\|end\|>)/gi;
  for (const match of text.matchAll(tagged)) values.push(match[1]);
  const fenced = /```(?:json|tool_call)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fenced)) values.push(match[1]);
  if (!values.length && text.trim()) values.push(text.trim());
  return values;
}

function explicitFunctionCallValues(content, allowedNames) {
  const text = String(content ?? "");
  const values = [];
  const namePattern = /\b([A-Za-z_][A-Za-z0-9_-]*)\s*\(\s*(\{|\[)/g;
  for (const match of text.matchAll(namePattern)) {
    if (!allowedNames.has(match[1])) continue;
    const json = balancedJsonAt(text, match.index + match[0].lastIndexOf(match[2]));
    if (!json) continue;
    values.push(JSON.stringify({ name: match[1], arguments: parseJsonValue(json) }));
  }
  return values;
}

export function extractExplicitToolCalls(content, tools = [], toolMap = null) {
  const allowedNames = toolNames(tools, toolMap);
  if (!allowedNames.size) return [];
  const calls = [];
  const add = (value, index) => {
    const parsed = parseJsonValue(value);
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const normalized = normalizeTextToolCall(candidate, allowedNames, index);
      const entries = Array.isArray(normalized) ? normalized : [normalized];
      for (const entry of entries) {
        if (!entry) continue;
        calls.push(entry);
      }
    }
  };
  explicitToolCallValues(content).forEach(add);
  explicitFunctionCallValues(content, allowedNames).forEach(add);
  return calls;
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
  toolMapName,
  toolMap,
  tools,
  toolBlock,
  backendName,
  ollamaHost,
  reasoningEffort,
  contextWindow,
  modelTuning,
  maxToolCalls,
  runtimeContext,
  mindDebug,
  debugMind,
  inputs,
  onToolCall,
  onAssistantDelta,
  onUsage,
  saddlePlanTool,
  stream = false,
  checkInterrupted,
  callBackend = callMindBackend,
  callStream = callStreamingToolTurn
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
  if (tools?.length) messages.push({ role: "system", content: buildToolUseDirective() });
  else if (toolBlock) messages.push({ role: "system", content: toolBlock });
  let historyStart = messages.length;
  if (historyMessages.length) messages.push(...historyMessages);
  let historyEnd = messages.length;
  const userContent = [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
  const userMessage = { role: "user", content: userContent };
  if (visionInputs.length && modelLooksVisionCapable(model)) {
    userMessage.imageFiles = visionInputs;
  }
  messages.push(userMessage);

  const interpret = await resolveInterpret();
  const maxToolTurns = DEFAULT_MAX_MIND_TOOL_TURNS;
  const effectiveMaxToolCalls = normalizeMindToolCallLimit(maxToolCalls);
  let toolCallsUsed = 0;
  let turns = 0;
  let lastResponse = null;
  let lastToolText = "";

  const buildRatifySentence = ({ capability, toolName, decision, mode, raw, matchedKey }) => ({
    mood: "ya",
    be: "ratify",
    su: { name: capability?.su?.name ?? toolName ?? "tool approval" },
    ob: mode === "ask" ? { text: "ask" } : { boolean: decision === "truth" },
    mode: mode ?? (decision === "truth" ? "allow" : "deny"),
    totext: { text: raw ?? decision },
    fromtext: { text: matchedKey ? `policy ${matchedKey}` : "policy unanswered" }
  });

  const emitToolCall = async (payload) => {
    if (typeof onToolCall !== "function") return undefined;
    try {
      return await onToolCall(payload);
    } catch {
      // Tool-call observers are best-effort and should not break response generation.
      return undefined;
    }
  };

  const buildRequestPayload = (requestTools = tools) => {
    const requestPayload = { mode: "chat", model, messages, tools: requestTools, stream: stream === true };
    requestPayload.prompt = buildPromptText(messages);
    const selectedToolMapName = String(toolMapName ?? "").trim();
    if (selectedToolMapName) requestPayload.toolMapName = selectedToolMapName;
    if (ollamaHost) requestPayload.host = ollamaHost;
    if (reasoningEffort) requestPayload.reasoningEffort = reasoningEffort;
    if (backendName === "ollama command mind" && Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0) {
      requestPayload.options = {
        ...(requestPayload.options && typeof requestPayload.options === "object" ? requestPayload.options : {}),
        num_ctx: Number(contextWindow)
      };
    } else if (backendName === "zai command mind" && Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0) {
      requestPayload.contextWindow = Number(contextWindow);
    }
    applySampling(requestPayload);
    return requestPayload;
  };

  const requestModel = async (initialPayload) => {
    let requestPayload = initialPayload;
    let removedHistoryMessages = 0;
    let compactedToolMessages = 0;
    let removedToolCharacters = 0;
    let toolCompactionNoteAdded = false;
    const mockResponse = nextMockResponse();
    for (;;) {
      recordMindJson({ targetName: mindName, label: "request", payload: requestPayload });
      debugMind("request", requestPayload);
      let response;
      try {
        if (mockResponse) {
          if (typeof mockResponse === "string") {
            try {
              response = JSON.parse(mockResponse);
            } catch {
              response = { message: { content: mockResponse } };
            }
          } else {
            response = mockResponse;
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
          response = stream === true
            ? await callStream({ backendName, payload: requestPayload, onAssistantDelta, onToolCall })
            : await callBackend({ backendName, payload: requestPayload, debug: mindDebug });
        }
      } catch (error) {
        if (backendName !== "zai command mind" || !isZaiPromptLengthError(error)) throw error;
        const toolCompaction = compactCurrentTurnToolResults(messages, historyEnd + 1);
        if (toolCompaction.changed) {
          compactedToolMessages += toolCompaction.changed;
          removedToolCharacters += toolCompaction.removedCharacters;
          if (!toolCompactionNoteAdded) {
            messages.splice(historyStart, 0, {
              role: "system",
              content: "Some completed tool outputs above were abbreviated to fit the provider prompt limit. Those actions already ran; do not repeat side-effecting calls just to recover omitted output. Re-read a source only if the remaining evidence requires it."
            });
            historyStart += 1;
            historyEnd += 1;
            toolCompactionNoteAdded = true;
          }
          await emitToolCall({
            stage: "context_compacted",
            toolName: "Z.AI prompt limit",
            toolText: `Abbreviated ${compactedToolMessages} completed tool result(s), omitting ${removedToolCharacters} characters; tool actions were not repeated.`
          });
          requestPayload = buildRequestPayload();
          continue;
        }
        const trimmed = trimOldestHistoryMessages(messages, historyStart, historyEnd);
        if (!trimmed.removed) {
          const sizes = requestSizeBreakdown(requestPayload, { historyStart, historyEnd });
          throw new Error(`${error.message}; recovery removed ${removedHistoryMessages} saved history message(s) and abbreviated ${compactedToolMessages} completed tool result(s) by ${removedToolCharacters} characters, but the request still exceeds the provider limit (JSON bytes: ${sizes.totalBytes}; system: ${sizes.systemBytes}; saved history: ${sizes.savedHistoryBytes}; current turn: ${sizes.currentTurnBytes}; tool schemas: ${sizes.toolsBytes})`);
        }
        historyEnd = trimmed.end;
        removedHistoryMessages += trimmed.removed;
        await emitToolCall({
          stage: "context_compacted",
          toolName: "Z.AI prompt limit",
          toolText: `Removed ${removedHistoryMessages} oldest saved conversation messages after provider rejected an oversized prompt; current request retained.`,
          providerHistoryWindow: Math.ceil((historyEnd - historyStart) / 2)
        });
        requestPayload = buildRequestPayload();
        continue;
      }
      onUsage?.(response?.usage ?? response?.metadata ?? response);
      recordMindJson({ targetName: mindName, label: "response", payload: stripContext(response) });
      if (mindDebug) {
        // eslint-disable-next-line no-console
        console.error(`[mind debug] ${JSON.stringify({ label: "response", hasToolCalls: Array.isArray(response?.message?.tool_calls), contentLength: (response?.message?.content ?? "").length })}`);
      }
      return response;
    }
  };

  while (turns < maxToolTurns) {
    if (typeof checkInterrupted === "function") {
      await checkInterrupted();
    }
    turns += 1;
    lastResponse = await requestModel(buildRequestPayload());

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
        toolText: observed?.toolText ?? observed?.tool_text ?? "",
        ...(observed?.commandOutcome ? { commandOutcome: observed.commandOutcome } : {})
      });
      if (stage === "result") {
        lastToolText = String(observed?.toolText ?? observed?.tool_text ?? "").trim();
      }
    }

    const nativeToolCalls = lastResponse?.message?.tool_calls;
    const textToolCalls = (!Array.isArray(nativeToolCalls) || nativeToolCalls.length === 0)
      ? extractExplicitToolCalls(lastResponse?.message?.content ?? "", tools, toolMap)
      : [];
    const toolCalls = Array.isArray(nativeToolCalls) && nativeToolCalls.length > 0
      ? nativeToolCalls
      : textToolCalls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      responseText = lastResponse?.message?.content ?? "";
      break;
    }

    const assistantMessage = {
      role: "assistant",
      content: textToolCalls.length > 0 ? "" : lastResponse?.message?.content ?? "",
      tool_calls: toolCalls
    };
    if (typeof lastResponse?.message?.reasoning_content === "string") {
      assistantMessage.reasoning_content = lastResponse.message.reasoning_content;
    }
    messages.push(assistantMessage);
    appendLog(dialogue, { role: "assistant", content: assistantMessage.content });
    const messagesAfterToolBatch = [];

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
      submitRunToolEvent({ stage: "call", toolName, toolSentence, toolCall: call });
      if (toolCallsUsed >= effectiveMaxToolCalls) {
        const limitError = buildErrorSentence({
          name: "mind tool call limit exceeded",
          message: `mind tool call limit exceeded: maximum ${effectiveMaxToolCalls} tool calls`,
          from: { name: "mind" },
          raw: {
            maxToolCalls: effectiveMaxToolCalls,
            attemptedToolCall: toolCallsUsed + 1,
            toolName
          }
        });
        const surfacedLimitError = surfaceErrorSentence(limitError);
        const limitText = sentenceToPyash(surfacedLimitError);
        await emitToolCall({ stage: "result", toolName, toolSentence, toolCall: call, toolText: limitText });
        submitRunToolEvent({
          stage: "result",
          toolName,
          toolSentence,
          toolCall: call,
          resultSentence: surfacedLimitError,
          toolText: limitText
        });
        throwErrorSentence({
          name: "mind tool call limit exceeded",
          message: `mind tool call limit exceeded: maximum ${effectiveMaxToolCalls} tool calls`,
          from: { name: "mind" },
          raw: {
            maxToolCalls: effectiveMaxToolCalls,
            attemptedToolCall: toolCallsUsed + 1,
            toolName
          }
        });
      }
      toolCallsUsed += 1;
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
        const mode = ratify?.mode ?? (decision === "truth" ? "allow" : "deny");
        const raw = ratify?.raw ?? "unanswered";
        const matchedKey = ratify?.matchedKey ?? "default";
        const ratifySentence = buildRatifySentence({
          capability,
          toolName,
          decision,
          mode,
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
          if (isInternalMindRunnerCommand(toolSentence?.ob?.text)) {
            toolResult = buildErrorSentence({
              name: "internal mind runner invocation",
              message: "provider mind-runner scripts are internal adapters, not shell entry points; the active saddle already runs the selected model, so answer directly or use project tools to inspect files",
              from: { name: "mind tool" },
              raw: { toolName, command: toolSentence?.ob?.text }
            });
          } else if (capability?.be === "write" && capability?.fromstate?.text === "coding saddle plan") {
            if (typeof saddlePlanTool !== "function") throw new Error("session plan tool is unavailable in this mind call");
            toolResult = await saddlePlanTool(String(toolSentence?.ob?.text ?? ""));
          } else {
            toolResult = await interpret(toolSentence, { runtimeContext });
          }
        }
      } catch (err) {
        const surfaced = surfaceErrorSentence(err);
        if (surfaced?.mood && surfaced?.be) {
          toolResult = surfaced;
        } else if (capability?.be === "write" && capability?.fromstate?.text === "coding saddle plan") {
          toolResult = surfaceErrorSentence(buildErrorSentence({
            name: "coding saddle plan update failed",
            message: err?.message || String(err),
            from: { name: "coding saddle plan" }
          }));
        } else {
          throw err;
        }
      }
      const surfacedTool = (() => {
        if (toolResult && toolResult.mood) return toolResult;
        if (toolResult && toolResult.be) {
          return {
            mood: "ya",
            su: toolResult.su ?? { name: "result" },
            be: toolResult.be,
            ob: toolResult.ob ?? {}
          };
        }
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
        if (surfacedTool.be === "error") {
          const errorName = String(surfacedTool.su?.name ?? "").trim();
          const errorMessage = String(surfacedTool.ob?.text ?? "tool failed").trim();
          toolText = [errorName, errorMessage].filter(Boolean).join(": ");
        }
        if (!toolText && (toolName === "web_search" || toolName === "web_search_source")) {
          toolText = formatWebSearchToolResult(surfacedTool);
        }
        const mapName = surfacedTool.ob?.name;
        const mapFact = mapName ? remember(mapName) : null;
        if (!toolText && surfacedTool.be === "read" && typeof surfacedTool.ob?.text === "string") {
          toolText = surfacedTool.ob.text;
        } else if (!toolText && surfacedTool.be === "list" && Array.isArray(surfacedTool.ob?.ve?.values)) {
          toolText = surfacedTool.ob.ve.values.join("\n");
        } else if (!toolText && mapFact && (mapFact.be === "json map" || mapFact.be === "map" || mapFact.be === "csv map")) {
          toolText = mapDefChainFromName(mapName, { rememberFn: remember });
        } else if (!toolText && surfacedTool.ob?.map && (surfacedTool.be === "json map" || surfacedTool.be === "map" || surfacedTool.be === "csv map")) {
          toolText = mapSentenceToPyash(surfacedTool);
        } else if (!toolText && surfacedTool.be === "interpret" && typeof surfacedTool.ob?.text === "string") {
          const rawText = surfacedTool.ob.text;
          const match = rawText.match(/^quoted\.([^.]+)\.([\s\S]*?)\.\1\.quoted$/);
          toolText = match ? match[2] : rawText;
        } else if (!toolText) {
          toolText = sentenceToPyash(surfacedTool);
        }
      } else {
        toolText = String(surfacedTool ?? "");
      }
      const commandOutcome = String(toolName).toLowerCase().startsWith("be_command")
        ? (surfacedTool?.be === "command"
          ? { exitCode: 0, signal: null, timedOut: false }
          : (() => {
              const status = toolText.match(/\bstatus=(\d+)\b/u);
              return status ? { exitCode: Number(status[1]), signal: null, timedOut: false } : null;
            })())
        : null;
      const observedResult = await emitToolCall({
        stage: "result", toolName, toolSentence, toolCall: call, toolText, resultSentence: surfacedTool,
        ...(commandOutcome ? { commandOutcome } : {})
      });
      submitRunToolEvent({
        stage: "result",
        toolName,
        toolSentence,
        toolCall: call,
        resultSentence: surfacedTool,
        toolText,
        ...(commandOutcome ? { commandOutcome } : {})
      });
      const toolMessage = { role: "tool", content: toolText };
      if (toolCallId) toolMessage.tool_call_id = toolCallId;
      toolMessage.tool_name = toolName;
      messages.push(toolMessage);
      appendLog(dialogue, { role: "tool", content: toolText });
      if (Array.isArray(observedResult?.saddleMessages)) {
        messagesAfterToolBatch.push(...observedResult.saddleMessages);
      }
      lastToolText = toolText;
    }

    for (const queuedMessage of messagesAfterToolBatch) {
      const content = String(queuedMessage?.text ?? "").trim();
      if (!content) continue;
      messages.push({ role: "user", content });
      appendLog(dialogue, { role: "user", content });
    }
  }

  const responseNeedsSummary = !String(responseText ?? "").trim()
    || String(responseText).trim() === "DID_NOT_RECEIVE_TOOL_RESULT";
  let finalSummaryRequested = false;
  if (responseNeedsSummary && (toolCallsUsed > 0 || lastToolText)) {
    if (typeof checkInterrupted === "function") await checkInterrupted();
    finalSummaryRequested = true;
    messages.push({
      role: "system",
      content: "All tool actions for the user's request are complete. Provide a concise user-facing answer using the tool results above. Do not call tools and do not return raw tool output."
    });
    lastResponse = await requestModel(buildRequestPayload([]));
    responseText = String(lastResponse?.message?.content ?? "");
  }
  if (finalSummaryRequested && String(responseText).trim() === "DID_NOT_RECEIVE_TOOL_RESULT") responseText = "";
  if (!String(responseText ?? "").trim() && (toolCallsUsed > 0 || lastToolText)) {
    responseText = "I completed the tool calls, but the model did not provide a final summary. The tool results are shown above.";
  }
  if (stream !== true && responseText) onAssistantDelta?.(responseText);
  if (mindDebug && !responseText) {
    // eslint-disable-next-line no-console
    console.error(`[mind debug] ${JSON.stringify({ label: "empty-response", lastResponse: stripContext(lastResponse ?? {}) })}`);
  }
  return responseText;
}
