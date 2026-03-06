import crypto from "node:crypto";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { enqueueInputEnvelope } from "../agent/android_core/queue.mjs";

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

export async function android(call, { remember: rememberFn = remember } = {}) {
  const intent = ensureIntent(normalizeIntent(call?.be), call);
  const worldRoot = resolveWorldRoot({ rememberFn });
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
  { signatureWords: ["be", "android", "type", "from", "text", "ob", "text"], handler: android },
  { signatureWords: ["be", "android", "begin", "from", "text", "ob", "text"], handler: android },
  { signatureWords: ["be", "android", "send", "from", "filename", "fromstate", "text", "to", "text"], handler: android },
  { signatureWords: ["be", "android", "accept", "from", "text", "fromstate", "text", "to", "filename"], handler: android }
];
