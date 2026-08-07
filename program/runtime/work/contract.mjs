import { buildWorkCheckpoint } from "./checkpoint.mjs";

const WORK_STATUSES = [
  "ready",
  "planning",
  "implementing",
  "reviewing",
  "revision",
  "blocked",
  "usage-limited",
  "accepted",
  "failed"
];

const WORK_TRANSITIONS = new Map([
  ["ready", new Set(["planning", "blocked", "failed"])],
  ["planning", new Set(["implementing", "revision", "blocked", "usage-limited", "failed"])],
  ["implementing", new Set(["reviewing", "revision", "blocked", "usage-limited", "failed"])],
  ["reviewing", new Set(["accepted", "revision", "blocked", "usage-limited", "failed"])],
  ["revision", new Set(["implementing", "blocked", "usage-limited", "failed"])],
  ["blocked", new Set(["ready", "planning", "failed"])],
  ["usage-limited", new Set([
    "ready",
    "planning",
    "implementing",
    "reviewing",
    "revision",
    "blocked",
    "failed"
  ])],
  ["accepted", new Set()],
  ["failed", new Set()]
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeSegment(value, fallback = "") {
  const text = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

function normalizeIso(value, fallback = new Date().toISOString()) {
  const text = normalizeText(value);
  if (text && Number.isFinite(Date.parse(text))) return new Date(text).toISOString();
  return String(fallback);
}

function normalizeCount(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(number));
}

function normalizePriority(value, fallback = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.trunc(Number(fallback) || 100);
  return Math.trunc(number);
}

function normalizeOptionalIso(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return normalizeIso(text, "");
}

export const WORK_STATUS_NAMES = Object.freeze([...WORK_STATUSES]);

export function normalizeWorkTaskId(value) {
  return normalizeSegment(value, "");
}

export function normalizeWorkStatus(value, fallback = "ready") {
  const status = normalizeText(value).toLowerCase();
  return WORK_STATUSES.includes(status) ? status : fallback;
}

export function buildWorkTask(input = {}) {
  return {
    taskId: normalizeWorkTaskId(input.taskId ?? input.handleId),
    owner: normalizeText(input.owner || input.agentName),
    kind: normalizeSegment(input.kind, "engineering"),
    title: normalizeText(input.title),
    priority: normalizePriority(input.priority, 100),
    status: normalizeWorkStatus(input.status, "ready"),
    queuedAt: normalizeIso(input.queuedAt),
    startedAt: normalizeOptionalIso(input.startedAt),
    finishedAt: normalizeOptionalIso(input.finishedAt),
    retryCount: normalizeCount(input.retryCount, 0),
    retryMax: normalizeCount(input.retryMax, 0),
    acceptanceText: normalizeText(input.acceptanceText || input.acceptance),
    promptText: normalizeText(input.promptText || input.prompt),
    contextText: normalizeText(input.contextText || input.context),
    solThreadId: normalizeText(input.solThreadId),
    lunaThreadId: normalizeText(input.lunaThreadId),
    previousStatus: normalizeWorkStatus(input.previousStatus, "ready"),
    message: normalizeText(input.message),
    result: normalizeText(input.result),
    error: normalizeText(input.error),
    payloadSentence: input.payloadSentence && typeof input.payloadSentence === "object"
      ? input.payloadSentence
      : null,
    workSpec: input.workSpec && typeof input.workSpec === "object" && !Array.isArray(input.workSpec)
      ? { ...input.workSpec }
      : {},
    checkpoint: buildWorkCheckpoint(input.checkpoint)
  };
}

export function assertWorkTask(value = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("work task defective: task must be an object");
  }
  if (!normalizeWorkTaskId(value.taskId)) {
    throw new Error("work task defective: missing task id");
  }
  if (!normalizeText(value.owner)) {
    throw new Error("work task defective: missing owner");
  }
  if (!normalizeText(value.kind)) {
    throw new Error("work task defective: missing kind");
  }
  if (!normalizeText(value.title)) {
    throw new Error("work task defective: missing title");
  }
  if (!WORK_STATUSES.includes(normalizeText(value.status).toLowerCase())) {
    throw new Error("work task defective: invalid status");
  }
  if (!normalizeText(value.queuedAt) || !Number.isFinite(Date.parse(String(value.queuedAt)))) {
    throw new Error("work task defective: invalid queued at");
  }
  if (!normalizeText(value.acceptanceText)) {
    throw new Error("work task defective: missing acceptance criteria");
  }
  if (!normalizeText(value.promptText)) {
    throw new Error("work task defective: missing prompt");
  }
  for (const key of ["startedAt", "finishedAt"]) {
    const text = normalizeText(value[key]);
    if (text && !Number.isFinite(Date.parse(text))) {
      throw new Error(`work task defective: invalid ${key}`);
    }
  }
  for (const key of ["retryCount", "retryMax", "priority"]) {
    if (!Number.isFinite(Number(value[key])) || Math.trunc(Number(value[key])) !== Number(value[key])) {
      throw new Error(`work task defective: invalid ${key}`);
    }
  }
  if (Number(value.retryCount) < 0 || Number(value.retryMax) < 0) {
    throw new Error("work task defective: retry counts must be non-negative");
  }
  if (value.payloadSentence != null && typeof value.payloadSentence !== "object") {
    throw new Error("work task defective: payload sentence must be an object");
  }
  if (!value.workSpec || typeof value.workSpec !== "object" || Array.isArray(value.workSpec)) {
    throw new Error("work task defective: work spec must be a map");
  }
}

export function canTransitionWorkStatus(from, to) {
  const source = normalizeWorkStatus(from, "");
  const target = normalizeWorkStatus(to, "");
  if (!source || !target) return false;
  if (source === target) return true;
  return WORK_TRANSITIONS.get(source)?.has(target) === true;
}

export function transitionWorkTask(task, nextStatus, {
  message = "",
  result = "",
  error = "",
  now = new Date()
} = {}) {
  const current = buildWorkTask(task);
  assertWorkTask(current);
  const target = normalizeWorkStatus(nextStatus, "");
  if (!target || !canTransitionWorkStatus(current.status, target)) {
    throw new Error(`work task defective: invalid transition ${current.status} -> ${nextStatus}`);
  }
  const nowIso = normalizeIso(now);
  const next = {
    ...current,
    status: target,
    previousStatus: current.status,
    startedAt: current.startedAt || (target === "planning" || target === "implementing" ? nowIso : ""),
    finishedAt: target === "accepted" || target === "failed" ? nowIso : "",
    message: normalizeText(message) || current.message,
    result: normalizeText(result) || current.result,
    error: normalizeText(error) || current.error
  };
  if (target === "usage-limited") next.previousStatus = current.status;
  if (target === "ready") {
    next.startedAt = "";
    next.finishedAt = "";
  }
  assertWorkTask(next);
  return next;
}

export function isTerminalWorkStatus(status) {
  return status === "accepted" || status === "failed";
}
