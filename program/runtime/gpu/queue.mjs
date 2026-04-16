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
import { holdingLanePaths, ensureHoldingLaneDirs } from "../../agent/holding_lane/layout.mjs";
import {
  buildGpuQueueEnvelope,
  assertGpuQueueEnvelope,
  normalizeGpuId,
  normalizeLane
} from "./contract.mjs";

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

function sanitizeScopeSegment(raw = "", fallback = "") {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function filenameMatchesScope(filename, { gpuId = "", agentName = "" } = {}) {
  const name = String(filename ?? "").trim().toLowerCase();
  if (!name) return false;
  const gpu = sanitizeScopeSegment(gpuId);
  const agent = sanitizeScopeSegment(agentName);
  if (gpu && !name.includes(`-${gpu}-`)) return false;
  if (agent && !name.includes(`-${agent}-`)) return false;
  return true;
}

function envelopeMatchesScope(envelope = {}, { gpuId = "", agentName = "" } = {}) {
  const wantGpu = sanitizeScopeSegment(gpuId);
  const wantAgent = sanitizeScopeSegment(agentName);
  const hasGpu = sanitizeScopeSegment(envelope?.gpuId);
  const hasAgent = sanitizeScopeSegment(envelope?.agentName);
  if (wantGpu && hasGpu !== wantGpu) return false;
  if (wantAgent && hasAgent !== wantAgent) return false;
  return true;
}

function laneMatches(envelope = {}, lane = "") {
  const wantLane = normalizeLane(lane, "");
  if (!wantLane) return true;
  const hasLane = normalizeLane(envelope?.lane, "durable");
  return hasLane === wantLane;
}

function encodeSpecValue(value) {
  if (value == null) {
    return JSON.stringify({ kind: "text", value: "" });
  }
  if (typeof value === "string") {
    return JSON.stringify({ kind: "text", value });
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify({ kind: "map", value });
  }
  return JSON.stringify({ kind: "text", value: String(value) });
}

function decodeSpecValue(valueRaw) {
  const text = String(parsePyashQuotedText(valueRaw) ?? "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      if (parsed.kind === "map" && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
        return parsed.value;
      }
      if (parsed.kind === "text") {
        return String(parsed.value ?? "");
      }
    }
  } catch {
    // fall through
  }
  return text;
}

function envelopeToText(envelope = {}) {
  const payloadSentenceText = sentenceToPyash(envelope.payloadSentence ?? {});
  const entries = [
    { key: "phase", type: "text", value: quotePyashText(String(envelope.phase ?? "").trim()) },
    { key: "queued at", type: "text", value: quotePyashText(String(envelope.queuedAt ?? "")) },
    { key: "retry count", type: "num", value: Math.max(0, Math.trunc(Number(envelope.retryCount) || 0)) },
    { key: "lane", type: "text", value: quotePyashText(String(envelope.lane || "durable")) },
    { key: "gpu id", type: "text", value: quotePyashText(String(envelope.gpuId ?? "")) },
    { key: "agent name", type: "text", value: quotePyashText(String(envelope.agentName ?? "")) },
    { key: "handle id", type: "text", value: quotePyashText(String(envelope.handleId ?? "")) },
    { key: "intent", type: "text", value: quotePyashText(String(envelope.intent ?? "")) },
    { key: "payload", type: "text", value: quotePyashText(payloadSentenceText) },
    { key: "host id", type: "text", value: quotePyashText(String(envelope.hostId ?? "")) },
    { key: "device id", type: "text", value: quotePyashText(String(envelope.deviceId ?? "")) },
    { key: "service name", type: "text", value: quotePyashText(String(envelope.serviceName ?? "")) },
    { key: "residency name", type: "text", value: quotePyashText(String(envelope.residencyName ?? "")) },
    { key: "residency required", type: "bool", value: envelope.residencyRequired === true ? "yes" : "no" },
    { key: "begin required", type: "bool", value: envelope.beginRequired === true ? "yes" : "no" },
    { key: "discharge allowed", type: "bool", value: envelope.dischargeAllowed !== false ? "yes" : "no" },
    { key: "begin spec", type: "text", value: quotePyashText(encodeSpecValue(envelope.beginSpec)) },
    { key: "job spec", type: "text", value: quotePyashText(encodeSpecValue(envelope.jobSpec)) },
    { key: "remote job id", type: "text", value: quotePyashText(String(envelope.remoteJobId ?? "")) }
  ];
  return `${mapBlock("gpu queue envelope", entries)}\n`;
}

function parseBoolValue(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  return ["yes", "true", "1", "on"].includes(text);
}

function envelopeFromText(text) {
  const blocks = parseMapBlocks(text);
  const entries = parseMapEntries(blocks.get("gpu queue envelope") ?? "");
  const out = {
    phase: "",
    handleId: "",
    agentName: "",
    gpuId: "",
    intent: "",
    lane: "durable",
    queuedAt: "",
    retryCount: 0,
    payloadSentence: null,
    hostId: "",
    deviceId: "",
    serviceName: "",
    residencyName: "",
    residencyRequired: false,
    beginRequired: false,
    dischargeAllowed: true,
    beginSpec: "",
    jobSpec: "",
    remoteJobId: ""
  };
  for (const entry of entries) {
    if (entry.key === "phase") out.phase = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "queued at") out.queuedAt = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "retry count") out.retryCount = Math.max(0, Math.trunc(Number(entry.valueRaw) || 0));
    if (entry.key === "lane") out.lane = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim() || "durable";
    if (entry.key === "gpu id") out.gpuId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "agent name") out.agentName = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "handle id") out.handleId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "intent") out.intent = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
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
    if (entry.key === "host id") out.hostId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "device id") out.deviceId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "service name") out.serviceName = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "residency name") out.residencyName = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
    if (entry.key === "residency required") out.residencyRequired = parseBoolValue(entry.valueRaw);
    if (entry.key === "begin required") out.beginRequired = parseBoolValue(entry.valueRaw);
    if (entry.key === "discharge allowed") out.dischargeAllowed = parseBoolValue(entry.valueRaw);
    if (entry.key === "begin spec") out.beginSpec = decodeSpecValue(entry.valueRaw);
    if (entry.key === "job spec") out.jobSpec = decodeSpecValue(entry.valueRaw);
    if (entry.key === "remote job id") out.remoteJobId = String(parsePyashQuotedText(entry.valueRaw) ?? "").trim();
  }
  return out;
}

function buildFilename(envelope = {}) {
  const hashSource = envelope.handleId || sentenceToPyash(envelope.payloadSentence ?? {});
  return makeSpoolFilename({
    at: envelope.queuedAt || new Date(),
    channelType: "gpu",
    agentName: envelope.agentName || "agent",
    roomName: normalizeGpuId(envelope.gpuId) || "gpu",
    kind: envelope.phase === "produce" ? "produce" : "event",
    hashSource
  });
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

async function readEnvelopeFile(targetPath) {
  const text = await fs.readFile(targetPath, "utf8");
  return envelopeFromText(text);
}

export function gpuQueuePaths(worldRoot) {
  return holdingLanePaths(worldRoot, { lane: "gpu" });
}

export async function ensureGpuQueueDirs(worldRoot) {
  return ensureHoldingLaneDirs(worldRoot, { lane: "gpu", migrateLegacyProduce: true });
}

export async function enqueueInputEnvelope(worldRoot, envelope = {}) {
  const paths = await ensureGpuQueueDirs(worldRoot);
  const normalized = buildGpuQueueEnvelope({
    ...envelope,
    phase: "input",
    queuedAt: envelope?.queuedAt || new Date().toISOString()
  });
  assertGpuQueueEnvelope(normalized);
  const filename = buildFilename({ ...normalized, phase: "input" });
  const text = envelopeToText({ ...normalized, phase: "input" });
  return writeSpoolItem({ tmpDir: paths.tmpDir, targetDir: paths.inputDir, filename, text });
}

export async function enqueueProduceEnvelope(worldRoot, envelope = {}) {
  const paths = await ensureGpuQueueDirs(worldRoot);
  const normalized = buildGpuQueueEnvelope({
    ...envelope,
    phase: "produce",
    queuedAt: envelope?.queuedAt || new Date().toISOString()
  });
  assertGpuQueueEnvelope(normalized);
  const filename = buildFilename({ ...normalized, phase: "produce" });
  const text = envelopeToText({ ...normalized, phase: "produce" });
  return writeSpoolItem({ tmpDir: paths.tmpDir, targetDir: paths.produceDir, filename, text });
}

export async function claimOldestInputEnvelope(
  worldRoot,
  { workerTag = "", gpuId = "", agentName = "", lane = "" } = {}
) {
  const paths = await ensureGpuQueueDirs(worldRoot);
  const pending = await listSpoolItemsOldestFirst(paths.inputDir);
  for (const filename of pending) {
    if (!filenameMatchesScope(filename, { gpuId, agentName })) continue;
    const claim = await claimSpoolItem({
      fromDir: paths.inputDir,
      runtimeDir: paths.runtimeDir,
      filename,
      workerTag
    });
    if (!claim) continue;
    const envelope = await readEnvelopeFile(claim.path);
    try {
      assertGpuQueueEnvelope(envelope);
    } catch {
      await requeueClaim(paths, claim, "input");
      continue;
    }
    if (!envelopeMatchesScope(envelope, { gpuId, agentName }) || !laneMatches(envelope, lane)) {
      await requeueClaim(paths, claim, "input");
      continue;
    }
    return { ...claim, envelope };
  }
  return null;
}

export async function claimOldestProduceEnvelope(
  worldRoot,
  { workerTag = "", gpuId = "", agentName = "", lane = "" } = {}
) {
  const paths = await ensureGpuQueueDirs(worldRoot);
  const pending = await listSpoolItemsOldestFirst(paths.produceDir);
  for (const filename of pending) {
    if (!filenameMatchesScope(filename, { gpuId, agentName })) continue;
    const claim = await claimSpoolItem({
      fromDir: paths.produceDir,
      runtimeDir: paths.runtimeDir,
      filename,
      workerTag
    });
    if (!claim) continue;
    const envelope = await readEnvelopeFile(claim.path);
    try {
      assertGpuQueueEnvelope(envelope);
    } catch {
      await requeueClaim(paths, claim, "produce");
      continue;
    }
    if (!envelopeMatchesScope(envelope, { gpuId, agentName }) || !laneMatches(envelope, lane)) {
      await requeueClaim(paths, claim, "produce");
      continue;
    }
    return { ...claim, envelope };
  }
  return null;
}

export async function ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath } = {}) {
  const paths = await ensureGpuQueueDirs(worldRoot);
  return completeSpoolItem({
    runtimePath,
    successDir: paths.produceSuccessDir
  });
}

export async function ackRuntimeEnvelopeFail(
  worldRoot,
  { runtimePath, retryCount = 0, maxRetries = 0, requeuePhase = "input" } = {}
) {
  const paths = await ensureGpuQueueDirs(worldRoot);
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
  const paths = await ensureGpuQueueDirs(worldRoot);
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
