import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

function quotePyashText(value) {
  return JSON.stringify(String(value ?? ""));
}

function parsePyashQuotedText(value) {
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

function healthPath(worldRoot) {
  return path.join(worldRoot, "conduct", "service", "gpu_health.pya");
}

function normalizeCount(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
}

function normalizeText(raw, fallback = "") {
  const text = String(raw ?? "").trim();
  return text || fallback;
}

function assertIsoTimestamp(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new Error(`gpu health defective: invalid ${fieldName}`);
  }
  return new Date(Date.parse(text)).toISOString();
}

export async function writeGpuHealthSnapshot({
  worldRoot = "",
  queueDepth = 0,
  healthy = true,
  statusText = "ready",
  activeMode = "",
  leaseCount = 0,
  workerSeenAt = "",
  updatedAt = new Date().toISOString()
} = {}) {
  if (!worldRoot) {
    throw new Error("gpu health defective: missing world root");
  }
  const normalizedUpdatedAt = assertIsoTimestamp(updatedAt, "updated at");
  const entries = [
    { key: "queue depth", type: "num", value: normalizeCount(queueDepth) },
    { key: "healthy", type: "bool", value: healthy ? "truth" : "lie" },
    { key: "status", type: "text", value: quotePyashText(normalizeText(statusText, "ready")) },
    { key: "active mode", type: "text", value: quotePyashText(normalizeText(activeMode, "")) },
    { key: "lease count", type: "num", value: normalizeCount(leaseCount) },
    { key: "worker seen at", type: "text", value: quotePyashText(normalizeText(workerSeenAt, "")) },
    { key: "updated at", type: "text", value: quotePyashText(normalizedUpdatedAt) }
  ];
  const target = healthPath(worldRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${mapBlock("gpu health", entries)}\n`, "utf8");
}

export function readGpuHealthSnapshotSync(worldRoot = "") {
  if (!worldRoot) return null;
  const target = healthPath(worldRoot);
  try {
    const text = fsSync.readFileSync(target, "utf8");
    const blocks = parseMapBlocks(text);
    const entries = parseMapEntries(blocks.get("gpu health") ?? "");
    const out = {
      queueDepth: 0,
      healthy: true,
      statusText: "ready",
      activeMode: "",
      leaseCount: 0,
      workerSeenAt: "",
      updatedAt: ""
    };
    for (const entry of entries) {
      if (entry.key === "queue depth") {
        out.queueDepth = normalizeCount(entry.valueRaw);
        continue;
      }
      if (entry.key === "healthy") {
        out.healthy = /^truth$/i.test(entry.valueRaw);
        continue;
      }
      if (entry.key === "status") {
        out.statusText = normalizeText(parsePyashQuotedText(entry.valueRaw), "ready");
        continue;
      }
      if (entry.key === "active mode") {
        out.activeMode = normalizeText(parsePyashQuotedText(entry.valueRaw), "");
        continue;
      }
      if (entry.key === "lease count") {
        out.leaseCount = normalizeCount(entry.valueRaw);
        continue;
      }
      if (entry.key === "worker seen at") {
        out.workerSeenAt = normalizeText(parsePyashQuotedText(entry.valueRaw), "");
        continue;
      }
      if (entry.key === "updated at") {
        out.updatedAt = normalizeText(parsePyashQuotedText(entry.valueRaw), "");
      }
    }
    return out;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}
