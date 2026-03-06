import fs from "node:fs/promises";
import path from "node:path";

import { ensureAndroidQueueDirs } from "../android_core/queue.mjs";

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

function sanitizeHandleId(raw = "") {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "handle";
}

function nowIso() {
  return new Date().toISOString();
}

async function handleDir(worldRoot) {
  const queue = await ensureAndroidQueueDirs(worldRoot);
  const dir = path.join(queue.artifactsDir, "handle");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function stateToText(state = {}) {
  const entries = [
    { key: "handle id", type: "text", value: quoteText(state.handleId || "") },
    { key: "intent", type: "text", value: quoteText(state.intent || "") },
    { key: "lane", type: "text", value: quoteText(state.lane || "durable") },
    { key: "device id", type: "text", value: quoteText(state.deviceId || "") },
    { key: "agent name", type: "text", value: quoteText(state.agentName || "") },
    { key: "status", type: "text", value: quoteText(state.status || "queued") },
    { key: "queued at", type: "text", value: quoteText(state.queuedAt || "") },
    { key: "started at", type: "text", value: quoteText(state.startedAt || "") },
    { key: "finished at", type: "text", value: quoteText(state.finishedAt || "") },
    { key: "summary", type: "text", value: quoteText(state.summary || "") },
    { key: "updated at", type: "text", value: quoteText(state.updatedAt || nowIso()) }
  ];
  return `${mapBlock("android handle state", entries)}\n`;
}

function stateFromText(text) {
  const blocks = parseMapBlocks(text);
  const entries = parseMapEntries(blocks.get("android handle state") ?? "");
  const out = {
    handleId: "",
    intent: "",
    lane: "durable",
    deviceId: "",
    agentName: "",
    status: "queued",
    queuedAt: "",
    startedAt: "",
    finishedAt: "",
    summary: "",
    updatedAt: ""
  };
  for (const entry of entries) {
    if (entry.key === "handle id") out.handleId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "intent") out.intent = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "lane") out.lane = String(parseQuoted(entry.valueRaw) ?? "").trim() || "durable";
    if (entry.key === "device id") out.deviceId = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "agent name") out.agentName = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "status") out.status = String(parseQuoted(entry.valueRaw) ?? "").trim() || "queued";
    if (entry.key === "queued at") out.queuedAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "started at") out.startedAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "finished at") out.finishedAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "summary") out.summary = String(parseQuoted(entry.valueRaw) ?? "").trim();
    if (entry.key === "updated at") out.updatedAt = String(parseQuoted(entry.valueRaw) ?? "").trim();
  }
  return out;
}

async function handleFilePath(worldRoot, handleId) {
  const dir = await handleDir(worldRoot);
  return path.join(dir, `${sanitizeHandleId(handleId)}.pya`);
}

export async function readAndroidHandleState(worldRoot, handleId) {
  const target = await handleFilePath(worldRoot, handleId);
  try {
    const text = await fs.readFile(target, "utf8");
    const parsed = stateFromText(text);
    if (!parsed.handleId) parsed.handleId = String(handleId ?? "").trim();
    return parsed;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeAndroidHandleState(worldRoot, handleId, nextState = {}) {
  const target = await handleFilePath(worldRoot, handleId);
  const current = await readAndroidHandleState(worldRoot, handleId);
  const base = current || {
    handleId: String(handleId ?? "").trim(),
    intent: "",
    lane: "durable",
    deviceId: "",
    agentName: "",
    status: "queued",
    queuedAt: "",
    startedAt: "",
    finishedAt: "",
    summary: "",
    updatedAt: ""
  };
  const merged = {
    ...base,
    ...nextState,
    handleId: String(handleId ?? base.handleId ?? "").trim() || String(base.handleId || "").trim(),
    updatedAt: nowIso()
  };
  await fs.writeFile(target, stateToText(merged), "utf8");
  return merged;
}

export function isTerminalHandleStatus(status = "") {
  const value = String(status ?? "").trim().toLowerCase();
  return value === "success" || value === "fail" || value === "cancel";
}
