import path from "node:path";
import {
  DEFAULT_ZAI_CODING_REASONING_EFFORT,
  fetchZaiCodingPlanModels
} from "../runtime/zai_coding_plan.mjs";
import { fetchMiniMaxModels } from "../runtime/minimax.mjs";
import { OLLAMA_CONTEXT_PRESETS } from "../runtime/ollama_context.mjs";
import { formatRatifyToolResult } from "../verbs/mind/tool_result.mjs";

export const SADDLE_OLLAMA_CONTEXT_PRESETS = OLLAMA_CONTEXT_PRESETS;
const SADDLE_OLLAMA_FALLBACK_CONTEXT_LIMIT = 65536;

const SADDLE_SLASH_COMMANDS = [
  { name: "/help", takesArguments: false },
  { name: "/status", takesArguments: false },
  { name: "/session", takesArguments: true },
  { name: "/mind", takesArguments: true },
  { name: "/model", takesArguments: true },
  { name: "/context", takesArguments: true },
  { name: "/think", takesArguments: true },
  { name: "/plan", takesArguments: true },
  { name: "/host", takesArguments: true },
  { name: "/usage", takesArguments: false },
  { name: "/discharge", takesArguments: false },
  { name: "/exit", takesArguments: false },
  { name: "/quit", takesArguments: false }
];

export function saddleSlashCommandCompletions({ value = "", cursor } = {}) {
  const text = String(value ?? "");
  const position = Math.max(0, Math.min(text.length, Number.isInteger(cursor) ? cursor : text.length));
  const leading = text.match(/^\s*/u)?.[0] ?? "";
  const rest = text.slice(leading.length);
  const token = rest.match(/^\/[^\s]*/u)?.[0] ?? "";
  if (!token || position < leading.length || position > leading.length + token.length) return [];

  const matches = SADDLE_SLASH_COMMANDS.filter(({ name }) => name.startsWith(token.toLowerCase()));
  const tail = rest.slice(token.length);
  return matches.map(({ name, takesArguments }) => {
    const addSpace = !tail && takesArguments;
    const value = `${leading}${name}${addSpace ? " " : tail}`;
    return { value, cursor: leading.length + name.length + (addSpace ? 1 : 0) };
  });
}

function formatContextLength(tokens) {
  const value = Number(tokens);
  if (!Number.isSafeInteger(value) || value <= 0) return "default";
  if (value >= 1048576 && value % 1048576 === 0) return `${value / 1048576}M`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024}K`;
  return value.toLocaleString("en-CA");
}

export function getSaddleOllamaModelContextLength({ models = [], model = "" } = {}) {
  const selectedModel = normalizeText(model);
  const entry = (Array.isArray(models) ? models : []).find((item) => {
    const name = typeof item === "string" ? item : item?.name ?? item?.model ?? item?.id;
    return normalizeText(name) === selectedModel;
  });
  const value = Number(typeof entry === "object" && entry !== null
    ? entry.details?.context_length ?? entry.context_length ?? entry.contextLength
    : null);
  return Number.isSafeInteger(value) && value >= 4096 ? value : null;
}

export function buildSaddleOllamaContextOptions({ modelContextLength = null, currentContextLength = null } = {}) {
  const requestedLimit = Number(modelContextLength);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit >= 4096
    ? Math.min(requestedLimit, SADDLE_OLLAMA_CONTEXT_PRESETS.at(-1))
    : SADDLE_OLLAMA_FALLBACK_CONTEXT_LIMIT;
  const values = SADDLE_OLLAMA_CONTEXT_PRESETS.filter((tokens) => tokens <= limit);
  if (requestedLimit >= 4096 && requestedLimit <= limit && !values.includes(requestedLimit)) values.push(requestedLimit);
  values.sort((a, b) => a - b);
  return [
    { model: "default", value: "default", label: "Ollama default", tokens: null },
    ...values.map((tokens) => ({
      model: String(tokens),
      value: formatContextLength(tokens),
      label: formatContextLength(tokens),
      tokens
    }))
  ].map((choice) => ({
    ...choice,
    current: choice.tokens === (Number(currentContextLength) || null)
  }));
}

export function buildSaddleStrataContextOptions({
  options = [],
  currentContextLength = null,
  defaultContextLength = null
} = {}) {
  const values = [...new Set((Array.isArray(options) ? options : [])
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value >= 8192 && value <= 262144))]
    .sort((a, b) => a - b);
  if (!values.length) return [];
  const choices = values.map((tokens) => ({
    model: String(tokens),
    value: formatContextLength(tokens),
    label: formatContextLength(tokens),
    tokens
  }));
  const defaultTokens = Number(defaultContextLength);
  if (values.includes(defaultTokens)) {
    choices.unshift({
      model: String(defaultTokens),
      value: "default",
      label: `Default (${formatContextLength(defaultTokens)})`,
      tokens: defaultTokens
    });
  }
  return choices.map((choice) => ({
    ...choice,
    current: choice.tokens === Number(currentContextLength),
    isDefault: choice.value === "default"
  }));
}

export const DEFAULT_CODING_SADDLE_SYSTEM_PROMPT = [
  "You are the Pyash coding saddle: an interactive coding agent operating inside the existing Pyash runtime.",
  "For greetings and casual conversation, answer directly in a short natural response and make no tool calls. Use tools only when the requested action or information requires them.",
  "For repository files, code, tests, git, commands, or web research, use `bash(command)` and report concrete evidence. It runs one shell command in the active project directory and returns its output and exit status. Read the active agent house's `identity/TOOLS.md` for Pyash-backed web search and other workflows.",
  "A tool error is a result for the active task. If another supported command can complete the request, continue with it; do not repeat an unchanged failing call. If no supported path works, report the exact blocker. Ground claims in command output and retrieved page text; do not invent titles or URLs or describe an incomplete search as complete.",
  "Resolve brief follow-ups against the active request and continue it with the appropriate command. Do not turn a web-search request into process management or ask the user to choose between equivalent routes when the documented workflow can proceed.",
  "Run requested commands directly in the active project directory, including destructive project-local changes; the coding saddle does not require per-command ratification there. Keep commands within the active project and let the configured command sandbox enforce its writable roots.",
  "The active turn already runs on the selected model. Do not invoke the agent runtime or a second model through shell tools; answer directly or use the provided project tools. Make a separate Pyash mind call only when the user explicitly asks for another model's judgment.",
  "Do not pretend a change was made when a tool did not succeed.",
  "Keep work inside the configured coding directory and prefer small, verifiable steps.",
  "For code changes, name the target file before editing; use write for bounded file creation and repair for unified-diff edits.",
  "For substantial multi-step repository, research, or operational work, maintain a concise session plan with the update session plan tool; update step states as work proceeds and mark a step done only after recording concrete verification evidence. Keep plans to the necessary steps and skip them for simple questions or one-step edits.",
  "After the final edit, use command to run the narrowest relevant test, build, syntax check, or execution check. A check run before the final edit does not count.",
  "After a coding task passes its final verification, record only durable project decisions or constraints in the active agent house's absolute memory/MEMORY.md path shown in context (not a project-relative path), with the validation command and a session or artifact evidence reference. Do not store routine task logs, temporary findings, or unverified claims; if no durable decision was made, do not write a memory entry.",
  "Do not commit or push unless the user explicitly requests it. The harness will show the current worktree status and bounded diff for review before the completion evidence.",
  "Before reporting completion, state the changed file paths, summarize the change, and give the exact check command and its result. If work or verification is incomplete, say so plainly instead of saying done.",
  "Respond concisely with the result and any remaining blocker."
].join(" ");

const SADDLE_CHANGE_ACTION = /\b(?:add|build|change|create|edit|fix|generate|implement|make|modify|patch|refactor|remove|rewrite|update|write)\b/iu;
const SADDLE_CODE_TARGET = /\b(?:code|program|script|source|file|function|class|module|test|bug|tool|harness|command|repository|repo|pipeline|variable|package|configuration|config)\b|\.(?:mjs|js|cjs|ts|py|pya|json|sh|md)\b/iu;
const SADDLE_CONTINUATION_REPLY = /^(?:(?:please\s+)?(?:continue|keep going|carry on|resume|finish(?: it)?)(?:\s+please)?)[.!]?$/iu;
const SADDLE_TOOL_ACTION = /^(?:check|compare|confirm|create|delete|edit|execute|find|fix|generate|implement|inspect|install|list|look\s+up|make|modify|move|open|read|remove|rename|research|restart|run|search|start|stop|test|update|verify|write)\b/iu;
const SADDLE_ALWAYS_TOOL_ACTION = /^(?:compare|execute|find|inspect|list|look\s+up|open|read|research|restart|run|search|start|stop|test|verify)\b/iu;
const SADDLE_MUTATING_ACTION = /^(?:create|delete|edit|fix|generate|implement|install|make|modify|move|remove|rename|update|write)\b/iu;
const SADDLE_ACTION_TARGET = /\b(?:artifact|branch|cache|code|command|config|configuration|directory|directories|file|files|folder|folders|module|package|path|paths|project|python|repo|repository|script|source|test|tests)\b|\.(?:mjs|js|cjs|ts|py|pya|json|sh|md)\b/iu;

export function isSaddleAffirmativeReply(input = "") {
  const text = String(input ?? "").trim().toLowerCase();
  const match = text.match(/^(?:yes|yeah|yep|okay|ok|sure|go ahead|do it|please do|proceed|continue|keep going|carry on|resume|finish(?: it)?|sounds good|that works)\b/u);
  if (!match) return false;
  return !/^\s*(?:,?\s*but\s+)?(?:no|not|don't|do not|never|cancel|stop|instead)\b/u.test(text.slice(match[0].length));
}

export function isSaddleContinuationReply(input = "") {
  return SADDLE_CONTINUATION_REPLY.test(String(input ?? "").trim());
}

export function buildSaddleSteeringInput({ originalInput = "", assistantResponse = "", additions = "" } = {}) {
  const sections = [
    "The previous response was interrupted after the user added context. Respond to the original request using that added context.",
    `Original user message:\n${String(originalInput ?? "").trim()}`
  ];
  const response = String(assistantResponse ?? "").trim();
  if (response && isSaddleAffirmativeReply(additions)) {
    sections.push(`Interrupted assistant response:\n${response}`);
  }
  sections.push(`Additional context:\n${String(additions ?? "").trim()}`);
  return sections.join("\n\n");
}

export function buildSaddleContinuationInput({ originalInput = "", assistantResponse = "", additions = "", actionable = false } = {}) {
  const sections = [
    "The user is continuing the previous exchange. Resume its active task or discussion using the context below; do not treat this as an unrelated request.",
    `Previous user request:\n${String(originalInput ?? "").trim()}`,
    `Previous assistant response:\n${String(assistantResponse ?? "").trim()}`
  ];
  sections.push(actionable
    ? `Additional context:\n${String(additions ?? "").trim()}`
    : `Current user message:\n${String(additions ?? "").trim()}`);
  return sections.join("\n\n");
}

export function isSaddleCodeChangeRequest(input = "") {
  const text = String(input ?? "").replace(
    /\b(?:i|we)\s+(?:just\s+)?(?:did|made|completed|finished)\s+(?:an?\s+)?(?:add|build|change|create|edit|fix|generate|implement|make|modify|patch|refactor|remove|rewrite|update|write)\b/giu,
    " "
  ).replace(
    /\b(?:do\s+not|don't|never|without)\s+(?:(?:please|just)\s+)?(?:add|build|change|create|edit|fix|generate|implement|make|modify|patch|refactor|remove|rewrite|update|write)\b/giu,
    " "
  );
  const statusInquiry = /^\s*(?:(?:can|could)\s+you\s+)?(?:see|check|verify|confirm|test)\s+(?:if|whether)\b/iu.test(text);
  const requestedFollowupChange = /\b(?:and|then|if so|if not|otherwise)\s+(?:please\s+)?(?:add|build|change|create|edit|fix|implement|make|modify|patch|refactor|remove|rewrite|update|write)\b/iu.test(text);
  if (statusInquiry && !requestedFollowupChange) return false;
  if (!SADDLE_CHANGE_ACTION.test(text)) return false;
  if (/\b(?:fix|implement|patch|refactor)\b/iu.test(text)) return true;
  return SADDLE_CODE_TARGET.test(text);
}

export function isSaddleActionOffer(input = "") {
  const text = String(input ?? "");
  const offers = text.matchAll(/\b(?:i can|i could|i will|i'll|shall i|want me to|would you like me to)\s+([^.!?\n]{1,160})/giu);
  for (const offer of offers) {
    const actionText = `${offer[1]}\n${text}`;
    const action = resolveRequestedSaddleAction(offer[1]);
    if (action && (SADDLE_ALWAYS_TOOL_ACTION.test(action) || SADDLE_ACTION_TARGET.test(actionText))) return true;
    if (isSaddleCodeChangeRequest(actionText)) return true;
  }
  return false;
}

export function isSaddleActionableContinuation({ originalInput = "", assistantResponse = "", previousAssessment = null } = {}) {
  const context = `${String(originalInput ?? "")}\n${String(assistantResponse ?? "")}`;
  return previousAssessment?.required === true && previousAssessment.complete === false
    || isSaddleCodeChangeRequest(context)
    || isSaddleToolActionRequest(originalInput)
    || isSaddleActionOffer(assistantResponse);
}

function resolveRequestedSaddleAction(input = "") {
  const original = String(input ?? "").trim();
  const steeringContext = original.match(/\bAdditional context:\n([\s\S]*)$/iu)?.[1]?.trim();
  if (steeringContext && isSaddleAffirmativeReply(steeringContext)) return "do it";
  if (/^(?:do it|go ahead|proceed)\s*[.!]?$/iu.test(original)) return "do it";
  if (/^(?:how|why|what|when|where)\b/iu.test(original)) return "";
  let actionText = original.toLowerCase();
  actionText = actionText.replace(/^(?:(?:okay|ok|please|also|now|and|then)\s+)+/u, "");
  actionText = actionText.replace(/^(?:(?:can|could|would)\s+you(?:\s+please)?|i\s+(?:need|want)\s+you\s+to|let'?s|go\s+ahead\s+and)\s+/u, "");
  actionText = actionText.replace(/^(?:(?:okay|ok|please|also|now|and|then)\s+)+/u, "");
  const match = actionText.match(SADDLE_TOOL_ACTION);
  return match ? match[0].toLowerCase() : "";
}

export function isSaddleToolActionRequest(input = "") {
  const action = resolveRequestedSaddleAction(input);
  if (!action) return false;
  const text = String(input ?? "");
  return action === "do it"
    || SADDLE_ALWAYS_TOOL_ACTION.test(action)
    || SADDLE_ACTION_TARGET.test(text);
}

function eventToolName(event = {}) {
  return String(event.toolName ?? event.tool_name ?? event.toolCall?.function?.name ?? "").trim().toLowerCase();
}

function eventArguments(event = {}) {
  const raw = event.toolCall?.function?.arguments ?? event.toolCall?.arguments;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

function toolKind(name = "") {
  const parts = String(name).split(/[^a-z0-9]+/u).filter(Boolean);
  return parts[0] === "be" ? parts[1] ?? "" : parts[0] ?? "";
}

function eventSentence(event = {}) {
  if (event.toolSentence && typeof event.toolSentence === "object") return event.toolSentence;
  const args = eventArguments(event);
  return args.sentence && typeof args.sentence === "object" ? args.sentence : args;
}

function commandText(event = {}) {
  const sentence = eventSentence(event);
  const args = eventArguments(event);
  const raw = sentence?.ob?.text ?? args.command ?? args.ob?.text ?? args.ob;
  return typeof raw === "string" ? raw.trim() : "";
}

function isMutatingCommand(text = "") {
  const command = String(text ?? "");
  return /\b(?:apply_patch|install|mkdir|mv|rm|rmdir|tee|touch)\b|\b(?:cp|git)\s+(?:-[^\s]+\s+)*(?:add|apply|checkout|clean|commit|merge|move|rebase|reset|restore|rm|switch)\b|\bsed\s+-i\b|\bperl\s+-pi\b/iu.test(command)
    || /\bfind\b[\s\S]*?(?:\s-delete\b|\s-exec(?:dir)?\s+rm\b)/iu.test(command)
    || /(?:^|[^<])>{1,2}\s*(?:["']?)(?:\/|\.\.?\/|~\/|[\w.-]+\/|[\w.-]+\.[a-z0-9_-]+)/iu.test(command);
}

function isValidationCommand(text = "") {
  const command = String(text ?? "").trim();
  if (!command) return false;
  return /(?:^|[;&|]\s*)(?:git\s+(?:diff\s+--check\b|status\b)|find\s+.+\s+-print0?\b|(?:ls|rg|grep|test|stat)\s+\S+|(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|lint|build|check|typecheck)\b|(?:node|npx)\s+(?:--test\b|--check\b|[\w./-]+\.(?:mjs|js|cjs|ts)\b)|(?:python|python3)\s+[\w./-]+\.py\b|(?:bash|sh)\s+[\w./-]+\.sh\b|pytest\b|vitest\b|jest\b|eslint\b|tsc\b|mypy\b|ruff\b|(?:cargo|go)\s+test\b|make\s+(?:test|check|build)\b|\.\/run\s+\S+)/iu.test(command);
}

function isToolFailure(text = "") {
  const value = String(text ?? "");
  return /\b(?:isError|is_error)\s*["']?\s*:\s*true\b|\b(?:command|write|repair) defective\b|\b(?:command approval|approve command|approval required|awaiting approval)\b|\bexit=(?:[1-9]\d*|unknown)\b|"be"\s*:\s*"(?:error|ratify)"/iu.test(value);
}

function eventCommandOutcome(event = {}) {
  if (event.commandOutcome && typeof event.commandOutcome === "object") return event.commandOutcome;
  const match = String(event.toolText ?? event.tool_text ?? "").match(/\bexit=(\d+)\b/u);
  return match ? { exitCode: Number(match[1]), signal: null, timedOut: false } : null;
}

function isShellTool(name = "") {
  return ["bash", "command"].includes(toolKind(name));
}

function isPlanToolCall(call = {}) {
  const sentence = eventSentence(call.event);
  return call.name.includes("coding_saddle_plan")
    || sentence?.fromstate?.text === "coding saddle plan";
}

function isSuccessfulToolCall(call = {}, events = []) {
  if (call.resultIndex < 0 || isToolFailure(call.resultText)) return false;
  const resultEvent = events[call.resultIndex];
  const resultSentence = resultEvent?.resultSentence ?? resultEvent?.result_sentence;
  if (resultSentence?.be === "ratify") return false;
  const outcome = eventCommandOutcome(resultEvent);
  if (isShellTool(call.name) && outcome) {
    return outcome.exitCode === 0 && !outcome.signal && outcome.timedOut !== true;
  }
  return true;
}

function changedPathForEvent(event = {}) {
  const sentence = eventSentence(event);
  const args = eventArguments(event);
  const target = sentence?.to?.filename ?? args.to?.filename ?? args.filename;
  if (typeof target === "string" && target.trim()) return target.trim();
  const patch = sentence?.ob?.text ?? args.ob?.text ?? args.ob;
  if (typeof patch !== "string") return "";
  const match = patch.match(/^\+\+\+ b\/(.+)$/mu);
  return match?.[1]?.trim() ?? "";
}

function pairToolEvents(events = []) {
  const pending = new Map();
  const calls = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] ?? {};
    const stage = String(event.stage ?? "").toLowerCase();
    const name = eventToolName(event);
    if (!name) continue;
    if (stage === "call") {
      const call = { event, name, index, resultText: "", resultIndex: -1 };
      calls.push(call);
      const queue = pending.get(name) ?? [];
      queue.push(call);
      pending.set(name, queue);
    } else if (stage === "result") {
      const queue = pending.get(name);
      const call = queue?.shift();
      if (call) {
        call.resultText = String(event.toolText ?? event.tool_text ?? "");
        call.resultIndex = index;
      }
    }
  }
  return calls;
}

export function assessSaddleCompletion(input = "", events = []) {
  const codeChange = isSaddleCodeChangeRequest(input);
  const action = !codeChange && isSaddleToolActionRequest(input);
  if (!codeChange && !action) {
    return { required: false, complete: true, missing: [], changedPaths: [], validation: null };
  }

  const calls = pairToolEvents(events);
  const completedCalls = calls.filter((call) => isSuccessfulToolCall(call, events) && !isPlanToolCall(call));
  const approvalRequired = calls.some((call) => {
    if (call.resultIndex < 0) return false;
    const resultEvent = events[call.resultIndex];
    const resultSentence = resultEvent?.resultSentence ?? resultEvent?.result_sentence;
    return resultSentence?.be === "ratify" || /\b(?:command approval|approve command|approval required)\b/iu.test(call.resultText);
  });
  const mutations = calls.filter((call) => {
    if (!isSuccessfulToolCall(call, events) || isPlanToolCall(call)) return false;
    const kind = toolKind(call.name);
    if (kind === "write") return true;
    if (kind === "repair") return !/\bcheck\b/iu.test(call.name);
    return isShellTool(call.name) && isMutatingCommand(commandText(call.event));
  });
  const lastMutation = mutations.reduce((latest, call) => Math.max(latest, call.index), -1);
  const validations = calls.filter((call) => isShellTool(call.name)
    && !isMutatingCommand(commandText(call.event))
    && isValidationCommand(commandText(call.event))
    && call.resultIndex > lastMutation
    && isSuccessfulToolCall(call, events)
    && eventCommandOutcome(events[call.resultIndex])?.exitCode === 0);
  const validation = validations.at(-1) ?? null;
  const lastActionShellCall = completedCalls.filter((call) => isShellTool(call.name)).at(-1);
  const missing = [];
  if (codeChange) {
    if (mutations.length === 0) missing.push("a successful file-changing tool call");
    if (!validation) missing.push("a successful relevant validation command after the final edit");
  } else {
    const requestedAction = resolveRequestedSaddleAction(input);
    const mutationRequested = SADDLE_MUTATING_ACTION.test(requestedAction);
    const successfulMutations = mutations.filter((call) => isShellTool(call.name) && isMutatingCommand(commandText(call.event)));
    if (completedCalls.length === 0) {
      missing.push("a successful tool call that performs or checks the requested action");
    } else if (mutationRequested && successfulMutations.length === 0) {
      missing.push("a successful command that performs the requested change");
    }
    if (mutationRequested && successfulMutations.length > 0 && !validation) {
      missing.push("a successful verification command after the final change");
    }
  }
  if (approvalRequired) missing.unshift("operator approval for the pending destructive command");
  return {
    required: true,
    kind: codeChange ? "code-change" : "action",
    approvalRequired,
    complete: missing.length === 0,
    missing,
    changedPaths: codeChange ? [...new Set(mutations.map((call) => changedPathForEvent(call.event)).filter(Boolean))] : [],
    changeTools: codeChange ? [...new Set(mutations.map((call) => call.name))] : [],
    actionTool: completedCalls.at(-1)?.name ?? "",
    actionCommand: lastActionShellCall ? commandText(lastActionShellCall.event) : "",
    validation: validation ? {
      command: commandText(validation.event),
      exitCode: eventCommandOutcome(events[validation.resultIndex])?.exitCode,
      output: validation.resultText.trim().slice(0, 240)
    } : null
  };
}

export function buildSaddleCompletionFollowup(input = "", assessment = {}) {
  const missing = Array.isArray(assessment.missing) ? assessment.missing : [];
  if (assessment.kind === "action") {
    return [
      "Harness completion check: the requested action still lacks completion evidence.",
      `Original request: ${String(input ?? "").trim()}`,
      `Missing evidence: ${missing.join("; ") || "use the available tool and report its result"}.`,
      "Continue the original task with the available tools; do not restate a promise as completion. For a requested change, perform it and run a verification command afterward. For a multi-step task, update the session plan as you make evidence-backed progress. If blocked, report the exact tool error and leave the task explicitly incomplete."
    ].join("\n");
  }
  return [
    "Harness completion check: the original code-change request is not complete yet.",
    `Original request: ${String(input ?? "").trim()}`,
    `Missing evidence: ${missing.join("; ") || "report the actual changed files and check"}.`,
    "Continue the original task using the available Pyash tools; do not merely restate your previous answer. Make the requested change, then run a relevant validation command after the last edit. If blocked, report the exact tool error and leave the task explicitly incomplete."
  ].join("\n");
}

export function formatSaddleCompletionEvidence(assessment = {}) {
  if (!assessment.required) return "";
  if (!assessment.complete) return `[saddle incomplete] ${assessment.missing.join("; ")}.`;
  if (assessment.kind === "action") {
    const command = assessment.actionCommand ? `; command: ${assessment.actionCommand}` : "";
    const verification = assessment.validation
      ? `; verification: ${assessment.validation.command}; exit: ${assessment.validation.exitCode}`
      : "";
    return `[saddle evidence] action complete${assessment.actionTool ? `; tool: ${assessment.actionTool}` : ""}${command}${verification}`;
  }
  const changed = assessment.changedPaths.length ? assessment.changedPaths.join(", ") : assessment.changeTools.join(", ");
  const output = assessment.validation.output ? `; output: ${assessment.validation.output}` : "";
  return `[saddle evidence] changed: ${changed}; validation: ${assessment.validation.command}; exit: ${assessment.validation.exitCode}${output}`;
}

export function buildSaddleWorktreeReviewCommand({
  trackedDiffLimit = 16000,
  untrackedDiffLimit = 10000,
  untrackedFileLimit = 2500
} = {}) {
  const bounded = (value, fallback, maximum) => {
    const number = Number(value);
    return Number.isSafeInteger(number) ? Math.max(1000, Math.min(maximum, number)) : fallback;
  };
  const trackedLimit = bounded(trackedDiffLimit, 16000, 24000);
  const stagedDiffLimit = Math.floor(trackedLimit / 2);
  const unstagedDiffLimit = trackedLimit - stagedDiffLimit;
  const untrackedLimit = bounded(untrackedDiffLimit, 10000, 16000);
  const fileLimit = bounded(untrackedFileLimit, 2500, 5000);
  const excludedPathspecs = [
    ".",
    "':(exclude,glob)**/.env'",
    "':(exclude,glob)**/.env.*'",
    "':(exclude,glob)**/secret.pya'",
    "':(exclude,glob)**/*.pem'",
    "':(exclude,glob)**/*.key'",
    "':(exclude,glob)**/*credentials*'",
    "':(exclude,glob)**/*token*'"
  ].join(" ");
  return [
    "set -e; printf '%s\\n' '[worktree root]'; git rev-parse --show-toplevel",
    "printf '%s\\n' '[worktree status]'",
    "git -c core.quotePath=true status --short --untracked-files=all",
    "printf '%s\\n' '[staged diff summary]'",
    `git diff --cached --stat -- ${excludedPathspecs}`,
    "printf '%s\\n' '[unstaged diff summary]'",
    `git diff --stat -- ${excludedPathspecs}`,
    "printf '%s\\n' '[staged diff excerpt; sensitive config paths omitted]'",
    `git diff --cached --no-ext-diff --unified=3 -- ${excludedPathspecs} | head -c ${stagedDiffLimit} || true`,
    "printf '%s\\n' '[unstaged diff excerpt; sensitive config paths omitted]'",
    `git diff --no-ext-diff --unified=3 -- ${excludedPathspecs} | head -c ${unstagedDiffLimit} || true`,
    "printf '%s\\n' '[untracked text diff excerpts; sensitive paths omitted]'",
    `git ls-files -z --others --exclude-standard | while IFS= read -r -d '' file; do case "$file" in .env|.env.*|*/.env|*/.env.*|secret.pya|*/secret.pya|*.pem|*.key|*credentials*|*token*) printf '[sensitive untracked path omitted]\\n' ;; *) printf '\\n--- untracked: %q ---\\n' "$file"; git diff --no-index --no-ext-diff --unified=3 /dev/null "$file" | head -c ${fileLimit} || true ;; esac; done | head -c ${untrackedLimit} || true`,
    "printf '%s\\n' '[diff excerpts are bounded; review includes any pre-existing worktree changes]'"
  ].join("; ");
}

export function formatSaddleWorktreeReviewFailure(error = "") {
  const text = String(error?.message ?? error ?? "").trim();
  const stderr = text.match(/(?:^|\n)stderr:\s*([\s\S]*)$/u)?.[1]
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && line !== "<empty>");
  const status = text.match(/command defective:\s*status=(\d+)/u)?.[1];
  const detail = stderr || (status ? `review command exited ${status}` : "review command failed");
  return detail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .slice(0, 240);
}

export async function runSaddleTurnWithEvidence({ input, runTurn, onToolCall, onAssistantDelta, onTurnStart, onFollowup, onReview } = {}) {
  if (typeof runTurn !== "function") throw new TypeError("runSaddleTurnWithEvidence requires runTurn");
  const events = [];
  const invoke = async (turnInput) => {
    await onTurnStart?.();
    return runTurn({
      input: turnInput,
      onAssistantDelta,
      onToolCall: async (event) => {
        events.push(event);
        return onToolCall?.(event);
      }
    });
  };
  let result = await invoke(input);
  let assessment = assessSaddleCompletion(input, events);
  let retried = false;
  let completionPasses = 0;
  let retryError = "";
  while (assessment.required && !assessment.complete && !assessment.approvalRequired && completionPasses < 3) {
    retried = true;
    completionPasses += 1;
    await onFollowup?.(assessment);
    try {
      result = await invoke(buildSaddleCompletionFollowup(input, assessment));
    } catch (error) {
      retryError = String(error?.message ?? error);
      break;
    }
    assessment = assessSaddleCompletion(input, events);
  }
  let worktreeReview = null;
  let worktreeReviewError = "";
  if (assessment.required && assessment.changeTools.length && typeof onReview === "function") {
    try {
      worktreeReview = await onReview({ assessment, events });
    } catch (error) {
      worktreeReviewError = String(error?.message ?? error);
    }
  }
  return { result, assessment, retried, completionPasses, retryError, events, worktreeReview, worktreeReviewError };
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function layoutSaddleInput({ value = "", cursor, label = "pyash> ", columns = 80 } = {}) {
  const text = String(value ?? "");
  const prefix = String(label ?? "");
  const cursorIndex = Math.max(0, Math.min(text.length, Number.isInteger(cursor) ? cursor : text.length));
  // Leave the terminal's final column unused so redraws never trigger implicit autowrap.
  const maxColumn = Math.max(1, Math.floor(Number(columns) || 80) - 1);
  const lines = [""];
  let row = 0;
  let column = 0;
  let cursorPosition = null;
  const rendered = `${prefix}${text}`;
  const renderedCursor = prefix.length + cursorIndex;

  for (let index = 0; index < rendered.length; index += 1) {
    const character = rendered[index];
    if (character === "\n") {
      if (index === renderedCursor) cursorPosition = { row, column };
      lines.push("");
      row += 1;
      column = 0;
      if (index + 1 === renderedCursor) cursorPosition = { row, column };
      continue;
    }
    if (column >= maxColumn) {
      lines.push("");
      row += 1;
      column = 0;
    }
    if (index === renderedCursor) cursorPosition = { row, column };
    lines[row] += character;
    column += 1;
  }

  if (renderedCursor === rendered.length) cursorPosition = { row, column };
  return {
    lines,
    rowCount: lines.length,
    cursorRow: cursorPosition?.row ?? row,
    cursorColumn: cursorPosition?.column ?? column
  };
}

export function normalizeSaddleModel(value, fallback = "qwen3.5:9b") {
  return normalizeText(value) || fallback;
}

export function normalizeSaddleBackend(value, fallback = "ollama") {
  const normalized = normalizeText(value).toLowerCase();
  const aliases = new Map([
    ["ollama command mind", "ollama"],
    ["openai command mind", "openai"],
    ["litellm command mind", "litellm"],
    ["openrouter command mind", "openrouter"],
    ["minimax command mind", "minimax"],
    ["zai command mind", "zai"],
    ["vllm command mind", "vllm"],
    ["strata command mind", "strata"]
  ]);
  return aliases.get(normalized) || normalized || fallback;
}

export function normalizeSaddleHost(value, fallback = "http://localhost:11434") {
  return normalizeText(value) || fallback;
}

export function normalizeSaddleThinkSelection(value, backend) {
  const selected = normalizeText(value).toLowerCase();
  const provider = normalizeSaddleBackend(backend);
  if (provider === "ollama") {
    if (["off", "none", "false", "0"].includes(selected)) {
      return { value: "off", think: false, reasoningEffort: null };
    }
    if (["on", "think", "true", "1"].includes(selected)) {
      return { value: "on", think: true, reasoningEffort: null };
    }
    return null;
  }
  if (provider === "strata") {
    const effort = selected === "off" ? "none" : selected === "on" ? "high" : selected;
    if (["none", "low", "medium", "high"].includes(effort)) {
      return { value: effort, think: null, reasoningEffort: effort };
    }
  }
  if (provider === "minimax") {
    if (["low", "medium", "high", "xhigh", "max"].includes(selected)) {
      return { value: selected, think: null, reasoningEffort: selected };
    }
  }
  if (provider === "zai") {
    if (["low", "high", "max"].includes(selected)) {
      return { value: selected, think: null, reasoningEffort: selected };
    }
  }
  return null;
}

export function resolveSaddleThinkSetting({ backend, savedEffort = "", configuredEffort = "" } = {}) {
  const provider = normalizeSaddleBackend(backend);
  for (const value of [savedEffort, configuredEffort]) {
    const setting = normalizeSaddleThinkSelection(value, provider);
    if (setting) return setting;
  }
  return provider === "zai"
    ? normalizeSaddleThinkSelection(DEFAULT_ZAI_CODING_REASONING_EFFORT, provider)
    : null;
}

function mindFieldValue(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return normalizeText(value.name ?? value.text ?? value.filename);
}

export function resolveSaddleMindProfile({
  mindName,
  profile,
  defaultBackend = "ollama",
  defaultModel = "qwen3.5:9b",
  defaultHost = "http://localhost:11434",
  hostForBackend = () => defaultHost
} = {}) {
  const name = normalizeText(mindName);
  if (!name || profile?.be !== "mind") throw new Error(`Pyash mind not found: ${name || "(empty)"}`);
  const declaredBackend = mindFieldValue(profile.fromstate);
  const backend = normalizeSaddleBackend(declaredBackend || defaultBackend);
  const model = normalizeSaddleModel(
    mindFieldValue(profile.as) || (backend === "zai" ? "glm-5.3-flash" : backend === "minimax" ? "MiniMax-M3.1-Flash" : defaultModel)
  );
  const declaredHost = mindFieldValue(profile.from);
  const host = normalizeSaddleHost(declaredHost || hostForBackend(backend), defaultHost);
  return { mindName: name, backend, model, host };
}

export function listSaddleMindNames({ minds = [], activeMindName = "coding saddle" } = {}) {
  const active = normalizeText(activeMindName).toLowerCase();
  const names = [...new Set((Array.isArray(minds) ? minds : [])
    .filter((fact) => fact?.be === "mind" && fact?.su?.name)
    .filter((fact) => normalizeText(fact.su.name).toLowerCase() !== active)
    .filter((fact) => normalizeText(fact.su.name).toLowerCase() === "mind" || mindFieldValue(fact.fromstate))
    .map((fact) => normalizeText(fact.su.name)))];
  return names.sort((left, right) => {
    if (left.toLowerCase() === "mind") return -1;
    if (right.toLowerCase() === "mind") return 1;
    return left.localeCompare(right);
  });
}

const SADDLE_BACKEND_LABELS = new Map([
  ["ollama", "Ollama"],
  ["strata", "Strata"],
  ["zai", "Z.AI"],
  ["openai", "OpenAI"],
  ["minimax", "MiniMax"],
  ["openrouter", "OpenRouter"],
  ["litellm", "LiteLLM"],
  ["vllm", "vLLM"]
]);

const SADDLE_BACKEND_ORDER = ["ollama", "strata", "zai", "openai", "minimax", "openrouter", "litellm", "vllm"];

export function listSaddleBackendOptions({
  minds = [],
  defaultBackend = "ollama",
  defaultModel = "qwen3.5:9b",
  hostForBackend = () => "http://localhost:11434",
  currentBackend = "",
  currentMindName = "",
  currentModel = "",
  currentHost = ""
} = {}) {
  const profilesByName = new Map();
  for (const fact of Array.isArray(minds) ? minds : []) {
    if (fact?.be !== "mind" || !fact?.su?.name) continue;
    profilesByName.set(normalizeText(fact.su.name).toLowerCase(), fact);
  }

  const profiles = [...profilesByName.values()]
    .filter((profile) => normalizeText(profile.su.name).toLowerCase() === "mind" || mindFieldValue(profile.fromstate))
    .map((profile) => resolveSaddleMindProfile({
      mindName: profile.su.name,
      profile,
      defaultBackend,
      defaultModel,
      hostForBackend
    }));

  const normalizedCurrentBackend = normalizeSaddleBackend(currentBackend, "");
  if (normalizedCurrentBackend && !profiles.some((profile) => profile.backend === normalizedCurrentBackend)) {
    profiles.push({
      mindName: normalizeText(currentMindName) || normalizedCurrentBackend,
      backend: normalizedCurrentBackend,
      model: normalizeSaddleModel(currentModel, defaultModel),
      host: normalizeSaddleHost(currentHost || hostForBackend(normalizedCurrentBackend))
    });
  }

  const byBackend = new Map();
  for (const profile of profiles) {
    const backend = normalizeSaddleBackend(profile.backend, "");
    if (!backend) continue;
    const priority = (profile.mindName.toLowerCase() === normalizeText(currentMindName).toLowerCase() && backend === normalizedCurrentBackend ? 0 : 10)
      + (profile.mindName.toLowerCase() === backend ? 0 : 1)
      + (profile.mindName.toLowerCase() === "mind" ? 0 : 1);
    const existing = byBackend.get(backend);
    if (!existing || priority < existing.priority) byBackend.set(backend, { ...profile, backend, priority });
  }

  return [...byBackend.values()]
    .sort((left, right) => {
      const leftOrder = SADDLE_BACKEND_ORDER.indexOf(left.backend);
      const rightOrder = SADDLE_BACKEND_ORDER.indexOf(right.backend);
      return (leftOrder < 0 ? SADDLE_BACKEND_ORDER.length : leftOrder)
        - (rightOrder < 0 ? SADDLE_BACKEND_ORDER.length : rightOrder)
        || left.backend.localeCompare(right.backend);
    })
    .map(({ priority, ...profile }) => ({
      ...profile,
      value: profile.backend,
      label: SADDLE_BACKEND_LABELS.get(profile.backend) || profile.backend,
      current: profile.backend === normalizedCurrentBackend
    }));
}

export function parseSaddleMindCommand(value) {
  const input = normalizeText(value);
  if (/^\/mind$/i.test(input)) return { type: "list" };
  const match = input.match(/^\/mind\s+(.+)$/i);
  return match ? { type: "select", mindName: normalizeText(match[1]) } : null;
}

export function resolveSaddleModelSelection(value, models = []) {
  const selected = resolveSaddleModelOption(value, models);
  return selected?.model || "";
}

export function resolveSaddleModelOption(value, models = []) {
  const input = normalizeText(value);
  const choices = Array.isArray(models)
    ? models.map((entry) => typeof entry === "string" ? { model: normalizeText(entry), value: normalizeText(entry) } : entry)
      .filter((entry) => normalizeText(entry?.model))
    : [];
  if (/^\d+$/.test(input)) {
    const index = Number.parseInt(input, 10);
    return index >= 1 && index <= choices.length ? choices[index - 1] : null;
  }
  const exact = choices.find((entry) => entry.value === input || entry.model === input || entry.label === input);
  if (exact) return exact;
  const insensitive = choices.find((entry) => [entry.value, entry.model, entry.label]
    .filter(Boolean)
    .some((candidate) => String(candidate).toLowerCase() === input.toLowerCase()));
  return insensitive || null;
}

export async function discoverSaddleModels({
  backend,
  host,
  housekeeperUrl = "",
  currentModel = "",
  fallbackModels = [],
  apiKey,
  fetchFn = globalThis.fetch,
  timeoutMs = 4000
} = {}) {
  const normalizedBackend = normalizeSaddleBackend(backend);
  const normalizedHost = normalizeSaddleHost(host);
  const configured = [currentModel, ...fallbackModels].map(normalizeText).filter(Boolean);
  if (normalizedBackend === "zai") {
    const discovered = await fetchZaiCodingPlanModels({
      host: normalizedHost,
      apiKey,
      fetchFn,
      timeoutMs
    });
    return {
      models: [...new Set([...configured, ...discovered.models])],
      catalogModels: discovered.models,
      available: discovered.ok,
      error: discovered.error || null
    };
  }
  if (normalizedBackend === "minimax") {
    const discovered = await fetchMiniMaxModels({
      host: normalizedHost,
      apiKey,
      fetchFn,
      timeoutMs
    });
    return {
      models: [...new Set([...configured, ...discovered.models])],
      catalogModels: discovered.models,
      available: discovered.ok,
      error: discovered.error || null
    };
  }
  if (["openai", "litellm", "openrouter", "vllm"].includes(normalizedBackend)) {
    return { models: [...new Set(configured)], available: false, error: "enter a model ID supported by the selected mind" };
  }
  if (typeof fetchFn !== "function") {
    return { models: [...new Set(configured)], available: false, error: "model discovery is unavailable" };
  }
  const localBackend = ["ollama", "strata"].includes(normalizedBackend);
  if (!localBackend) {
    return {
      models: [...new Set(configured)],
      available: false,
      error: `model discovery is unsupported for backend ${normalizedBackend || "(empty)"}`
    };
  }
  const catalogHost = normalizeText(housekeeperUrl).replace(/\/+$/u, "");
  if (!catalogHost) {
    return {
      models: [...new Set(configured)],
      available: false,
      error: "GPU Housekeeper URL is required for local model discovery"
    };
  }
  const endpoint = `${catalogHost}/runtime/${normalizedBackend}/models`;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && Number.isFinite(Number(timeoutMs))
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;
  try {
    const response = await fetchFn(endpoint, {
      signal: controller?.signal
    });
    if (!response?.ok) throw new Error(`model catalogue returned HTTP ${response?.status ?? "unknown"}`);
    const payload = await response.json();
    const entries = normalizedBackend === "strata"
      ? (Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [])
      : (Array.isArray(payload?.models) ? payload.models : []);
    const discovered = entries.map((entry) => {
      if (typeof entry === "string") return entry;
      return entry?.id ?? entry?.name ?? entry?.model ?? "";
    }).map(normalizeText).filter(Boolean);
    const models = [...new Set([...configured, ...discovered])];
    return {
      models,
      modelCatalog: normalizedBackend === "ollama" ? entries : [],
      available: true,
      error: models.length ? null : "no models are available"
    };
  } catch (error) {
    return {
      models: [...new Set(configured)],
      available: false,
      error: String(error?.message ?? error)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function formatSaddleModelPicker({ models = [], currentModel = "", currentBackend = "", error = "" } = {}) {
  const choices = Array.isArray(models)
    ? models.map((entry) => typeof entry === "string" ? { model: normalizeText(entry), value: normalizeText(entry) } : entry)
      .filter((entry) => normalizeText(entry?.model))
    : [];
  const lines = ["available models:"];
  choices.forEach((entry, index) => {
    const model = normalizeText(entry.model);
    const backend = normalizeText(entry.backend).toLowerCase();
    const label = normalizeText(entry.label)
      || (backend && backend !== "ollama" ? `${backend}: ${model}` : model);
    const host = normalizeText(entry.host);
    const location = backend && !["ollama", "strata"].includes(backend) && host ? ` @ ${host}` : "";
    const marker = model === normalizeText(currentModel)
      && (!normalizeText(currentBackend) || !backend || backend === normalizeText(currentBackend).toLowerCase())
      ? " (current)"
      : "";
    lines.push(`${index + 1}. ${label}${location}${marker}`);
  });
  if (error) lines.push(`discovery: ${error}`);
  lines.push("Enter a number or exact model name; Ctrl+C cancels.");
  return lines.join("\n");
}

export function formatSaddleBackendPicker({ backends = [] } = {}) {
  const choices = Array.isArray(backends) ? backends : [];
  const lines = ["available backends:"];
  choices.forEach((entry, index) => {
    const label = normalizeText(entry?.label || entry?.backend);
    const model = normalizeText(entry?.model);
    const current = entry?.current ? " (current)" : "";
    lines.push(`${index + 1}. ${label}${model ? ` — ${model}` : ""}${current}`);
  });
  lines.push("Enter a number or backend name; Ctrl+C cancels.");
  return lines.join("\n");
}

export function buildSaddleMindSentence({
  input,
  model,
  backend,
  host,
  contextWindow,
  think,
  reasoningEffort,
  mindName = "coding saddle",
  toolMapName = "saddle command tools",
  sessionName = "coding",
  sessionFile = "",
  historyWindow = 50,
  stream = true
} = {}) {
  const requestedHistoryWindow = Number(historyWindow);
  const resolvedHistoryWindow = Number.isSafeInteger(requestedHistoryWindow) && requestedHistoryWindow >= 0
    ? requestedHistoryWindow
    : 50;
  const sentence = {
    mood: "do",
    be: "write",
    for: { name: normalizeText(mindName) || "coding saddle" },
    ob: { text: String(input ?? "") },
    to: { name: "text" },
    with: { name: normalizeText(toolMapName) || "saddle command tools" },
    fromstate: { text: normalizeSaddleBackend(backend) },
    from: { text: normalizeSaddleHost(host) },
    fromtext: sessionFile
      ? { filename: path.resolve(String(sessionFile)) }
      : { name: `session name ${normalizeText(sessionName) || "coding"}` },
    by: { num: resolvedHistoryWindow },
    // The model is persisted in the mind configuration fact; the sentence stays canonical Pyash shape.
  };
  if (stream) sentence.vyah = { ve: { type: "name", values: ["stream"] } };
  if (Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0) {
    sentence.contextWindow = Number(contextWindow);
  }
  if (typeof think === "boolean") sentence.think = think;
  if (["none", "low", "medium", "high", "xhigh", "max"].includes(String(reasoningEffort ?? "").trim().toLowerCase())) {
    sentence.reasoningEffort = String(reasoningEffort).trim().toLowerCase();
  }
  return sentence;
}

export function formatSaddleStatus({
  mindName = "mind",
  model,
  backend = "",
  housekeeperUrl = "",
  contextWindow,
  thinkMode,
  host,
  cwd,
  queue,
  busy = false,
  session = "coding"
} = {}) {
  const queueValue = queue?.available === false
    ? "unavailable"
    : queue && typeof queue === "object" && (queue.queuedCount !== undefined || queue.runningCount !== undefined)
      ? `${Number(queue.queuedCount ?? 0) || 0} queued, ${Number(queue.runningCount ?? 0) || 0} running`
      : queue && typeof queue === "object"
        ? (Number(queue.total ?? queue.runtime ?? queue.input ?? queue.queueDepth ?? 0) || 0)
        : Number(queue ?? 0) || 0;
  const localBackend = ["ollama", "strata"].includes(normalizeSaddleBackend(backend));
  return [
    `mind: ${normalizeText(mindName) || "mind"}`,
    `model: ${normalizeSaddleModel(model)}`,
    ...(Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0
      ? [`context: ${Number(contextWindow).toLocaleString("en-CA")} tokens`]
      : []),
    ...(normalizeText(thinkMode)
      ? [normalizeSaddleBackend(backend) === "ollama"
        ? `thinking: ${normalizeText(thinkMode)}`
        : `reasoning effort: ${normalizeText(thinkMode)}`]
      : []),
    ...(localBackend
      ? [`route: GPU Housekeeper ${normalizeText(housekeeperUrl) || "(not configured)"}`]
      : [`host: ${normalizeSaddleHost(host)}`]),
    `session: ${normalizeText(session) || "coding"}`,
    `cwd: ${path.resolve(String(cwd || process.cwd()))}`,
    `gpu queue: ${queueValue}`,
    `state: ${busy ? "running" : "ready"}`
  ].join(" | ");
}

function isShiftEnterSequence(value) {
  return value === "\u001b[13;2u"
    || value === "\u001b[27;2;13~"
    || value === "\u001b[27;2;13;~";
}

function isControlEnterSequence(value) {
  return value === "\u001b[13;5u"
    || value === "\u001b[27;5;13~"
    || value === "\u001b[27;5;13;~";
}

function isCsiFinal(value) {
  if (value.startsWith("\u001b[")) {
    return value.length > 2 && /[\x40-\x7e]$/.test(value.slice(2));
  }
  return value.length > 1;
}

export function createSaddleInputDecoder({
  onSubmit,
  onQueue,
  shouldQueue,
  onCancel,
  onExit,
  onChange,
  onScroll,
  onAutocomplete
} = {}) {
  const state = { value: "", cursor: 0 };
  let escape = "";
  let escapeTimer = null;
  let pasting = false;
  let pasteBuffer = "";
  let completion = null;

  const resetCompletion = () => { completion = null; };

  const changed = () => {
    if (typeof onChange === "function") onChange({ ...state });
  };
  const insert = (text) => {
    const value = String(text ?? "");
    resetCompletion();
    state.value = `${state.value.slice(0, state.cursor)}${value}${state.value.slice(state.cursor)}`;
    state.cursor += value.length;
    changed();
  };
  const submit = () => {
    const value = state.value;
    resetCompletion();
    state.value = "";
    state.cursor = 0;
    changed();
    if (typeof onSubmit === "function") {
      Promise.resolve(onSubmit(value)).catch(() => undefined);
    }
  };
  const queue = () => {
    const value = state.value;
    if (!value.trim() || typeof onQueue !== "function") return false;
    let accepted = false;
    try {
      accepted = onQueue(value) !== false;
    } catch {
      return false;
    }
    if (!accepted) return false;
    resetCompletion();
    state.value = "";
    state.cursor = 0;
    changed();
    return true;
  };
  const autocomplete = () => {
    let choices = [];
    let index = 0;
    if (completion && state.value === completion.value && state.cursor === completion.cursor) {
      choices = completion.choices;
      index = (completion.index + 1) % choices.length;
    } else {
      resetCompletion();
      try {
        const values = onAutocomplete?.({ ...state });
        choices = (Array.isArray(values) ? values : [])
          .map((choice) => typeof choice === "string"
            ? { value: choice, cursor: choice.length }
            : { value: String(choice?.value ?? ""), cursor: Number(choice?.cursor) })
          .filter((choice) => choice.value);
      } catch {
        choices = [];
      }
    }
    if (!choices.length) return;
    const selected = choices[index];
    state.value = selected.value;
    state.cursor = Math.max(0, Math.min(state.value.length,
      Number.isInteger(selected.cursor) ? selected.cursor : state.value.length));
    completion = { choices, index, value: state.value, cursor: state.cursor };
    changed();
  };
  const handleEscape = (sequence) => {
    if (sequence === "\u001b[200~") {
      pasting = true;
      pasteBuffer = "";
      return;
    }
    if (isControlEnterSequence(sequence)) {
      submit();
      return;
    }
    if (isShiftEnterSequence(sequence)) {
      insert("\n");
      return;
    }
    if (sequence === "\u001b[D") {
      resetCompletion();
      state.cursor = Math.max(0, state.cursor - 1);
      changed();
      return;
    }
    if (sequence === "\u001b[C") {
      resetCompletion();
      state.cursor = Math.min(state.value.length, state.cursor + 1);
      changed();
      return;
    }
    if (sequence === "\u001b[H" || sequence === "\u001b[1~") {
      resetCompletion();
      state.cursor = 0;
      changed();
      return;
    }
    if (sequence === "\u001b[F" || sequence === "\u001b[4~") {
      resetCompletion();
      state.cursor = state.value.length;
      changed();
      return;
    }
    if (sequence === "\u001b[3~") {
      if (state.cursor < state.value.length) {
        resetCompletion();
        state.value = `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`;
        changed();
      }
      return;
    }
    if (sequence === "\u001b[5~") {
      onScroll?.(-1);
      return;
    }
    if (sequence === "\u001b[6~") {
      onScroll?.(1);
    }
  };
  const handleChar = (char) => {
    if (pasting) {
      pasteBuffer += char;
      if (pasteBuffer.endsWith("\u001b[201~")) {
        const pastedText = pasteBuffer.slice(0, -"\u001b[201~".length);
        pasteBuffer = "";
        pasting = false;
        insert(pastedText
          .replace(/\r\n?/gu, "\n")
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ""));
      }
      return;
    }
    if (escape) {
      if (escapeTimer) clearTimeout(escapeTimer);
      escapeTimer = null;
      escape += char;
      if (isCsiFinal(escape)) {
        const sequence = escape;
        escape = "";
        handleEscape(sequence);
      } else if (escape.length > 32) {
        escape = "";
      }
      return;
    }
    if (char === "\u001b") {
      escape = char;
      escapeTimer = setTimeout(() => {
        escapeTimer = null;
        if (escape !== "\u001b") return;
        escape = "";
        onCancel?.();
      }, 80);
      escapeTimer.unref?.();
      return;
    }
    if (char === "\u0003") {
      if (typeof onCancel === "function") onCancel();
      return;
    }
    if (char === "\u0004") {
      if (typeof onExit === "function") onExit();
      return;
    }
    if (char === "\t") {
      if (shouldQueue?.({ ...state }) === true && queue()) return;
      autocomplete();
      return;
    }
    if (char === "\r") {
      submit();
      return;
    }
    if (char === "\n") {
      insert("\n");
      return;
    }
    if (char === "\u007f" || char === "\b") {
      if (state.cursor > 0) {
        resetCompletion();
        state.value = `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`;
        state.cursor -= 1;
        changed();
      }
      return;
    }
    if (char >= " ") insert(char);
  };

  return {
    feed(chunk) {
      for (const char of String(chunk ?? "")) handleChar(char);
    },
    getState() {
      return { ...state };
    },
    setValue(value) {
      resetCompletion();
      state.value = String(value ?? "");
      state.cursor = state.value.length;
      changed();
    }
  };
}

export function saddleToolEventLabel(event = {}) {
  const stage = normalizeText(event.stage).toUpperCase();
  const tool = normalizeText(event.toolName) || "tool";
  if (!stage) return `[tool] ${tool}`;
  const label = stage === "CALL" ? "tool call" : stage === "RESULT" ? "tool result" : stage === "RATIFY" ? "tool approval" : `tool ${stage.toLowerCase()}`;
  const command = String(event.toolSentence?.ob?.text ?? event.toolSentence?.ob?.wo ?? "").trim();
  if (tool.toLowerCase() !== "bash" || stage !== "CALL" || !command) return `[${label}] ${tool}`;
  const oneLine = command.replace(/\s+/gu, " ");
  const snippet = oneLine.length > 110
    ? `${oneLine.slice(0, 90)}…[${oneLine.length - 90} characters omitted]`
    : oneLine;
  return `[${label}] ${tool}: ${snippet}`;
}

function previewDiagnosticValue(value, maximum = 180) {
  const text = String(value ?? "").trim();
  if (!text) return "<empty>";
  const oneLine = text.replace(/\s+/gu, " ");
  if (oneLine.length <= maximum) return oneLine;
  return `${oneLine.slice(0, maximum)}…[${oneLine.length - maximum} characters omitted]`;
}

export function saddleToolEventPreview(event = {}) {
  const label = saddleToolEventLabel(event);
  const stage = normalizeText(event.stage).toUpperCase();
  const tool = normalizeText(event.toolName).toLowerCase();
  const toolText = String(event.toolText ?? "").trim();
  if (tool !== "bash" || stage !== "RESULT") {
    return `${label}${toolText ? `: ${toolText.slice(0, 400)}` : ""}`;
  }

  const result = event.resultSentence;
  if (result?.be === "ratify") {
    const approval = formatRatifyToolResult(event.toolName, result);
    if (approval) return `${label}\n${approval}`;
  }
  const raw = result?.ob?.raw && typeof result.ob.raw === "object" ? result.ob.raw : {};
  if (result?.be === "command") {
    return [
      label,
      `exit code: ${Number.isInteger(raw.status) ? raw.status : 0}`,
      raw.cwd ? `working directory: ${raw.cwd}` : "",
      `stdout: ${previewDiagnosticValue(raw.stdout ?? result.ob?.text)}`,
      `stderr: ${previewDiagnosticValue(raw.stderr)}`
    ].filter(Boolean).join("\n");
  }
  if (result?.be !== "error") return `${label}${toolText ? `: ${toolText.slice(0, 400)}` : ""}`;

  const errorText = String(result.ob?.text ?? "command failed").trim();
  const lines = [label, errorText.split("\n")[0] || "command failed"];
  if (Number.isInteger(raw.status)) lines.push(`exit code: ${raw.status}`);
  if (raw.signal) lines.push(`signal: ${raw.signal}`);
  if (raw.cwd) lines.push(`working directory: ${raw.cwd}`);
  if (raw.processStarted === false) lines.push("execution: blocked before process launch");
  if (Array.isArray(raw.outsideRoots) && raw.outsideRoots.length) lines.push(`blocked path: ${raw.outsideRoots.join(", ")}`);
  if (Array.isArray(raw.writableRoots) && raw.writableRoots.length) lines.push(`writable roots: ${raw.writableRoots.join(", ")}`);
  if (raw.stdout !== undefined) lines.push(`stdout: ${previewDiagnosticValue(raw.stdout)}`);
  if (raw.stderr !== undefined) lines.push(`stderr: ${previewDiagnosticValue(raw.stderr)}`);
  if (raw.launchError) lines.push(`launch error: ${previewDiagnosticValue(raw.launchError)}`);
  if (raw.stdinError) lines.push(`stdin error: ${previewDiagnosticValue(raw.stdinError)}`);
  if (raw.processStarted === false) {
    lines.push(
      "stdout: unavailable because the command was blocked before execution",
      "stderr: unavailable because the command was blocked before execution"
    );
  }
  return lines.join("\n");
}

export function startSaddleProgress({
  backend,
  model,
  onProgress,
  intervalMs = 5000,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (typeof onProgress !== "function") return () => {};
  const startedAt = now();
  const timer = setIntervalFn(() => {
    const elapsedSeconds = Math.max(1, Math.floor((now() - startedAt) / 1000));
    onProgress(`working... ${elapsedSeconds}s elapsed (${normalizeText(backend) || "model"} / ${normalizeText(model) || "unknown"})`);
  }, Math.max(250, Number(intervalMs) || 5000));
  timer?.unref?.();
  return () => clearIntervalFn(timer);
}
