import crypto from "node:crypto";
import fs from "node:fs/promises";

import { buildWorkTask, normalizeWorkTaskId, transitionWorkTask } from "../runtime/work/contract.mjs";
import { listWorkTaskStatuses, readWorkTaskStatus, writeWorkTaskStatus } from "../runtime/work/status.mjs";

const DUTY_VERSION = 1;
const MAX_TITLE_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 32000;
const MAX_MESSAGES = 2000;
const MAX_CONVERSATION_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

function text(value) {
  return String(value ?? "").trim();
}

function ownerId(value) {
  const normalized = text(value).toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(normalized) ? normalized : "";
}

function permissionScope(value = "project") {
  const normalized = text(value).toLowerCase() || "project";
  return ["project", "home"].includes(normalized) ? normalized : "";
}

function dutyError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("duty defective: invalid timestamp");
  return date.toISOString();
}

function newId() {
  return `duty-${crypto.randomUUID()}`;
}

function codingDutyOf(task) {
  const duty = task?.workSpec?.codingDuty;
  return duty?.version === DUTY_VERSION ? duty : null;
}

export function publicCodingDutyMessage(message) {
  return {
    id: text(message?.id),
    parentId: text(message?.parentId),
    role: message?.role === "assistant" ? "assistant" : "user",
    text: String(message?.text ?? ""),
    createdAt: text(message?.createdAt),
    completedAt: text(message?.completedAt),
    state: text(message?.state) || "complete"
  };
}

function assertConversationSize(messages) {
  const size = messages.reduce((total, message) => total + Buffer.byteLength(String(message?.text ?? ""), "utf8"), 0);
  if (size > MAX_CONVERSATION_BYTES) throw new Error("duty conversation limit reached");
}

export function isCodingDuty(task) {
  return Boolean(codingDutyOf(task));
}

export function codingDutyOwner(task) {
  return ownerId(codingDutyOf(task)?.ownerId);
}

export function codingDutyView(task, { includeMessages = true } = {}) {
  const duty = codingDutyOf(task);
  if (!duty) return null;
  return {
    id: task.taskId,
    title: task.title,
    status: task.status,
    workerId: duty.workerId,
    repositoryId: duty.repositoryId,
    permissionScope: permissionScope(duty.permissionScope) || "project",
    model: duty.model,
    backend: duty.backend,
    host: duty.host,
    sessionName: duty.sessionName,
    createdAt: task.queuedAt,
    updatedAt: duty.updatedAt,
    lastError: duty.lastError,
    active: Boolean(duty.claim?.messageId),
    messages: includeMessages ? duty.messages.map(publicCodingDutyMessage) : undefined
  };
}

export async function createCodingDuty(worldRoot, {
  id = newId(),
  title,
  initialMessage,
  ownerId: requestedOwner,
  workerId,
  repositoryId,
  permissionScope: requestedPermissionScope = "project",
  model,
  backend,
  host,
  sessionName,
  sessionFile,
  now = new Date()
} = {}) {
  const dutyId = normalizeWorkTaskId(id);
  const objective = text(title);
  const prompt = String(initialMessage ?? "").trim();
  const owner = ownerId(requestedOwner);
  const scope = permissionScope(requestedPermissionScope);
  if (!dutyId || !dutyId.startsWith("duty-")) throw new Error("duty defective: invalid duty identity");
  if (!owner) throw dutyError("duty owner is missing or invalid");
  if (!scope) throw dutyError("duty permission scope must be project or home");
  if (!objective || objective.length > MAX_TITLE_LENGTH) throw dutyError("duty title is missing or too long");
  if (!prompt || prompt.length > MAX_MESSAGE_LENGTH) throw new Error("duty defective: initial message is missing or too long");
  if (!text(workerId) || !text(repositoryId)) throw new Error("duty defective: worker and directory are required");
  if (!text(model) || !text(backend) || !text(host)) throw new Error("duty defective: model runtime is incomplete");
  if (!text(sessionFile)) throw new Error("duty defective: session file is required");
  const timestamp = iso(now);
  const task = buildWorkTask({
    taskId: dutyId,
    owner: "coding saddle",
    kind: "coding-duty",
    title: objective,
    status: "implementing",
    queuedAt: timestamp,
    startedAt: timestamp,
    acceptanceText: "The operator accepts the completed coding duty.",
    promptText: prompt,
    source: { identity: `coding-saddle:${dutyId}`, kind: "interactive-duty" },
    workSpec: {
      codingDuty: {
        version: DUTY_VERSION,
        ownerId: owner,
        workerId: text(workerId),
        repositoryId: text(repositoryId),
        permissionScope: scope,
        model: text(model),
        backend: text(backend),
        host: text(host),
        sessionName: text(sessionName),
        sessionFile: text(sessionFile),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastError: "",
        claim: null,
        messages: [{
          id: crypto.randomUUID(),
          role: "user",
          text: prompt,
          createdAt: timestamp,
          completedAt: "",
          state: "pending",
          attempts: 0
        }]
      }
    },
    checkpoint: { lastAction: "coding duty created; waiting for its assigned worker" }
  });
  const existing = await readWorkTaskStatus(worldRoot, dutyId);
  if (existing) throw dutyError(`duty already exists: ${dutyId}`, 409);
  return writeWorkTaskStatus(worldRoot, task);
}

export async function listCodingDuties(worldRoot, { includeTerminal = true, ownerId: requestedOwner = "" } = {}) {
  const owner = ownerId(requestedOwner);
  const tasks = await listWorkTaskStatuses(worldRoot, { includeTerminal });
  return tasks.filter((task) => isCodingDuty(task) && (!owner || codingDutyOwner(task) === owner))
    .map((task) => codingDutyView(task));
}

export async function setCodingDutyPermission(worldRoot, dutyId, requestedScope, {
  ownerId: requestedOwner,
  homeAllowed = false,
  now = new Date()
} = {}) {
  const task = await readCodingDuty(worldRoot, dutyId);
  if (!task || codingDutyOwner(task) !== ownerId(requestedOwner)) return null;
  const scope = permissionScope(requestedScope);
  if (!scope) throw dutyError("permission scope must be project or home");
  if (scope === "home" && homeAllowed !== true) {
    throw dutyError("this worker is not configured to allow home access", 409);
  }
  const duty = codingDutyOf(task);
  if (!["implementing", "blocked"].includes(task.status)) {
    throw dutyError(`duty permissions cannot change while ${task.status}`, 409);
  }
  if (duty.claim || duty.messages.some((message) => message.role === "user" && ["pending", "running"].includes(message.state))) {
    throw dutyError("duty permissions cannot change while work is active", 409);
  }
  const timestamp = iso(now);
  return writeWorkTaskStatus(worldRoot, {
    ...task,
    workSpec: {
      ...task.workSpec,
      codingDuty: { ...duty, permissionScope: scope, updatedAt: timestamp }
    },
    checkpoint: { ...task.checkpoint, lastAction: `duty permission scope set to ${scope}` }
  });
}

export async function readCodingDuty(worldRoot, dutyId) {
  const task = await readWorkTaskStatus(worldRoot, dutyId);
  if (!task || !isCodingDuty(task)) return null;
  return task;
}

export async function addCodingDutyMessage(worldRoot, dutyId, value, { now = new Date() } = {}) {
  const task = await readCodingDuty(worldRoot, dutyId);
  if (!task) return null;
  if (["accepted", "failed"].includes(task.status)) throw dutyError("duty is closed", 409);
  if (!["implementing", "blocked"].includes(task.status)) {
    throw dutyError(`duty cannot accept messages while ${task.status}`, 409);
  }
  const messageText = String(value ?? "").trim();
  if (!messageText || messageText.length > MAX_MESSAGE_LENGTH) {
    throw new Error("duty message is missing or too long");
  }
  const duty = codingDutyOf(task);
  if (duty.messages.length >= MAX_MESSAGES) throw new Error("duty message limit reached");
  const timestamp = iso(now);
  const nextDuty = {
    ...duty,
    updatedAt: timestamp,
    messages: [...duty.messages, {
      id: crypto.randomUUID(),
      role: "user",
      text: messageText,
      createdAt: timestamp,
      completedAt: "",
      state: "pending",
      attempts: 0
    }]
  };
  assertConversationSize(nextDuty.messages);
  const resumed = task.status === "blocked"
    ? transitionWorkTask(task, "implementing", {
      now: timestamp,
      message: "coding duty resumed with operator instruction"
    })
    : task;
  return writeWorkTaskStatus(worldRoot, {
    ...resumed,
    error: "",
    workSpec: { ...task.workSpec, codingDuty: nextDuty },
    checkpoint: {
      ...resumed.checkpoint,
      blocker: "",
      lastAction: task.status === "blocked"
        ? "coding duty resumed with operator instruction"
        : resumed.checkpoint.lastAction
    }
  });
}

function leaseIsLive(claim, nowMs) {
  return Boolean(claim?.messageId && Date.parse(claim.leaseUntil) > nowMs);
}

export async function claimCodingDutyMessage(worldRoot, workerId, {
  now = new Date(),
  leaseMs = 60000,
  repositoryIds = null,
  ownerId: requestedOwner = ""
} = {}) {
  const worker = text(workerId);
  const owner = ownerId(requestedOwner);
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const tasks = await listWorkTaskStatuses(worldRoot, { includeTerminal: false });
  for (const task of tasks) {
    const duty = codingDutyOf(task);
    if (!duty || duty.workerId !== worker || task.status !== "implementing") continue;
    if (owner && codingDutyOwner(task) !== owner) continue;
    if (Array.isArray(repositoryIds) && !repositoryIds.includes(duty.repositoryId)) continue;
    if (leaseIsLive(duty.claim, nowMs)) continue;
    const message = duty.messages.find((entry) => entry.role === "user" && entry.state === "pending")
      || (duty.claim?.workerId === worker && duty.messages.find((entry) => entry.id === duty.claim.messageId && entry.state === "running"));
    if (!message) continue;
    if (message.attempts >= MAX_ATTEMPTS) {
      const nextMessages = duty.messages.map((entry) => entry.id === message.id
        ? { ...entry, state: "failed" }
        : entry);
      await writeWorkTaskStatus(worldRoot, {
        ...task,
        status: "blocked",
        message: "coding duty worker retry limit reached",
        workSpec: { ...task.workSpec, codingDuty: { ...duty, messages: nextMessages, claim: null } }
      });
      continue;
    }
    const timestamp = nowDate.toISOString();
    const nextMessages = duty.messages.map((entry) => entry.id === message.id
      ? { ...entry, state: "running", attempts: Number(entry.attempts || 0) + 1 }
      : entry);
    const claimed = await writeWorkTaskStatus(worldRoot, {
      ...task,
      workSpec: {
        ...task.workSpec,
        codingDuty: {
          ...duty,
          updatedAt: timestamp,
          lastError: "",
          claim: {
            workerId: worker,
            messageId: message.id,
            claimId: crypto.randomUUID(),
            leaseUntil: new Date(nowMs + leaseMs).toISOString()
          },
          messages: nextMessages
        }
      },
      checkpoint: { ...task.checkpoint, lastAction: "coding duty message claimed by assigned worker" }
    });
    const claimedMessage = codingDutyOf(claimed).messages.find((entry) => entry.id === message.id);
    return { task: claimed, message: claimedMessage };
  }
  return null;
}

export async function heartbeatCodingDuty(worldRoot, dutyId, workerId, messageId, claimId, {
  now = new Date(),
  leaseMs = 60000,
  ownerId: requestedOwner = ""
} = {}) {
  const task = await readCodingDuty(worldRoot, dutyId);
  if (!task) return false;
  const duty = codingDutyOf(task);
  if (ownerId(requestedOwner) && codingDutyOwner(task) !== ownerId(requestedOwner)) return false;
  if (duty.claim?.workerId !== text(workerId)
    || duty.claim?.messageId !== text(messageId)
    || duty.claim?.claimId !== text(claimId)) return false;
  const nowDate = now instanceof Date ? now : new Date(now);
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    workSpec: {
      ...task.workSpec,
      codingDuty: {
        ...duty,
        claim: { ...duty.claim, leaseUntil: new Date(nowDate.getTime() + leaseMs).toISOString() },
        updatedAt: nowDate.toISOString()
      }
    }
  });
  return true;
}

function assertDutyClaim(task, workerId, messageId, claimId, requestedOwner = "") {
  const duty = codingDutyOf(task);
  if (!duty || duty.claim?.workerId !== text(workerId)
    || duty.claim?.messageId !== text(messageId)
    || duty.claim?.claimId !== text(claimId)
    || (ownerId(requestedOwner) && codingDutyOwner(task) !== ownerId(requestedOwner))) {
    throw dutyError("duty claim does not match active worker", 409);
  }
  return duty;
}

export async function completeCodingDutyMessage(worldRoot, dutyId, workerId, messageId, claimId, response, {
  sessionText = "",
  ownerId: requestedOwner = "",
  now = new Date()
} = {}) {
  const task = await readCodingDuty(worldRoot, dutyId);
  if (!task) return null;
  const storedDuty = codingDutyOf(task);
  if (ownerId(requestedOwner) && codingDutyOwner(task) !== ownerId(requestedOwner)) {
    throw dutyError("duty claim does not match active worker", 409);
  }
  const currentMessage = storedDuty.messages.find((entry) => entry.id === text(messageId));
  const priorResponse = storedDuty.messages.find((entry) => entry.role === "assistant" && entry.parentId === text(messageId));
  if (currentMessage?.state === "complete" && priorResponse) return task;
  const duty = assertDutyClaim(task, workerId, messageId, claimId, requestedOwner);
  const output = String(response ?? "").trim();
  if (!output || output.length > MAX_MESSAGE_LENGTH) throw new Error("duty response is missing or too long");
  const storedSessionPath = text(duty.sessionFile);
  if (!storedSessionPath || !String(sessionText ?? "").trim()) throw new Error("duty session evidence is missing");
  if (Buffer.byteLength(String(sessionText), "utf8") > MAX_SESSION_BYTES) {
    throw new Error("duty session exceeds the synchronization limit");
  }
  const sessionTmp = `${storedSessionPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(sessionTmp, String(sessionText), "utf8");
    await fs.rename(sessionTmp, storedSessionPath);
  } finally {
    await fs.rm(sessionTmp, { force: true }).catch(() => {});
  }
  const timestamp = iso(now);
  const messages = duty.messages.map((entry) => entry.id === text(messageId)
    ? { ...entry, state: "complete", completedAt: timestamp }
    : entry);
  messages.push({
    id: crypto.randomUUID(),
    parentId: text(messageId),
    role: "assistant",
    text: output,
    createdAt: timestamp,
    completedAt: timestamp,
    state: "complete",
    attempts: 0
  });
  assertConversationSize(messages);
  return writeWorkTaskStatus(worldRoot, {
    ...task,
    result: output.slice(0, 1000),
    workSpec: {
      ...task.workSpec,
      codingDuty: { ...duty, claim: null, lastError: "", updatedAt: timestamp, messages }
    },
    checkpoint: { ...task.checkpoint, lastAction: "coding duty response recorded" }
  });
}

export async function failCodingDutyMessage(worldRoot, dutyId, workerId, messageId, claimId, error, {
  now = new Date(),
  retry = true,
  ownerId: requestedOwner = ""
} = {}) {
  const task = await readCodingDuty(worldRoot, dutyId);
  if (!task) return null;
  const duty = assertDutyClaim(task, workerId, messageId, claimId, requestedOwner);
  const timestamp = iso(now);
  const message = duty.messages.find((entry) => entry.id === text(messageId));
  const canRetry = retry && Number(message?.attempts || 0) < MAX_ATTEMPTS;
  const messages = duty.messages.map((entry) => entry.id === text(messageId)
    ? { ...entry, state: canRetry ? "pending" : "failed" }
    : entry);
  const updatedDuty = {
    ...duty,
    claim: null,
    lastError: String(error ?? "worker failed").slice(0, 2000),
    updatedAt: timestamp,
    messages
  };
  const next = canRetry
    ? { ...task, message: "coding duty turn will retry", workSpec: { ...task.workSpec, codingDuty: updatedDuty } }
    : transitionWorkTask({ ...task, workSpec: { ...task.workSpec, codingDuty: updatedDuty } }, "blocked", {
      now: timestamp,
      message: "coding duty worker failed after bounded retries",
      error: updatedDuty.lastError
    });
  return writeWorkTaskStatus(worldRoot, {
    ...next,
    workSpec: { ...next.workSpec, codingDuty: updatedDuty },
    checkpoint: { ...task.checkpoint, blocker: canRetry ? "" : updatedDuty.lastError, lastAction: "coding duty worker failure recorded" }
  });
}

export async function acceptCodingDuty(worldRoot, dutyId, { actor = "operator", now = new Date() } = {}) {
  const task = await readCodingDuty(worldRoot, dutyId);
  if (!task) return null;
  if (task.status === "accepted") return task;
  if (task.status !== "implementing") throw dutyError(`duty cannot be accepted from ${task.status}`, 409);
  const duty = codingDutyOf(task);
  if (duty.claim || duty.messages.some((message) => message.role === "user" && ["pending", "running"].includes(message.state))) {
    throw dutyError("duty has unfinished input or active work", 409);
  }
  const timestamp = iso(now);
  const reviewing = transitionWorkTask(task, "reviewing", {
    now: timestamp,
    message: "operator accepted coding duty"
  });
  const accepted = transitionWorkTask(reviewing, "accepted", {
    now: timestamp,
    message: "operator accepted coding duty",
    result: task.result || "accepted by operator"
  });
  return writeWorkTaskStatus(worldRoot, {
    ...accepted,
    checkpoint: {
      ...accepted.checkpoint,
      review: {
        ...accepted.checkpoint.review,
        role: "operator",
        decision: "ACCEPT",
        explanation: `Accepted by ${text(actor) || "operator"}.`
      },
      lastAction: "coding duty accepted by operator"
    }
  });
}

export async function readDutySessionText(task) {
  const sessionFile = text(codingDutyOf(task)?.sessionFile);
  if (!sessionFile) throw new Error("duty session path missing");
  const stat = await fs.stat(sessionFile);
  if (stat.size > MAX_SESSION_BYTES) throw new Error("duty session exceeds the synchronization limit");
  return fs.readFile(sessionFile, "utf8");
}

export function dutyWorkerTokenMatches(expected, received) {
  const left = Buffer.from(String(expected ?? ""));
  const right = Buffer.from(String(received ?? ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function parseDutyWorkerTokens(value = "") {
  const entries = new Map();
  for (const item of String(value ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const workerId = text(item.slice(0, separator));
    const token = text(item.slice(separator + 1));
    if (/^[a-zA-Z0-9._-]{1,80}$/u.test(workerId) && token) entries.set(workerId, token);
  }
  return entries;
}

export function parseDutyWorkerUsers(value = "") {
  const entries = new Map();
  for (const item of String(value ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const workerId = text(item.slice(0, separator));
    const userId = ownerId(item.slice(separator + 1));
    if (/^[a-zA-Z0-9._-]{1,80}$/u.test(workerId) && userId) entries.set(workerId, userId);
  }
  return entries;
}

export function parseDutyWebUsers(value = "") {
  const entries = new Map();
  for (const item of String(value ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const loginId = ownerId(item.slice(0, separator));
    const userId = ownerId(item.slice(separator + 1));
    if (loginId && userId) entries.set(loginId, userId);
  }
  return entries;
}

export function parseDutyWorkerHomeAccess(value = "") {
  return new Set(String(value ?? "").split(/[;,]/u)
    .map(text)
    .filter((workerId) => /^[a-zA-Z0-9._-]{1,80}$/u.test(workerId)));
}

export function parseDutyRepositories(value = "") {
  const repositories = [];
  for (const item of String(value ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const id = text(item.slice(0, separator));
    const root = text(item.slice(separator + 1));
    if (!/^[a-zA-Z0-9._-]{1,80}$/u.test(id) || !root) continue;
    repositories.push({ id, root });
  }
  return repositories;
}

export function publicDutyWorker(worker) {
  return {
    id: worker.id,
    label: worker.label || worker.id,
    online: true,
    lastSeen: worker.lastSeen,
    permissionScopes: Array.isArray(worker.permissionScopes) ? [...worker.permissionScopes] : ["project"],
    repositories: worker.repositories.map(({ id, label }) => ({ id, label: label || id }))
  };
}
