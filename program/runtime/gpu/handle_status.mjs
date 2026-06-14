import fs from "node:fs/promises";
import path from "node:path";

import { ensureGpuQueueDirs } from "./queue.mjs";
import {
  buildGpuHandleStatus,
  assertGpuHandleStatus,
  normalizeHandleId
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

function parseMapBlocks(text) {
  const out = new Map();
  const blockPattern = /su name (.+?) be map def\n([\s\S]*?)\nprah/g;
  for (const match of String(text ?? "").matchAll(blockPattern)) {
    out.set(String(match[1]).trim(), String(match[2] ?? ""));
  }
  return out;
}

function parseMapEntries(body) {
  const entries = [];
  for (const raw of String(body ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^su name (.+?) ob (bool|num|text|filename) (.+?) ya$/i);
    if (!match) continue;
    entries.push({
      key: String(match[1]).trim(),
      type: String(match[2]).toLowerCase(),
      valueRaw: String(match[3]).trim()
    });
  }
  return entries;
}

async function handleDir(worldRoot) {
  const queue = await ensureGpuQueueDirs(worldRoot);
  const dir = path.join(queue.artifactsDir, "handle");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function handleFilePath(worldRoot, handleId) {
  const normalized = normalizeHandleId(handleId);
  if (!normalized) return "";
  const dir = await handleDir(worldRoot);
  return path.join(dir, `${normalized}.pya`);
}

function statusToText(status = {}) {
  const entries = [
    { key: "handle id", type: "text", value: quoteText(status.handleId || "") },
    { key: "status", type: "text", value: quoteText(status.status || "queued") },
    { key: "agent name", type: "text", value: quoteText(status.agentName || "") },
    { key: "gpu id", type: "text", value: quoteText(status.gpuId || "") },
    { key: "intent", type: "text", value: quoteText(status.intent || "") },
    { key: "lane", type: "text", value: quoteText(status.lane || "durable") },
    { key: "queued at", type: "text", value: quoteText(status.queuedAt || "") },
    { key: "started at", type: "text", value: quoteText(status.startedAt || "") },
    { key: "finished at", type: "text", value: quoteText(status.finishedAt || "") },
    { key: "retry count", type: "num", value: Math.max(0, Math.trunc(Number(status.retryCount) || 0)) },
    { key: "outcome", type: "text", value: quoteText(status.outcome || "") },
    { key: "message", type: "text", value: quoteText(status.message || "") },
    { key: "result", type: "text", value: quoteText(status.result || "") },
    { key: "error", type: "text", value: quoteText(status.error || "") }
  ];
  return `${mapBlock("gpu handle status", entries)}\n`;
}

function statusFromText(text) {
  const blocks = parseMapBlocks(text);
  const entries = parseMapEntries(blocks.get("gpu handle status") ?? "");
  const out = {
    handleId: "",
    status: "queued",
    agentName: "",
    gpuId: "",
    intent: "",
    lane: "durable",
    queuedAt: "",
    startedAt: "",
    finishedAt: "",
    retryCount: 0,
    outcome: "",
    message: "",
    result: "",
    error: ""
  };
  for (const entry of entries) {
    if (entry.key === "handle id") out.handleId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "status") out.status = String(parseQuoted(entry.valueRaw) ?? "").trim() || "queued";
    if (entry.key === "agent name") out.agentName = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "gpu id") out.gpuId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "intent") out.intent = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "lane") out.lane = String(parseQuoted(entry.valueRaw) ?? "").trim() || "durable";
    if (entry.key === "queued at") out.queuedAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "started at") out.startedAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "finished at") out.finishedAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "retry count") out.retryCount = Math.max(0, Math.trunc(Number(entry.valueRaw) || 0));
    if (entry.key === "outcome") out.outcome = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "message") out.message = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "result") out.result = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "error") out.error = String(parseQuoted(entry.valueRaw) ?? "").trim();
  }
  return out;
}

export async function readGpuHandleStatus(worldRoot, handleId) {
  const target = await handleFilePath(worldRoot, handleId);
  if (!target) return null;
  try {
    const text = await fs.readFile(target, "utf8");
    const parsed = statusFromText(text);
    if (!parsed.handleId) parsed.handleId = normalizeHandleId(handleId);
    return parsed;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeGpuHandleStatus(worldRoot, handleId, nextStatus = {}) {
  const normalizedHandleId = normalizeHandleId(handleId);
  if (!normalizedHandleId) {
    throw new Error("gpu handle status defective: missing handle id");
  }
  const target = await handleFilePath(worldRoot, normalizedHandleId);
  const current = await readGpuHandleStatus(worldRoot, normalizedHandleId);
  const base = current || {
    handleId: normalizedHandleId,
    status: "queued",
    agentName: "",
    gpuId: "",
    intent: "",
    lane: "durable",
    queuedAt: "",
    startedAt: "",
    finishedAt: "",
    retryCount: 0,
    outcome: "",
    message: "",
    result: "",
    error: ""
  };
  const merged = buildGpuHandleStatus({
    ...base,
    ...nextStatus,
    handleId: normalizedHandleId
  });
  assertGpuHandleStatus(merged);
  await fs.writeFile(target, statusToText(merged), "utf8");
  return merged;
}

export function isTerminalHandleStatus(status = "") {
  const value = String(status ?? "").trim().toLowerCase();
  return value === "success" || value === "fail";
}
