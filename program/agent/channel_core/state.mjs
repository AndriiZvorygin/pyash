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

function channelStatePath(agentHouse, channelType) {
  return path.join(agentHouse, "conduct", `channel-state-${channelType}.pya`);
}

export function legacyChannelStatePaths(agentHouse, channelType) {
  return {
    checkpoint: path.join(agentHouse, "conduct", `checkpoint-${channelType}.json`),
    dedup: path.join(agentHouse, "conduct", `dedup-${channelType}.json`),
    selfEvents: path.join(agentHouse, "conduct", `self-events-${channelType}.json`)
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function readLegacyChannelState(agentHouse, channelType) {
  const legacy = legacyChannelStatePaths(agentHouse, channelType);
  const [checkpoint, dedupState, selfState] = await Promise.all([
    readJsonFile(legacy.checkpoint, {}),
    readJsonFile(legacy.dedup, { order: [] }),
    readJsonFile(legacy.selfEvents, { order: [] })
  ]);
  const dedupOrder = Array.isArray(dedupState?.order)
    ? dedupState.order.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const selfOrder = Array.isArray(selfState?.order)
    ? selfState.order.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  return {
    checkpoint: checkpoint && typeof checkpoint === "object" ? checkpoint : {},
    dedupOrder,
    selfOrder,
    legacyFound: Boolean(dedupOrder.length || selfOrder.length || Object.keys(checkpoint ?? {}).length)
  };
}

export async function readChannelRuntimeState({
  agentHouse,
  channelType
} = {}) {
  const target = channelStatePath(agentHouse, channelType);
  try {
    const text = await fs.readFile(target, "utf8");
    const blocks = parseMapBlocks(text);
    const blockName = `${channelType} channel state`;
    const entries = parseMapEntries(blocks.get(blockName) ?? "");
    const checkpoint = {};
    const dedupOrder = [];
    const selfOrder = [];
    for (const entry of entries) {
      if (entry.key === "checkpoint next batch") {
        const value = parsePyashQuotedText(entry.valueRaw);
        if (value) checkpoint.nextBatch = String(value);
        continue;
      }
      if (entry.key === "dedup event") {
        const value = parsePyashQuotedText(entry.valueRaw);
        const textValue = String(value ?? "").trim();
        if (textValue) dedupOrder.push(textValue);
        continue;
      }
      if (entry.key === "self event") {
        const value = parsePyashQuotedText(entry.valueRaw);
        const textValue = String(value ?? "").trim();
        if (textValue) selfOrder.push(textValue);
      }
    }
    return { checkpoint, dedupOrder, selfOrder, source: "pya" };
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  const legacyState = await readLegacyChannelState(agentHouse, channelType);
  return {
    checkpoint: legacyState.checkpoint,
    dedupOrder: legacyState.dedupOrder,
    selfOrder: legacyState.selfOrder,
    source: legacyState.legacyFound ? "legacy-json" : "empty"
  };
}

export async function writeChannelRuntimeState({
  agentHouse,
  channelType,
  checkpoint,
  dedupOrder,
  selfOrder,
  removeLegacy = true
} = {}) {
  const entries = [];
  const nextBatch = String(checkpoint?.nextBatch ?? "").trim();
  entries.push({
    key: "checkpoint next batch",
    type: "text",
    value: quotePyashText(nextBatch)
  });
  const dedupValues = Array.isArray(dedupOrder) ? dedupOrder : [];
  for (const value of dedupValues) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    entries.push({
      key: "dedup event",
      type: "text",
      value: quotePyashText(text)
    });
  }
  const selfValues = Array.isArray(selfOrder) ? selfOrder : [];
  for (const value of selfValues) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    entries.push({
      key: "self event",
      type: "text",
      value: quotePyashText(text)
    });
  }
  const text = `${mapBlock(`${channelType} channel state`, entries)}\n`;
  const target = channelStatePath(agentHouse, channelType);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text, "utf8");

  if (removeLegacy) {
    const legacy = legacyChannelStatePaths(agentHouse, channelType);
    await Promise.all([
      fs.rm(legacy.checkpoint, { force: true }),
      fs.rm(legacy.dedup, { force: true }),
      fs.rm(legacy.selfEvents, { force: true })
    ]);
  }
}

function routerHealthPath(worldRoot) {
  return path.join(worldRoot, "conduct", "service", "router_health.pya");
}

export async function writeRouterHealthState({
  worldRoot,
  channelType = "",
  activeMode = "",
  fallbackActive = false,
  fallbackReason = "",
  queueDepth = 0,
  lastInputAt = "",
  updatedAt = new Date().toISOString(),
  healthy = true,
  statusText = "ready"
} = {}) {
  if (!worldRoot) return;
  const entries = [
    { key: "channel type", type: "text", value: quotePyashText(String(channelType ?? "")) },
    { key: "active mode", type: "text", value: quotePyashText(String(activeMode ?? "")) },
    { key: "fallback active", type: "bool", value: fallbackActive ? "truth" : "lie" },
    { key: "fallback reason", type: "text", value: quotePyashText(String(fallbackReason ?? "")) },
    { key: "queue depth", type: "num", value: Math.max(0, Math.floor(Number(queueDepth) || 0)) },
    { key: "last input at", type: "text", value: quotePyashText(String(lastInputAt ?? "")) },
    { key: "updated at", type: "text", value: quotePyashText(String(updatedAt ?? "")) },
    { key: "healthy", type: "bool", value: healthy ? "truth" : "lie" },
    { key: "status", type: "text", value: quotePyashText(String(statusText ?? "")) }
  ];
  const target = routerHealthPath(worldRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${mapBlock("router health", entries)}\n`, "utf8");
}

export function readRouterHealthStateSync(worldRoot) {
  const fallback = {
    channelType: "",
    activeMode: "",
    fallbackActive: false,
    fallbackReason: "",
    queueDepth: 0,
    lastInputAt: "",
    updatedAt: "",
    healthy: true,
    statusText: "ready"
  };
  if (!worldRoot) return fallback;
  const target = routerHealthPath(worldRoot);
  try {
    const text = fsSync.readFileSync(target, "utf8");
    const blocks = parseMapBlocks(text);
    const entries = parseMapEntries(blocks.get("router health") ?? "");
    const out = { ...fallback };
    for (const entry of entries) {
      if (entry.key === "channel type") {
        out.channelType = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
        continue;
      }
      if (entry.key === "active mode") {
        out.activeMode = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
        continue;
      }
      if (entry.key === "fallback active") {
        out.fallbackActive = /^truth$/i.test(entry.valueRaw);
        continue;
      }
      if (entry.key === "fallback reason") {
        out.fallbackReason = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
        continue;
      }
      if (entry.key === "queue depth") {
        const depth = Number(entry.valueRaw);
        out.queueDepth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
        continue;
      }
      if (entry.key === "last input at") {
        out.lastInputAt = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
        continue;
      }
      if (entry.key === "updated at") {
        out.updatedAt = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
        continue;
      }
      if (entry.key === "healthy") {
        out.healthy = /^truth$/i.test(entry.valueRaw);
        continue;
      }
      if (entry.key === "status") {
        out.statusText = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim() || "ready";
      }
    }
    return out;
  } catch {
    return fallback;
  }
}
