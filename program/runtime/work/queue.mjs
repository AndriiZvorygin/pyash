import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../../beautiful.mjs";
import { parse } from "../../understand/index.mjs";
import {
  makeSpoolFilename,
  writeSpoolItem,
  listSpoolItemsOldestFirst,
  claimSpoolItem,
  completeSpoolItem,
  failSpoolItem
} from "../../library/spool.mjs";
import { holdingLanePaths, ensureHoldingLaneDirs } from "../../agent/holding_lane/layout.mjs";
import {
  assertWorkTask,
  buildWorkTask,
  normalizeWorkTaskId,
  transitionWorkTask
} from "./contract.mjs";
import { writeWorkTaskStatus } from "./status.mjs";

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

function parseEntries(text) {
  const block = String(text ?? "").match(/su name work task be map def\n([\s\S]*?)\nprah/i);
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

function decodeJson(value) {
  const text = String(value ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function taskToText(task) {
  const payload = task.payloadSentence ? sentenceToPyash(task.payloadSentence) : "";
  const entries = [
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
    { key: "error", type: "text", value: quoteText(task.error) },
    { key: "work spec", type: "text", value: quoteText(encodeJson(task.workSpec)) },
    { key: "checkpoint", type: "text", value: quoteText(encodeJson(task.checkpoint)) },
    { key: "payload", type: "text", value: quoteText(payload) }
  ];
  return `${mapBlock("work task", entries)}\n`;
}

function taskFromText(text) {
  const values = parseEntries(text);
  let payloadSentence = null;
  const payloadText = String(values.payload ?? "").trim();
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
    workSpec: decodeJson(values["work spec"]),
    checkpoint: decodeJson(values.checkpoint),
    payloadSentence
  });
}

function filenameMatchesOwner(filename, owner = "") {
  const scope = String(owner ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return !scope || String(filename ?? "").toLowerCase().includes(`-work-${scope}-`);
}

async function requeueClaim(paths, claim) {
  await failSpoolItem({
    runtimePath: claim?.path,
    failDir: paths.produceFailDir,
    requeueDir: paths.inputDir,
    retryCount: 0,
    maxRetries: 1
  });
}

async function readTaskFile(targetPath) {
  return taskFromText(await fs.readFile(targetPath, "utf8"));
}

export function workQueuePaths(worldRoot) {
  return holdingLanePaths(worldRoot, { lane: "work" });
}

export async function ensureWorkQueueDirs(worldRoot) {
  return ensureHoldingLaneDirs(worldRoot, { lane: "work", migrateLegacyProduce: true });
}

export async function enqueueWorkTask(worldRoot, input = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  const task = buildWorkTask(input);
  assertWorkTask(task);
  if (task.status !== "ready") {
    throw new Error("work task defective: queued tasks must be ready");
  }
  await writeWorkTaskStatus(worldRoot, task);
  const filename = makeSpoolFilename({
    at: task.queuedAt,
    channelType: "work",
    agentName: task.owner,
    roomName: task.kind,
    kind: "task",
    hashSource: task.taskId
  });
  return writeSpoolItem({
    tmpDir: paths.tmpDir,
    targetDir: paths.inputDir,
    filename,
    text: taskToText(task)
  });
}

export async function claimOldestWorkTask(worldRoot, { workerTag = "", owner = "" } = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  const pending = await listQueuedWorkTasks(worldRoot, { owner });
  for (const candidate of pending) {
    const filename = candidate.filename;
    if (!filenameMatchesOwner(filename, owner)) continue;
    const claim = await claimSpoolItem({
      fromDir: paths.inputDir,
      runtimeDir: paths.runtimeDir,
      filename,
      workerTag
    });
    if (!claim) continue;
    let task;
    try {
      task = await readTaskFile(claim.path);
      assertWorkTask(task);
    } catch {
      await requeueClaim(paths, claim);
      continue;
    }
    if (owner && task.owner !== owner) {
      await requeueClaim(paths, claim);
      continue;
    }
    if (task.status !== "ready") {
      await requeueClaim(paths, claim);
      continue;
    }
    return { ...claim, task };
  }
  return null;
}

export async function claimOldestRuntimeWorkTask(worldRoot, { owner = "" } = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  const runtime = await listWorkFiles(worldRoot, paths.runtimeDir, { owner });
  for (const candidate of runtime) {
    const filename = candidate.filename;
    if (!filenameMatchesOwner(filename, owner)) continue;
    const task = candidate.task;
    if (owner && task.owner !== owner) continue;
    return {
      path: path.join(paths.runtimeDir, filename),
      filename,
      task,
      recovered: true
    };
  }
  return null;
}

export async function ackWorkTaskSuccess(worldRoot, { runtimePath } = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  return completeSpoolItem({ runtimePath, successDir: paths.produceSuccessDir });
}

export async function writeWorkTaskRuntime(runtimePath, task) {
  const current = buildWorkTask(task);
  assertWorkTask(current);
  const tmp = `${runtimePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, taskToText(current), "utf8");
  await fs.rename(tmp, runtimePath);
  return current;
}

async function listWorkFiles(worldRoot, directory, { owner = "", readyOnly = false } = {}) {
  await ensureWorkQueueDirs(worldRoot);
  let filenames = [];
  try {
    filenames = await listSpoolItemsOldestFirst(directory);
  } catch {
    return [];
  }
  const candidates = [];
  for (const filename of filenames) {
    if (!filenameMatchesOwner(filename, owner)) continue;
    try {
      const task = await readTaskFile(path.join(directory, filename));
      assertWorkTask(task);
      if (owner && task.owner !== owner) continue;
      if (readyOnly && task.status !== "ready") continue;
      candidates.push({ filename, task });
    } catch {
      continue;
    }
  }
  return candidates.sort((left, right) => {
    const priority = Number(right.task.priority) - Number(left.task.priority);
    if (priority) return priority;
    const queued = Date.parse(left.task.queuedAt) - Date.parse(right.task.queuedAt);
    if (queued) return queued;
    return left.filename.localeCompare(right.filename);
  });
}

export async function listQueuedWorkTasks(worldRoot, { owner = "" } = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  return listWorkFiles(worldRoot, paths.inputDir, { owner, readyOnly: true });
}

export async function listRuntimeWorkTasks(worldRoot, { owner = "" } = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  return listWorkFiles(worldRoot, paths.runtimeDir, { owner });
}

export async function findWorkTaskEnvelope(worldRoot, taskId, { owner = "" } = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  const id = normalizeWorkTaskId(taskId);
  for (const directory of [paths.runtimeDir, paths.inputDir]) {
    const candidates = await listWorkFiles(worldRoot, directory, { owner });
    const found = candidates.find((entry) => entry.task.taskId === id);
    if (found) return { ...found, path: path.join(directory, found.filename), runtime: directory === paths.runtimeDir };
  }
  return null;
}

export async function updateWorkTaskEnvelope(worldRoot, envelope, task) {
  if (!envelope?.path) throw new Error("work envelope path missing");
  const current = buildWorkTask(task);
  assertWorkTask(current);
  const tmp = `${envelope.path}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, taskToText(current), "utf8");
  await fs.rename(tmp, envelope.path);
  await writeWorkTaskStatus(worldRoot, current);
  return current;
}

export async function ackWorkTaskFail(worldRoot, {
  runtimePath,
  retryCount = 0,
  retryMax = 0
} = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  let task = null;
  try {
    task = await readTaskFile(runtimePath);
  } catch {
    task = null;
  }
  if (task) {
    const currentRetry = Math.max(task.retryCount, Math.max(0, Math.trunc(Number(retryCount) || 0)));
    const limit = Math.max(task.retryMax, Math.max(0, Math.trunc(Number(retryMax) || 0)));
    const nextRetry = currentRetry + 1;
    const nextTask = nextRetry <= limit
      ? buildWorkTask({
        ...task,
        retryCount: nextRetry,
        status: "ready"
      })
      : transitionWorkTask(
        buildWorkTask({ ...task, retryCount: nextRetry }),
        "failed",
        { now: new Date(), message: task.message, error: task.error }
      );
    assertWorkTask(nextTask);
    await writeWorkTaskRuntime(runtimePath, nextTask);
    await writeWorkTaskStatus(worldRoot, nextTask);
    retryCount = currentRetry;
    retryMax = limit;
  }
  return failSpoolItem({
    runtimePath,
    failDir: paths.produceFailDir,
    requeueDir: paths.inputDir,
    retryCount,
    maxRetries: retryMax
  });
}

export async function ackWorkTaskTerminalFailure(worldRoot, { runtimePath } = {}) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  return failSpoolItem({
    runtimePath,
    failDir: paths.produceFailDir,
    retryCount: 1,
    maxRetries: 0
  });
}

export async function queueDepth(worldRoot) {
  const paths = await ensureWorkQueueDirs(worldRoot);
  const [input, runtime, produceWaiting] = await Promise.all([
    listSpoolItemsOldestFirst(paths.inputDir),
    listSpoolItemsOldestFirst(paths.runtimeDir),
    listSpoolItemsOldestFirst(paths.produceDir)
  ]);
  return {
    input: input.length,
    runtime: runtime.length,
    produceWaiting: produceWaiting.length,
    total: input.length + runtime.length + produceWaiting.length
  };
}

export { taskFromText };
