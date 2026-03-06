import fs from "node:fs/promises";

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
import { holdingLanePaths, ensureHoldingLaneDirs } from "../holding_lane/layout.mjs";

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

function sanitizeDeviceId(raw = "") {
  return String(raw ?? "")
    .trim()
    .replace(/[^a-z0-9._:-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "device";
}

function sanitizeScopeSegment(raw = "", fallback = "") {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function filenameMatchesScope(filename, { deviceId = "", agentName = "" } = {}) {
  const name = String(filename ?? "").trim().toLowerCase();
  if (!name) return false;
  const device = sanitizeScopeSegment(deviceId);
  const agent = sanitizeScopeSegment(agentName);
  if (device && !name.includes(`-${device}-`)) return false;
  if (agent && !name.includes(`-${agent}-`)) return false;
  return true;
}

function envelopeMatchesScope(envelope = {}, { deviceId = "", agentName = "" } = {}) {
  const wantDevice = sanitizeScopeSegment(deviceId);
  const wantAgent = sanitizeScopeSegment(agentName);
  const hasDevice = sanitizeScopeSegment(envelope?.deviceId);
  const hasAgent = sanitizeScopeSegment(envelope?.agentName);
  if (wantDevice && hasDevice !== wantDevice) return false;
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

export function androidQueuePaths(worldRoot) {
  return holdingLanePaths(worldRoot, { lane: "android" });
}

export async function ensureAndroidQueueDirs(worldRoot) {
  return ensureHoldingLaneDirs(worldRoot, { lane: "android", migrateLegacyProduce: true });
}

function envelopeToText(envelope = {}) {
  const payloadSentenceText = sentenceToPyash(envelope.payloadSentence ?? {});
  const entries = [
    { key: "phase", type: "text", value: quotePyashText(String(envelope.phase ?? "").trim()) },
    { key: "queued at", type: "text", value: quotePyashText(String(envelope.queuedAt ?? "")) },
    { key: "retry count", type: "num", value: Math.max(0, Math.trunc(Number(envelope.retryCount) || 0)) },
    { key: "device id", type: "text", value: quotePyashText(String(envelope.deviceId ?? "")) },
    { key: "identity", type: "text", value: quotePyashText(String(envelope.identity ?? "")) },
    { key: "agent name", type: "text", value: quotePyashText(String(envelope.agentName ?? "")) },
    { key: "payload", type: "text", value: quotePyashText(payloadSentenceText) }
  ];
  if (envelope.payloadId) {
    entries.push({ key: "payload id", type: "text", value: quotePyashText(String(envelope.payloadId)) });
  }
  if (envelope.commandId) {
    entries.push({ key: "command id", type: "text", value: quotePyashText(String(envelope.commandId)) });
  }
  return `${mapBlock("android queue envelope", entries)}\n`;
}

function envelopeFromText(text) {
  const blocks = parseMapBlocks(text);
  const entries = parseMapEntries(blocks.get("android queue envelope") ?? "");
  const out = {
    phase: "",
    queuedAt: "",
    retryCount: 0,
    deviceId: "",
    identity: "",
    agentName: "",
    payloadId: "",
    commandId: "",
    payloadSentence: null
  };
  for (const entry of entries) {
    if (entry.key === "phase") out.phase = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "queued at") out.queuedAt = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "retry count") out.retryCount = Math.max(0, Math.trunc(Number(entry.valueRaw) || 0));
    if (entry.key === "device id") out.deviceId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "identity") out.identity = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "agent name") out.agentName = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "payload id") out.payloadId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "command id") out.commandId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
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
  const hashSource = envelope.commandId || envelope.payloadId || sentenceToPyash(envelope.payloadSentence ?? {});
  return makeSpoolFilename({
    at: envelope.queuedAt || new Date(),
    channelType: "android",
    agentName: envelope.agentName || "agent",
    roomName: sanitizeDeviceId(envelope.deviceId),
    kind: envelope.phase === "produce" ? "produce" : "event",
    hashSource
  });
}

export async function enqueueInputEnvelope(worldRoot, envelope = {}) {
  const paths = await ensureAndroidQueueDirs(worldRoot);
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
  const paths = await ensureAndroidQueueDirs(worldRoot);
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
  { workerTag = "", deviceId = "", agentName = "" } = {}
) {
  const paths = await ensureAndroidQueueDirs(worldRoot);
  const pending = await listSpoolItemsOldestFirst(paths.inputDir);
  for (const filename of pending) {
    if (!filenameMatchesScope(filename, { deviceId, agentName })) continue;
    const claim = await claimSpoolItem({
      fromDir: paths.inputDir,
      runtimeDir: paths.runtimeDir,
      filename,
      workerTag
    });
    if (!claim) continue;
    const envelope = await readEnvelopeFile(claim.path);
    if (!envelopeMatchesScope(envelope, { deviceId, agentName })) {
      await requeueClaim(paths, claim, "input");
      continue;
    }
    return { ...claim, envelope };
  }
  return null;
}

export async function claimOldestProduceEnvelope(
  worldRoot,
  { workerTag = "", deviceId = "", agentName = "" } = {}
) {
  const paths = await ensureAndroidQueueDirs(worldRoot);
  const pending = await listSpoolItemsOldestFirst(paths.produceDir);
  for (const filename of pending) {
    if (!filenameMatchesScope(filename, { deviceId, agentName })) continue;
    const claim = await claimSpoolItem({
      fromDir: paths.produceDir,
      runtimeDir: paths.runtimeDir,
      filename,
      workerTag
    });
    if (!claim) continue;
    const envelope = await readEnvelopeFile(claim.path);
    if (!envelopeMatchesScope(envelope, { deviceId, agentName })) {
      await requeueClaim(paths, claim, "produce");
      continue;
    }
    return { ...claim, envelope };
  }
  return null;
}

export async function ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath } = {}) {
  const paths = await ensureAndroidQueueDirs(worldRoot);
  return completeSpoolItem({
    runtimePath,
    successDir: paths.produceSuccessDir
  });
}

export async function ackRuntimeEnvelopeFail(
  worldRoot,
  { runtimePath, retryCount = 0, maxRetries = 0, requeuePhase = "input" } = {}
) {
  const paths = await ensureAndroidQueueDirs(worldRoot);
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
  const paths = await ensureAndroidQueueDirs(worldRoot);
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
