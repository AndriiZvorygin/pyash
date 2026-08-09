import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../../beautiful.mjs";
import { parse } from "../../understand/index.mjs";
import { ensureHoldingLaneDirs } from "../../agent/holding_lane/layout.mjs";
import {
  assertWorkTask,
  buildWorkTask,
  normalizeWorkTaskId,
  transitionWorkTask
} from "./contract.mjs";
import { buildWorkCheckpoint, mergeWorkCheckpoint } from "./checkpoint.mjs";

function quoteText(value) {
  return JSON.stringify(String(value ?? ""));
}

function parseQuoted(value) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

function mapBlock(name, entries) {
  const lines = [`su name ${name} be map def`];
  for (const entry of entries) {
    lines.push(`  su name ${entry.key} ob ${entry.type} ${entry.value} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

function parseMap(text, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = String(text ?? "").match(new RegExp(
    `su name ${escaped} be map def\\n([\\s\\S]*?)\\nprah`,
    "i"
  ));
  const out = {};
  if (!block) return out;
  for (const line of String(block[1] ?? "").split("\n")) {
    const match = line.trim().match(/^su name (.+?) ob (text|num) (.+?) ya$/i);
    if (!match) continue;
    const key = String(match[1]).trim();
    out[key] = match[2].toLowerCase() === "num"
      ? Number(match[3])
      : parseQuoted(match[3]);
  }
  return out;
}

function encodeJson(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function decodeJson(value, fallback = {}) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function statusEntries(task) {
  return [
    { key: "task id", type: "text", value: quoteText(task.taskId) },
    { key: "owner", type: "text", value: quoteText(task.owner) },
    { key: "kind", type: "text", value: quoteText(task.kind) },
    { key: "title", type: "text", value: quoteText(task.title) },
    { key: "priority", type: "num", value: task.priority },
    { key: "status", type: "text", value: quoteText(task.status) },
    { key: "queued at", type: "text", value: quoteText(task.queuedAt) },
    { key: "started at", type: "text", value: quoteText(task.startedAt) },
    { key: "finished at", type: "text", value: quoteText(task.finishedAt) },
    { key: "retry count", type: "num", value: task.retryCount },
    { key: "retry max", type: "num", value: task.retryMax },
    { key: "acceptance", type: "text", value: quoteText(task.acceptanceText) },
    { key: "prompt", type: "text", value: quoteText(task.promptText) },
    { key: "context", type: "text", value: quoteText(task.contextText) },
    { key: "sol thread id", type: "text", value: quoteText(task.solThreadId) },
    { key: "luna thread id", type: "text", value: quoteText(task.lunaThreadId) },
    { key: "previous status", type: "text", value: quoteText(task.previousStatus) },
    { key: "message", type: "text", value: quoteText(task.message) },
    { key: "result", type: "text", value: quoteText(task.result) },
    { key: "error", type: "text", value: quoteText(task.error) }
  ];
}

function checkpointBlocks(task) {
  const checkpoint = buildWorkCheckpoint(task.checkpoint);
  return [
    mapBlock("work task source", [
      { key: "work spec", type: "text", value: quoteText(encodeJson(task.workSpec)) },
      {
        key: "payload",
        type: "text",
        value: quoteText(task.payloadSentence ? sentenceToPyash(task.payloadSentence) : "")
      }
    ]),
    mapBlock("work task workspace", [
      { key: "repository", type: "text", value: quoteText(checkpoint.workspace.repository) },
      { key: "base revision", type: "text", value: quoteText(checkpoint.workspace.baseRevision) },
      { key: "branch", type: "text", value: quoteText(checkpoint.workspace.branch) },
      { key: "worktree path", type: "text", value: quoteText(checkpoint.workspace.worktreePath) },
      { key: "mode", type: "text", value: quoteText(checkpoint.workspace.mode) }
    ]),
    mapBlock("work task roles", [
      { key: "manager model", type: "text", value: quoteText(checkpoint.manager.model) },
      { key: "manager reasoning effort", type: "text", value: quoteText(checkpoint.manager.reasoningEffort) },
      { key: "manager thread id", type: "text", value: quoteText(checkpoint.manager.threadId) },
      { key: "worker model", type: "text", value: quoteText(checkpoint.worker.model) },
      { key: "worker reasoning effort", type: "text", value: quoteText(checkpoint.worker.reasoningEffort) },
      { key: "worker thread id", type: "text", value: quoteText(checkpoint.worker.threadId) }
    ]),
    mapBlock("work task plan", [
      { key: "summary", type: "text", value: quoteText(checkpoint.plan.summary) },
      { key: "work order", type: "text", value: quoteText(checkpoint.plan.workOrder) },
      { key: "risks", type: "text", value: quoteText(checkpoint.plan.risks) }
    ]),
    mapBlock("work task implementation", [
      { key: "summary", type: "text", value: quoteText(checkpoint.implementation.summary) },
      { key: "commit", type: "text", value: quoteText(checkpoint.implementation.commit) },
      { key: "changed files", type: "text", value: quoteText(encodeJson(checkpoint.implementation.changedFiles)) },
      { key: "file changes", type: "text", value: quoteText(encodeJson(checkpoint.implementation.fileChanges)) },
      { key: "diff", type: "text", value: quoteText(checkpoint.implementation.diff) },
      { key: "tests", type: "text", value: quoteText(encodeJson(checkpoint.implementation.tests)) },
      { key: "blockers", type: "text", value: quoteText(checkpoint.implementation.blockers) },
      { key: "uncertainty", type: "text", value: quoteText(checkpoint.implementation.uncertainty) }
    ]),
    mapBlock("work task review", [
      { key: "decision", type: "text", value: quoteText(checkpoint.review.decision) },
      { key: "explanation", type: "text", value: quoteText(checkpoint.review.explanation) },
      { key: "revision instructions", type: "text", value: quoteText(checkpoint.review.revisionInstructions) }
    ]),
    mapBlock("work task checkpoint", [
      { key: "phase", type: "text", value: quoteText(checkpoint.interruption.phase) },
      { key: "at", type: "text", value: quoteText(checkpoint.interruption.at) },
      { key: "reason", type: "text", value: quoteText(checkpoint.interruption.reason) },
      { key: "last turn id", type: "text", value: quoteText(checkpoint.interruption.lastTurnId) },
      { key: "active turn", type: "text", value: quoteText(encodeJson(checkpoint.activeTurn)) },
      { key: "turn history", type: "text", value: quoteText(encodeJson(checkpoint.turnHistory)) },
      { key: "blocker", type: "text", value: quoteText(checkpoint.blocker) },
      { key: "human response", type: "text", value: quoteText(checkpoint.humanResponse) },
      { key: "last action", type: "text", value: quoteText(checkpoint.lastAction) },
      { key: "selection reason", type: "text", value: quoteText(checkpoint.selectionReason) },
      { key: "revision count", type: "num", value: checkpoint.revisionCount },
      { key: "resume count", type: "num", value: checkpoint.resumeCount }
    ])
  ];
}

function statusToText(task) {
  return [
    mapBlock("work task status", statusEntries(task)),
    ...checkpointBlocks(task)
  ].join("\n") + "\n";
}

function statusFromText(text) {
  const values = parseMap(text, "work task status");
  const source = parseMap(text, "work task source");
  const workspace = parseMap(text, "work task workspace");
  const roles = parseMap(text, "work task roles");
  const plan = parseMap(text, "work task plan");
  const implementation = parseMap(text, "work task implementation");
  const review = parseMap(text, "work task review");
  const checkpoint = parseMap(text, "work task checkpoint");
  let payloadSentence = null;
  const payloadText = String(source.payload ?? "").trim();
  if (payloadText) {
    try {
      payloadSentence = parse(payloadText);
    } catch {
      payloadSentence = null;
    }
  }
  return buildWorkTask({
    taskId: values["task id"],
    owner: values.owner,
    kind: values.kind,
    title: values.title,
    priority: values.priority,
    status: values.status,
    queuedAt: values["queued at"],
    startedAt: values["started at"],
    finishedAt: values["finished at"],
    retryCount: values["retry count"],
    retryMax: values["retry max"],
    acceptanceText: values.acceptance,
    promptText: values.prompt,
    contextText: values.context,
    solThreadId: values["sol thread id"],
    lunaThreadId: values["luna thread id"],
    previousStatus: values["previous status"],
    message: values.message,
    result: values.result,
    error: values.error,
    workSpec: decodeJson(source["work spec"]),
    payloadSentence,
    checkpoint: {
      workspace: {
        repository: workspace.repository,
        baseRevision: workspace["base revision"],
        branch: workspace.branch,
        worktreePath: workspace["worktree path"],
        mode: workspace.mode
      },
      manager: {
        model: roles["manager model"],
        reasoningEffort: roles["manager reasoning effort"],
        threadId: roles["manager thread id"]
      },
      worker: {
        model: roles["worker model"],
        reasoningEffort: roles["worker reasoning effort"],
        threadId: roles["worker thread id"]
      },
      plan: {
        summary: plan.summary,
        workOrder: plan["work order"],
        risks: plan.risks
      },
      implementation: {
        summary: implementation.summary,
        commit: implementation.commit,
        changedFiles: decodeJson(implementation["changed files"], []),
        fileChanges: decodeJson(implementation["file changes"], []),
        diff: implementation.diff,
        tests: decodeJson(implementation.tests, []),
        blockers: implementation.blockers,
        uncertainty: implementation.uncertainty
      },
      review: {
        decision: review.decision,
        explanation: review.explanation,
        revisionInstructions: review["revision instructions"]
      },
      interruption: {
        phase: checkpoint.phase,
        at: checkpoint.at,
        reason: checkpoint.reason,
        lastTurnId: checkpoint["last turn id"]
      },
      activeTurn: decodeJson(checkpoint["active turn"]),
      turnHistory: decodeJson(checkpoint["turn history"], []),
      blocker: checkpoint.blocker,
      humanResponse: checkpoint["human response"],
      lastAction: checkpoint["last action"],
      selectionReason: checkpoint["selection reason"],
      revisionCount: checkpoint["revision count"],
      resumeCount: checkpoint["resume count"]
    }
  });
}

async function statusDir(worldRoot) {
  const paths = await ensureHoldingLaneDirs(worldRoot, { lane: "work", migrateLegacyProduce: true });
  const dir = path.join(paths.artifactsDir, "task");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function workTaskStatusDir(worldRoot) {
  return statusDir(worldRoot);
}

async function statusPath(worldRoot, taskId) {
  const id = normalizeWorkTaskId(taskId);
  if (!id) return "";
  return path.join(await statusDir(worldRoot), `${id}.pya`);
}

function checkpointHasData(checkpoint) {
  return JSON.stringify(buildWorkCheckpoint(checkpoint)) !== JSON.stringify(buildWorkCheckpoint());
}

async function mergeStoredTask(worldRoot, task) {
  const candidate = buildWorkTask(task);
  const stored = await readWorkTaskStatus(worldRoot, candidate.taskId);
  if (!stored) return candidate;
  return buildWorkTask({
    ...stored,
    ...candidate,
    workSpec: Object.keys(candidate.workSpec).length ? candidate.workSpec : stored.workSpec,
    payloadSentence: candidate.payloadSentence || stored.payloadSentence,
    checkpoint: checkpointHasData(candidate.checkpoint) ? candidate.checkpoint : stored.checkpoint
  });
}

export async function readWorkTaskStatus(worldRoot, taskId) {
  const target = await statusPath(worldRoot, taskId);
  if (!target) return null;
  try {
    return statusFromText(await fs.readFile(target, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function listWorkTaskStatuses(worldRoot, { includeTerminal = true } = {}) {
  const dir = await statusDir(worldRoot);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".pya")) continue;
    try {
      const task = statusFromText(await fs.readFile(path.join(dir, entry.name), "utf8"));
      if (!task.taskId) continue;
      if (!includeTerminal && (task.status === "accepted" || task.status === "failed")) continue;
      tasks.push(task);
    } catch {
      continue;
    }
  }
  return tasks.sort((left, right) => {
    const priority = Number(right.priority) - Number(left.priority);
    if (priority) return priority;
    const queued = Date.parse(left.queuedAt) - Date.parse(right.queuedAt);
    if (queued) return queued;
    return left.taskId.localeCompare(right.taskId);
  });
}

export async function writeWorkTaskStatus(worldRoot, task, nextStatus = null) {
  const current = await mergeStoredTask(worldRoot, task);
  const next = nextStatus == null
    ? current
    : transitionWorkTask(current, nextStatus, {
      message: task.message,
      result: task.result,
      error: task.error
    });
  assertWorkTask(next);
  const target = await statusPath(worldRoot, next.taskId);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, statusToText(next), "utf8");
  await fs.rename(tmp, target);
  return next;
}

export async function updateWorkTaskCheckpoint(worldRoot, taskId, patch = {}) {
  const current = await readWorkTaskStatus(worldRoot, taskId);
  if (!current) throw new Error(`work task status missing: ${taskId}`);
  return writeWorkTaskStatus(worldRoot, {
    ...current,
    checkpoint: mergeWorkCheckpoint(current.checkpoint, patch)
  });
}

export async function transitionWorkTaskStatus(worldRoot, taskId, nextStatus, options = {}) {
  const current = await readWorkTaskStatus(worldRoot, taskId);
  if (!current) throw new Error(`work task status missing: ${taskId}`);
  const next = transitionWorkTask(current, nextStatus, options);
  return writeWorkTaskStatus(worldRoot, next);
}

export function isTerminalWorkTaskStatus(status) {
  return status === "accepted" || status === "failed";
}
