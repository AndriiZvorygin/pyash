import fs from "node:fs/promises";
import path from "node:path";

import { ensureHoldingLaneDirs } from "../../agent/holding_lane/layout.mjs";
import {
  assertWorkTask,
  buildWorkTask,
  normalizeWorkTaskId,
  transitionWorkTask
} from "./contract.mjs";

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

function parseMap(text) {
  const block = String(text ?? "").match(/su name work task status be map def\n([\s\S]*?)\nprah/i);
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

function statusToText(task) {
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
    { key: "error", type: "text", value: quoteText(task.error) }
  ];
  return `${mapBlock("work task status", entries)}\n`;
}

function statusFromText(text) {
  const values = parseMap(text);
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
    workSpec: {}
  });
}

async function statusDir(worldRoot) {
  const paths = await ensureHoldingLaneDirs(worldRoot, { lane: "work", migrateLegacyProduce: true });
  const dir = path.join(paths.artifactsDir, "task");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function statusPath(worldRoot, taskId) {
  const id = normalizeWorkTaskId(taskId);
  if (!id) return "";
  return path.join(await statusDir(worldRoot), `${id}.pya`);
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

export async function writeWorkTaskStatus(worldRoot, task, nextStatus = null) {
  const current = buildWorkTask(task);
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

export async function transitionWorkTaskStatus(worldRoot, taskId, nextStatus, options = {}) {
  const current = await readWorkTaskStatus(worldRoot, taskId);
  if (!current) throw new Error(`work task status missing: ${taskId}`);
  const next = transitionWorkTask(current, nextStatus, options);
  return writeWorkTaskStatus(worldRoot, next);
}

export function isTerminalWorkTaskStatus(status) {
  return status === "accepted" || status === "failed";
}
