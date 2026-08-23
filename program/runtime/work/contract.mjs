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
  ["blocked", new Set(["ready", "planning", "revision", "failed"])],
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

export const DELEGATION_EVENT_TYPES = Object.freeze([
  "assigned",
  "accepted",
  "declined",
  "clarification-requested",
  "progress-reported",
  "completed",
  "escalated"
]);

const DELEGATION_EVENT_TYPE_SET = new Set(DELEGATION_EVENT_TYPES);

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

function normalizeRequiredIso(value, fallback = new Date().toISOString(), label = "timestamp") {
  const text = normalizeText(value) || normalizeText(fallback);
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new Error(`work task defective: invalid ${label}`);
  }
  return new Date(text).toISOString();
}

function normalizeDeadline(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return normalizeRequiredIso(text, "", "deadline");
}

function primitiveValue(value) {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value.text !== undefined) return value.text;
  if (value.num !== undefined) return value.num;
  if (value.boolean !== undefined) return value.boolean;
  if (value.ob?.text !== undefined) return value.ob.text;
  if (value.ob?.num !== undefined) return value.ob.num;
  if (value.ob?.boolean !== undefined) return value.ob.boolean;
  return undefined;
}

function normalizeSource(value) {
  const source = typeof value === "string"
    ? { identity: value }
    : value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  return {
    identity: normalizeText(primitiveValue(source.identity) ?? source.identity),
    kind: normalizeText(primitiveValue(source.kind) ?? source.kind),
    locator: normalizeText(primitiveValue(source.locator) ?? source.locator)
  };
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const id = normalizeWorkTaskId(primitiveValue(raw) ?? raw);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function normalizeEscalation(value, sourceIdentity = "") {
  const escalation = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const timestampText = normalizeText(primitiveValue(escalation.timestamp) ?? escalation.timestamp);
  return {
    state: normalizeText(primitiveValue(escalation.state ?? escalation.currentState) ?? escalation.state ?? escalation.currentState),
    target: normalizeText(primitiveValue(escalation.target) ?? escalation.target),
    reason: normalizeText(primitiveValue(escalation.reason) ?? escalation.reason),
    timestamp: timestampText ? normalizeRequiredIso(timestampText, "", "escalation timestamp") : "",
    sourceIdentity: normalizeText(
      primitiveValue(escalation.sourceIdentity)
        ?? escalation.sourceIdentity
        ?? sourceIdentity
    )
  };
}

export function normalizeDelegationEvent(value, {
  now = new Date(),
  sourceIdentity = ""
} = {}) {
  const event = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = normalizeText(primitiveValue(event.type) ?? event.type).toLowerCase();
  if (!DELEGATION_EVENT_TYPE_SET.has(type)) {
    throw new Error(`work task defective: invalid delegation event type ${type || "(missing)"}`);
  }
  const fallback = normalizeRequiredIso(now, new Date().toISOString(), "event timestamp");
  const eventTimestamp = normalizeText(primitiveValue(event.timestamp) ?? event.timestamp);
  return {
    type,
    timestamp: normalizeRequiredIso(eventTimestamp, fallback, "event timestamp"),
    actor: normalizeText(primitiveValue(event.actor) ?? event.actor),
    recipient: normalizeText(primitiveValue(event.recipient) ?? event.recipient),
    note: normalizeText(primitiveValue(event.note) ?? event.note),
    sourceIdentity: normalizeText(
      primitiveValue(event.sourceIdentity)
        ?? event.sourceIdentity
        ?? event.source?.identity
        ?? sourceIdentity
    )
  };
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
    source: normalizeSource(input.source),
    domain: normalizeText(input.domain),
    deadline: normalizeDeadline(input.deadline),
    dependencies: normalizeDependencies(input.dependencies),
    delegatedBy: normalizeText(input.delegatedBy),
    escalation: normalizeEscalation(input.escalation, normalizeSource(input.source).identity),
    delegationEvents: Array.isArray(input.delegationEvents)
      ? input.delegationEvents.map((event) => normalizeDelegationEvent(event, {
        sourceIdentity: normalizeSource(input.source).identity
      }))
      : [],
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
  if (normalizeText(value.deadline)) {
    if (!Number.isFinite(Date.parse(String(value.deadline)))) {
      throw new Error("work task defective: invalid deadline");
    }
    if (new Date(String(value.deadline)).toISOString() !== String(value.deadline)) {
      throw new Error("work task defective: deadline must be normalized ISO");
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
  if (!value.source || typeof value.source !== "object" || Array.isArray(value.source)) {
    throw new Error("work task defective: source must be a map");
  }
  for (const key of ["identity", "kind", "locator"]) {
    if (typeof value.source[key] !== "string") throw new Error(`work task defective: invalid source ${key}`);
  }
  if (!Array.isArray(value.dependencies)) {
    throw new Error("work task defective: dependencies must be ordered list");
  }
  const dependencyIds = value.dependencies.map((dependency) => normalizeWorkTaskId(dependency));
  if (dependencyIds.some((dependency) => !dependency) || new Set(dependencyIds).size !== dependencyIds.length) {
    throw new Error("work task defective: dependencies must be unique task ids");
  }
  if (typeof value.domain !== "string" || typeof value.delegatedBy !== "string") {
    throw new Error("work task defective: invalid organization text");
  }
  if (!value.escalation || typeof value.escalation !== "object" || Array.isArray(value.escalation)) {
    throw new Error("work task defective: escalation must be a map");
  }
  for (const key of ["state", "target", "reason", "timestamp", "sourceIdentity"]) {
    if (typeof value.escalation[key] !== "string") throw new Error(`work task defective: invalid escalation ${key}`);
  }
  if (value.escalation.timestamp && !Number.isFinite(Date.parse(value.escalation.timestamp))) {
    throw new Error("work task defective: invalid escalation timestamp");
  }
  if (!Array.isArray(value.delegationEvents)) {
    throw new Error("work task defective: delegation events must be ordered list");
  }
  for (const event of value.delegationEvents) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("work task defective: invalid delegation event");
    }
    if (!DELEGATION_EVENT_TYPE_SET.has(event.type)) {
      throw new Error(`work task defective: invalid delegation event type ${event.type || "(missing)"}`);
    }
    for (const key of ["timestamp", "actor", "recipient", "note", "sourceIdentity"]) {
      if (typeof event[key] !== "string") throw new Error(`work task defective: invalid delegation event ${key}`);
    }
    if (!Number.isFinite(Date.parse(event.timestamp))) {
      throw new Error("work task defective: invalid event timestamp");
    }
  }
}

export function appendWorkTaskDelegationEvent(task, event, { now = new Date() } = {}) {
  const current = buildWorkTask(task);
  assertWorkTask(current);
  const normalizedEvent = normalizeDelegationEvent(event, {
    now,
    sourceIdentity: current.source.identity
  });
  const next = buildWorkTask({
    ...current,
    delegationEvents: [...current.delegationEvents, normalizedEvent]
  });
  assertWorkTask(next);
  return next;
}

export const appendDelegationEvent = appendWorkTaskDelegationEvent;

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
