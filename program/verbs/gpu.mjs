import crypto from "node:crypto";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import {
  ASYNC_LANE_DURABLE,
  resolveAsyncLane
} from "../library/async_lane.mjs";
import { enqueueInputEnvelope } from "../runtime/gpu/queue.mjs";
import {
  isTerminalHandleStatus,
  readGpuHandleStatus,
  writeGpuHandleStatus
} from "../runtime/gpu/handle_status.mjs";

function nowIso() {
  return new Date().toISOString();
}

function shortHash(text) {
  return crypto.createHash("sha1").update(String(text ?? "")).digest("hex").slice(0, 10);
}

function cloneValue(value) {
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeIntent(rawBe = "") {
  const lower = String(rawBe ?? "").trim().toLowerCase();
  if (lower.startsWith("gpu ")) return lower.slice("gpu ".length).trim();
  return lower;
}

function readVyahMode(sentence = {}) {
  const values = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  return String(values[0] ?? "").trim().toLowerCase();
}

function resolveAgentName(sentence = {}, { rememberFn = remember } = {}) {
  const direct = String(sentence?.for?.name ?? "").trim();
  if (direct) return direct;
  const mind = rememberFn("mind name");
  const mindName = String(mind?.ob?.name ?? mind?.ob?.text ?? "").trim();
  if (mindName) return mindName;
  return "agent";
}

function resolveGpuId(sentence = {}, { rememberFn = remember } = {}) {
  const direct = String(sentence?.from?.text ?? sentence?.from?.name ?? "").trim();
  if (direct) return direct;
  const configured = rememberFn("gpu id");
  const fromConfig = String(configured?.ob?.text ?? configured?.ob?.name ?? "").trim();
  if (fromConfig) return fromConfig;
  return process.env.PYA_GPU_ID || "gpu-0";
}

function resolveHandleId(sentence = {}) {
  const explicit = String(sentence?.su?.name ?? "").trim();
  if (explicit) return explicit;
  const seed = `${nowIso()}|${sentence?.be ?? "gpu"}|${JSON.stringify(sentence?.ob ?? {})}`;
  return `gpu-${shortHash(seed)}`;
}

function ensureIntent(intent, sentence) {
  if (!intent || intent === "status" || intent === "await") {
    throwErrorSentence({
      name: "gpu duty defective",
      message: "gpu duty defective: missing intent",
      from: { name: "gpu" },
      raw: { sentence }
    });
  }
  return intent;
}

function parseJsonMap(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function pyashMapToPlain(map = {}) {
  const out = {};
  for (const [key, value] of Object.entries(map || {})) {
    if (value?.map && typeof value.map === "object" && !Array.isArray(value.map)) {
      out[key] = pyashMapToPlain(value.map);
    } else if (Object.prototype.hasOwnProperty.call(value || {}, "text")) {
      const parsed = parseJsonMap(value.text);
      out[key] = parsed ?? String(value.text ?? "");
    } else if (Object.prototype.hasOwnProperty.call(value || {}, "name")) {
      out[key] = String(value.name ?? "");
    } else if (Object.prototype.hasOwnProperty.call(value || {}, "filename")) {
      out[key] = String(value.filename ?? "");
    } else if (Object.prototype.hasOwnProperty.call(value || {}, "num")) {
      out[key] = Number(value.num);
    } else if (Object.prototype.hasOwnProperty.call(value || {}, "bool")) {
      out[key] = value.bool === true;
    }
  }
  return out;
}

function defaultRuntimeForIntent(intent, jobSpec = {}, sentence = {}) {
  const runtimeName = String(sentence?.as?.name ?? sentence?.fromstate?.text ?? jobSpec.runtimeName ?? "").trim();
  if (runtimeName) return runtimeName;
  if (intent === "mind") return "ollama";
  if (intent === "draw" || intent === "say" || intent === "hear") return "comfyui";
  return "";
}

function defaultProfileForIntent(intent, jobSpec = {}, sentence = {}, { rememberFn = remember } = {}) {
  const direct = String(sentence?.to?.name ?? sentence?.to?.text ?? jobSpec.profileName ?? "").trim();
  if (direct) return direct;
  if (intent === "mind") {
    const configured = rememberFn("mind model") || rememberFn("mind ollama model");
    const model = String(configured?.ob?.text ?? configured?.ob?.name ?? "").trim();
    return model || String(jobSpec.model ?? "").trim() || "llama3.2";
  }
  return String(jobSpec.model ?? jobSpec.workflow ?? intent).trim() || intent;
}

function buildMindJobSpec(sentence = {}, intent = "mind", { rememberFn = remember } = {}) {
  const explicit = sentence?.ob?.map ? pyashMapToPlain(sentence.ob.map) : parseJsonMap(sentence?.ob?.text);
  if (explicit) return explicit;

  const prompt = String(sentence?.ob?.text ?? "").trim();
  if (!prompt) {
    throwErrorSentence({
      name: "gpu duty defective",
      message: "gpu duty defective: mind requires ob text prompt or ob map/json jobSpec",
      from: { name: "gpu" },
      raw: { sentence }
    });
  }
  const configured = rememberFn("mind model") || rememberFn("mind ollama model");
  const model = String(sentence?.to?.name ?? sentence?.to?.text ?? configured?.ob?.text ?? configured?.ob?.name ?? "").trim() || "llama3.2";
  return {
    kind: "ollama-generate",
    model,
    prompt,
    stream: false
  };
}

function buildJobSpec(sentence = {}, intent = "", { rememberFn = remember } = {}) {
  if (intent === "mind") return buildMindJobSpec(sentence, intent, { rememberFn });
  const explicit = sentence?.ob?.map ? pyashMapToPlain(sentence.ob.map) : parseJsonMap(sentence?.ob?.text);
  if (explicit) return explicit;
  throwErrorSentence({
    name: "gpu duty defective",
    message: `${intent} gpu duty defective: requires ob map or ob text JSON jobSpec`,
    from: { name: "gpu" },
    raw: { sentence }
  });
}

function buildPayloadSentence(call = {}, intent = "") {
  const next = cloneValue(call);
  next.be = `gpu ${intent}`;
  next.mood = "do";
  return next;
}

function queuedSentence({ handleId, intent, gpuId, lane, stateText = "queued" }) {
  return {
    mood: "ya",
    su: { name: handleId },
    be: "duty",
    vyah: { ve: { type: "name", values: ["start", "success"] } },
    as: { name: intent },
    from: { text: gpuId },
    fromstate: { text: lane },
    ob: { text: stateText },
    since: { date: nowIso() }
  };
}

function statusSentence({ mode = "status", state = null, handleId = "" } = {}) {
  const current = state || {};
  const status = String(current.status || "missing").trim() || "missing";
  const vyahValues = isTerminalHandleStatus(status) ? [mode, status] : [mode];
  return {
    mood: "ya",
    su: { name: String(handleId || current.handleId || "").trim() || "gpu-handle" },
    be: "duty",
    vyah: { ve: { type: "name", values: vyahValues } },
    as: { name: String(current.intent || "").trim() || "unknown" },
    from: { text: String(current.gpuId || "").trim() || "" },
    totext: { text: String(current.lane || "").trim() || "" },
    ob: { text: status },
    fromstate: { text: String(current.message || current.outcome || "").trim() || "" },
    result: { text: String(current.result || "").trim() || "" },
    error: { text: String(current.error || "").trim() || "" },
    since: { date: String(current.queuedAt || "").trim() || "" },
    during: { date: String(current.finishedAt || current.startedAt || "").trim() || "" }
  };
}

async function handleStatus(call, { worldRoot } = {}) {
  const handleId = String(call?.accordingto?.text ?? call?.su?.name ?? "").trim();
  if (!handleId) {
    throwErrorSentence({
      name: "gpu duty defective",
      message: "gpu duty defective: status requires accordingto text <handle id>",
      from: { name: "gpu" },
      raw: { call }
    });
  }
  const state = await readGpuHandleStatus(worldRoot, handleId);
  if (!state) {
    throwErrorSentence({
      name: "gpu duty defective",
      message: `gpu duty defective: unknown handle ${JSON.stringify(handleId)}`,
      from: { name: "gpu" },
      raw: { call }
    });
  }
  return statusSentence({ mode: "status", state, handleId });
}

async function handleAwait(call, { worldRoot } = {}) {
  const handleId = String(call?.accordingto?.text ?? call?.su?.name ?? "").trim();
  if (!handleId) {
    throwErrorSentence({
      name: "gpu duty defective",
      message: "gpu duty defective: await requires accordingto text <handle id>",
      from: { name: "gpu" },
      raw: { call }
    });
  }
  const timeoutMs = Math.max(1000, Math.trunc(Number(call?.during?.num) || 120000));
  const pollMs = 250;
  const start = Date.now();

  while ((Date.now() - start) <= timeoutMs) {
    const state = await readGpuHandleStatus(worldRoot, handleId);
    if (!state) {
      throwErrorSentence({
        name: "gpu duty defective",
        message: `gpu duty defective: unknown handle ${JSON.stringify(handleId)}`,
        from: { name: "gpu" },
        raw: { call }
      });
    }
    if (isTerminalHandleStatus(state.status)) {
      return statusSentence({ mode: "await", state, handleId });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const current = await readGpuHandleStatus(worldRoot, handleId);
  const base = current || { status: "timeout" };
  if (!isTerminalHandleStatus(base.status)) {
    base.message = `await timeout: handle still ${base.status}; start gpu worker: PYA_GPU_HOUSEKEEPER_URL=<url> node command/gpu_worker.mjs --world ${worldRoot}`;
  } else if (!base.message) {
    base.message = "await timeout";
  }
  return statusSentence({ mode: "await", state: base, handleId });
}

export async function gpu(call, { remember: rememberFn = remember } = {}) {
  const vyahMode = readVyahMode(call);
  const intent = normalizeIntent(call?.be);
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");

  if (intent === "status" || vyahMode === "status") return handleStatus(call, { worldRoot });
  if (intent === "await" || vyahMode === "await") return handleAwait(call, { worldRoot });
  ensureIntent(intent, call);

  if (vyahMode !== "start") {
    throwErrorSentence({
      name: "gpu duty defective",
      message: `gpu duty defective: ${intent} requires vyah start`,
      from: { name: "gpu" },
      raw: { call }
    });
  }

  const handleId = resolveHandleId(call);
  const agentName = resolveAgentName(call, { rememberFn });
  const gpuId = resolveGpuId(call, { rememberFn });
  const queuedAt = nowIso();
  const lane = resolveAsyncLane(call, { defaultLane: ASYNC_LANE_DURABLE, verb: "gpu" }).lane;
  const jobSpec = buildJobSpec(call, intent, { rememberFn });
  const serviceName = defaultRuntimeForIntent(intent, jobSpec, call);
  const residencyName = defaultProfileForIntent(intent, jobSpec, call, { rememberFn });

  if (!serviceName || !residencyName) {
    throwErrorSentence({
      name: "gpu duty defective",
      message: "gpu duty defective: missing runtime/profile for housekeeper job",
      from: { name: "gpu" },
      raw: { call }
    });
  }

  await enqueueInputEnvelope(worldRoot, {
    handleId,
    agentName,
    gpuId,
    intent,
    lane,
    queuedAt,
    payloadSentence: buildPayloadSentence(call, intent),
    serviceName,
    residencyName,
    residencyRequired: true,
    beginRequired: true,
    dischargeAllowed: true,
    jobSpec
  });
  await writeGpuHandleStatus(worldRoot, handleId, {
    handleId,
    status: "queued",
    agentName,
    gpuId,
    intent,
    lane,
    queuedAt,
    outcome: "queued",
    message: "queued",
    result: "",
    error: ""
  });

  return queuedSentence({ handleId, intent, gpuId, lane, stateText: "queued" });
}

export default gpu;

export const signatures = [
  { signatureWords: ["be", "gpu", "mind", "ob", "text", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "mind", "ob", "text", "to", "name", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "mind", "ob", "map", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "draw", "ob", "text", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "draw", "ob", "map", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "say", "ob", "text", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "say", "ob", "map", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "hear", "ob", "text", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "hear", "ob", "map", "vyah", "start"], handler: gpu },
  { signatureWords: ["be", "gpu", "status", "accordingto", "text"], handler: gpu },
  { signatureWords: ["be", "gpu", "await", "accordingto", "text"], handler: gpu },
  { signatureWords: ["be", "gpu", "await", "accordingto", "text", "during", "num"], handler: gpu },
  { signatureWords: ["be", "gpu", "accordingto", "text", "vyah", "status"], handler: gpu },
  { signatureWords: ["be", "gpu", "accordingto", "text", "vyah", "await"], handler: gpu },
  { signatureWords: ["be", "gpu", "accordingto", "text", "during", "num", "vyah", "await"], handler: gpu }
];
