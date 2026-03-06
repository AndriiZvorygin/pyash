import crypto from "node:crypto";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { enqueueInputEnvelope } from "../agent/android_core/queue.mjs";
import {
  readAndroidHandleState,
  writeAndroidHandleState,
  isTerminalHandleStatus
} from "../agent/android/state.mjs";

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
  if (lower.startsWith("android ")) return lower.slice("android ".length).trim();
  return lower;
}

function resolveDeviceId(sentence = {}, { rememberFn = remember } = {}) {
  const direct = String(sentence?.from?.text ?? "").trim();
  if (direct) return direct;
  const fromState = String(sentence?.fromstate?.text ?? "").trim();
  if (fromState) return fromState;
  const configured = rememberFn("android device id");
  const fromConfig = String(configured?.ob?.text ?? configured?.ob?.name ?? "").trim();
  if (fromConfig) return fromConfig;
  return "";
}

function resolveAgentName(sentence = {}, { rememberFn = remember } = {}) {
  const direct = String(sentence?.for?.name ?? "").trim();
  if (direct) return direct;
  const mind = rememberFn("mind name");
  const mindName = String(mind?.ob?.name ?? mind?.ob?.text ?? "").trim();
  if (mindName) return mindName;
  return "agent";
}

function resolveCommandId(sentence = {}) {
  const explicit = String(sentence?.su?.name ?? "").trim();
  if (explicit) return explicit;
  const seed = `${nowIso()}|${sentence?.be ?? "android"}|${JSON.stringify(sentence?.ob ?? {})}`;
  return `android-${shortHash(seed)}`;
}

function ensureIntent(intent, sentence) {
  if (!intent) {
    throwErrorSentence({
      name: "android command defective",
      message: "android command defective: missing intent",
      from: { name: "android" },
      raw: { sentence }
    });
  }
  return intent;
}

function ensureDeviceId(deviceId, sentence) {
  if (!deviceId) {
    throwErrorSentence({
      name: "android command defective",
      message: "android command defective: missing device id (from text or android device id)",
      from: { name: "android" },
      raw: { sentence }
    });
  }
  return deviceId;
}

function buildPayloadSentence(call = {}, intent = "") {
  const next = cloneValue(call);
  next.be = `android ${intent}`;
  next.mood = "do";
  return next;
}

function queuedSentence({ commandId, intent, deviceId }) {
  return {
    mood: "ya",
    su: { name: commandId },
    be: "android command",
    vyah: { name: "start" },
    as: { name: intent },
    from: { text: deviceId },
    ob: { text: "queued" },
    since: { date: nowIso() }
  };
}

function statusSentence({ mode = "status", state = null, handleId = "" } = {}) {
  const current = state || {};
  const status = String(current.status || "missing").trim() || "missing";
  return {
    mood: "ya",
    su: { name: String(handleId || current.handleId || "").trim() || String(handleId || "android-handle") },
    be: "android command",
    vyah: { name: mode === "await" ? "await" : "status" },
    as: { name: String(current.intent || "").trim() || "unknown" },
    from: { text: String(current.deviceId || "").trim() || "" },
    ob: { text: status },
    fromstate: { text: String(current.summary || "").trim() || "" },
    since: { date: String(current.queuedAt || "").trim() || "" },
    during: { date: String(current.finishedAt || current.updatedAt || "").trim() || "" }
  };
}

async function handleStatus(call, { worldRoot } = {}) {
  const handleId = String(call?.accordingto?.text ?? call?.su?.name ?? "").trim();
  if (!handleId) {
    throwErrorSentence({
      name: "android command defective",
      message: "android command defective: status requires accordingto text <handle id>",
      from: { name: "android" },
      raw: { call }
    });
  }
  const state = await readAndroidHandleState(worldRoot, handleId);
  if (!state) {
    throwErrorSentence({
      name: "android command defective",
      message: `android command defective: unknown handle ${JSON.stringify(handleId)}`,
      from: { name: "android" },
      raw: { call }
    });
  }
  return statusSentence({ mode: "status", state, handleId });
}

async function handleAwait(call, { worldRoot } = {}) {
  const handleId = String(call?.accordingto?.text ?? call?.su?.name ?? "").trim();
  if (!handleId) {
    throwErrorSentence({
      name: "android command defective",
      message: "android command defective: await requires accordingto text <handle id>",
      from: { name: "android" },
      raw: { call }
    });
  }
  const timeoutMs = Math.max(1000, Math.trunc(Number(call?.during?.num) || 120000));
  const pollMs = 250;
  const start = Date.now();

  while ((Date.now() - start) <= timeoutMs) {
    const state = await readAndroidHandleState(worldRoot, handleId);
    if (!state) {
      throwErrorSentence({
        name: "android command defective",
        message: `android command defective: unknown handle ${JSON.stringify(handleId)}`,
        from: { name: "android" },
        raw: { call }
      });
    }
    if (isTerminalHandleStatus(state.status)) {
      return statusSentence({ mode: "await", state, handleId });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const current = await readAndroidHandleState(worldRoot, handleId);
  return statusSentence({ mode: "await", state: current || { status: "timeout" }, handleId });
}

export async function android(call, { remember: rememberFn = remember } = {}) {
  const intent = ensureIntent(normalizeIntent(call?.be), call);
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
  if (intent === "status") return handleStatus(call, { worldRoot });
  if (intent === "await") return handleAwait(call, { worldRoot });
  const commandId = resolveCommandId(call);
  const deviceId = ensureDeviceId(resolveDeviceId(call, { rememberFn }), call);
  const agentName = resolveAgentName(call, { rememberFn });
  const queuedAt = nowIso();

  await enqueueInputEnvelope(worldRoot, {
    queuedAt,
    deviceId,
    identity: "adb://local",
    agentName,
    commandId,
    payloadId: commandId,
    payloadSentence: buildPayloadSentence(call, intent)
  });
  await writeAndroidHandleState(worldRoot, commandId, {
    handleId: commandId,
    intent,
    deviceId,
    agentName,
    status: "queued",
    queuedAt,
    summary: "queued"
  });

  return queuedSentence({ commandId, intent, deviceId });
}

export default android;

export const signatures = [
  { signatureWords: ["be", "android", "verify"], handler: android },
  { signatureWords: ["be", "android", "verify", "from", "text"], handler: android },
  { signatureWords: ["be", "android", "verify", "from", "text", "to", "name", "text"], handler: android },
  { signatureWords: ["be", "android", "observe"], handler: android },
  { signatureWords: ["be", "android", "observe", "from", "text"], handler: android },
  { signatureWords: ["be", "android", "observe", "from", "text", "to", "filename"], handler: android },
  { signatureWords: ["be", "android", "tap", "from", "text", "ob", "vec", "num"], handler: android },
  { signatureWords: ["be", "android", "glide", "from", "text", "ob", "vec", "num"], handler: android },
  { signatureWords: ["be", "android", "glide", "during", "num", "from", "text", "ob", "vec", "num"], handler: android },
  { signatureWords: ["be", "android", "scroll", "from", "text", "ob", "text"], handler: android },
  { signatureWords: ["be", "android", "scroll", "during", "num", "from", "text", "ob", "text"], handler: android },
  { signatureWords: ["be", "android", "press", "from", "text", "ob", "text"], handler: android },
  { signatureWords: ["be", "android", "type", "from", "text", "ob", "text"], handler: android },
  { signatureWords: ["be", "android", "begin", "from", "text", "ob", "text"], handler: android },
  { signatureWords: ["be", "android", "send", "from", "filename", "fromstate", "text", "to", "text"], handler: android },
  { signatureWords: ["be", "android", "accept", "from", "text", "fromstate", "text", "to", "filename"], handler: android },
  { signatureWords: ["be", "android", "status", "accordingto", "text"], handler: android },
  { signatureWords: ["be", "android", "await", "accordingto", "text"], handler: android },
  { signatureWords: ["be", "android", "await", "accordingto", "text", "during", "num"], handler: android }
];
