import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../../beautiful.mjs";
import { parse } from "../../understand/index.mjs";
import {
  ensureSpoolDirs,
  makeSpoolFilename,
  writeSpoolItem,
  listSpoolItemsOldestFirst,
  claimSpoolItem,
  completeSpoolItem,
  failSpoolItem
} from "../../library/spool.mjs";

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

function sanitizeRoomName(raw = "") {
  return String(raw ?? "")
    .trim()
    .replace(/^!/, "")
    .replace(/^#/, "")
    .replace(/[^a-z0-9._:-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "room";
}

function sanitizeScopeSegment(raw = "", fallback = "") {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function filenameMatchesScope(filename, { channelType = "", agentName = "" } = {}) {
  const name = String(filename ?? "").trim().toLowerCase();
  if (!name) return false;
  const channel = sanitizeScopeSegment(channelType);
  const agent = sanitizeScopeSegment(agentName);
  if (channel && !name.includes(`-${channel}-`)) return false;
  if (agent && !name.includes(`-${agent}-`)) return false;
  return true;
}

function envelopeMatchesScope(envelope = {}, { channelType = "", agentName = "" } = {}) {
  const wantChannel = sanitizeScopeSegment(channelType);
  const wantAgent = sanitizeScopeSegment(agentName);
  const hasChannel = sanitizeScopeSegment(envelope?.channelType);
  const hasAgent = sanitizeScopeSegment(envelope?.agentName);
  if (wantChannel && hasChannel !== wantChannel) return false;
  if (wantAgent && hasAgent !== wantAgent) return false;
  return true;
}

async function requeueClaim(paths, claim, phase = "input") {
  const requeueDir = phase === "produce" ? paths.produceDir : paths.inputDir;
  await failSpoolItem({
    runtimePath: claim?.path,
    failDir: paths.produceFailDir,
    requeueDir,
    retryCount: 0,
    maxRetries: 1
  });
}

export function channelQueuePaths(worldRoot) {
  const root = path.join(worldRoot, "holding", "channel");
  const produceRoot = path.join(root, "produce");
  return {
    root,
    inputDir: path.join(root, "input"),
    runtimeDir: path.join(root, "runtime"),
    produceDir: path.join(produceRoot, "waiting"),
    produceSuccessDir: path.join(produceRoot, "success"),
    produceFailDir: path.join(produceRoot, "fail"),
    artifactsDir: path.join(root, "artifacts"),
    tmpDir: path.join(root, "tmp")
  };
}

async function migrateLegacyProduceWaiting(paths) {
  const legacyDir = path.join(paths.root, "produce");
  let entries = [];
  try {
    entries = await fs.readdir(legacyDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  const moves = [];
  for (const entry of entries) {
    if (!entry?.isFile?.()) continue;
    const fromPath = path.join(legacyDir, entry.name);
    const toPath = path.join(paths.produceDir, entry.name);
    moves.push(fs.rename(fromPath, toPath).catch(() => {}));
  }
  await Promise.all(moves);
}

export async function ensureChannelQueueDirs(worldRoot) {
  const paths = channelQueuePaths(worldRoot);
  await ensureSpoolDirs(paths.root, [
    paths.inputDir,
    paths.runtimeDir,
    paths.produceDir,
    paths.produceSuccessDir,
    paths.produceFailDir,
    paths.artifactsDir,
    paths.tmpDir
  ]);
  await migrateLegacyProduceWaiting(paths);
  return paths;
}

function envelopeToText(envelope = {}) {
  const payloadSentenceText = sentenceToPyash(envelope.payloadSentence ?? {});
  const entries = [
    { key: "phase", type: "text", value: quotePyashText(String(envelope.phase ?? "").trim()) },
    { key: "queued at", type: "text", value: quotePyashText(String(envelope.queuedAt ?? "")) },
    { key: "retry count", type: "num", value: Math.max(0, Math.trunc(Number(envelope.retryCount) || 0)) },
    { key: "channel type", type: "text", value: quotePyashText(String(envelope.channelType ?? "")) },
    { key: "identity", type: "text", value: quotePyashText(String(envelope.identity ?? "")) },
    { key: "agent name", type: "text", value: quotePyashText(String(envelope.agentName ?? "")) },
    { key: "room name", type: "text", value: quotePyashText(String(envelope.roomName ?? "")) },
    { key: "payload", type: "text", value: quotePyashText(payloadSentenceText) }
  ];
  if (envelope.payloadId) {
    entries.push({ key: "payload id", type: "text", value: quotePyashText(String(envelope.payloadId)) });
  }
  if (envelope.eventId) {
    entries.push({ key: "event id", type: "text", value: quotePyashText(String(envelope.eventId)) });
  }
  return `${mapBlock("channel queue envelope", entries)}\n`;
}

function envelopeFromText(text) {
  const blocks = parseMapBlocks(text);
  const entries = parseMapEntries(blocks.get("channel queue envelope") ?? "");
  const out = {
    phase: "",
    queuedAt: "",
    retryCount: 0,
    channelType: "",
    identity: "",
    agentName: "",
    roomName: "",
    payloadId: "",
    eventId: "",
    payloadSentence: null
  };
  for (const entry of entries) {
    if (entry.key === "phase") out.phase = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "queued at") out.queuedAt = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "retry count") out.retryCount = Math.max(0, Math.trunc(Number(entry.valueRaw) || 0));
    if (entry.key === "channel type") out.channelType = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "identity") out.identity = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "agent name") out.agentName = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "room name") out.roomName = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "payload id") out.payloadId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "event id") out.eventId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "payload") {
      const payloadText = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
      if (payloadText) {
        try {
          out.payloadSentence = parse(payloadText);
        } catch {
          out.payloadSentence = null;
        }
      }
    }
  }
  return out;
}

function buildFilename(envelope = {}) {
  const hashSource = envelope.eventId
    || envelope.payloadId
    || sentenceToPyash(envelope.payloadSentence ?? {});
  return makeSpoolFilename({
    at: envelope.queuedAt || new Date(),
    channelType: envelope.channelType || "channel",
    agentName: envelope.agentName || "agent",
    roomName: sanitizeRoomName(envelope.roomName),
    kind: envelope.phase === "produce" ? "produce" : "event",
    hashSource
  });
}

export async function enqueueInputEnvelope(worldRoot, envelope = {}) {
  const paths = await ensureChannelQueueDirs(worldRoot);
  const normalized = {
    ...envelope,
    phase: "input",
    queuedAt: envelope.queuedAt || new Date().toISOString()
  };
  const filename = buildFilename(normalized);
  const text = envelopeToText(normalized);
  return writeSpoolItem({ tmpDir: paths.tmpDir, targetDir: paths.inputDir, filename, text });
}

export async function enqueueProduceEnvelope(worldRoot, envelope = {}) {
  const paths = await ensureChannelQueueDirs(worldRoot);
  const normalized = {
    ...envelope,
    phase: "produce",
    queuedAt: envelope.queuedAt || new Date().toISOString()
  };
  const filename = buildFilename(normalized);
  const text = envelopeToText(normalized);
  return writeSpoolItem({ tmpDir: paths.tmpDir, targetDir: paths.produceDir, filename, text });
}

async function readEnvelopeFile(targetPath) {
  const text = await fs.readFile(targetPath, "utf8");
  return envelopeFromText(text);
}

export async function claimOldestInputEnvelope(
  worldRoot,
  { workerTag = "", channelType = "", agentName = "" } = {}
) {
  const paths = await ensureChannelQueueDirs(worldRoot);
  const pending = await listSpoolItemsOldestFirst(paths.inputDir);
  for (const filename of pending) {
    if (!filenameMatchesScope(filename, { channelType, agentName })) continue;
    const claim = await claimSpoolItem({
      fromDir: paths.inputDir,
      runtimeDir: paths.runtimeDir,
      filename,
      workerTag
    });
    if (!claim) continue;
    const envelope = await readEnvelopeFile(claim.path);
    if (!envelopeMatchesScope(envelope, { channelType, agentName })) {
      await requeueClaim(paths, claim, "input");
      continue;
    }
    return { ...claim, envelope };
  }
  return null;
}

export async function claimOldestProduceEnvelope(
  worldRoot,
  { workerTag = "", channelType = "", agentName = "" } = {}
) {
  const paths = await ensureChannelQueueDirs(worldRoot);
  const pending = await listSpoolItemsOldestFirst(paths.produceDir);
  for (const filename of pending) {
    if (!filenameMatchesScope(filename, { channelType, agentName })) continue;
    const claim = await claimSpoolItem({
      fromDir: paths.produceDir,
      runtimeDir: paths.runtimeDir,
      filename,
      workerTag
    });
    if (!claim) continue;
    const envelope = await readEnvelopeFile(claim.path);
    if (!envelopeMatchesScope(envelope, { channelType, agentName })) {
      await requeueClaim(paths, claim, "produce");
      continue;
    }
    return { ...claim, envelope };
  }
  return null;
}

export async function ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath } = {}) {
  const paths = await ensureChannelQueueDirs(worldRoot);
  return completeSpoolItem({
    runtimePath,
    successDir: paths.produceSuccessDir
  });
}

export async function ackRuntimeEnvelopeFail(
  worldRoot,
  { runtimePath, retryCount = 0, maxRetries = 0, requeuePhase = "input" } = {}
) {
  const paths = await ensureChannelQueueDirs(worldRoot);
  const requeueDir = requeuePhase === "produce" ? paths.produceDir : paths.inputDir;
  return failSpoolItem({
    runtimePath,
    failDir: paths.produceFailDir,
    requeueDir,
    retryCount,
    maxRetries
  });
}

export async function queueDepth(worldRoot) {
  const paths = await ensureChannelQueueDirs(worldRoot);
  const [input, produce] = await Promise.all([
    listSpoolItemsOldestFirst(paths.inputDir),
    listSpoolItemsOldestFirst(paths.produceDir)
  ]);
  return {
    input: input.length,
    produce: produce.length,
    total: input.length + produce.length
  };
}
