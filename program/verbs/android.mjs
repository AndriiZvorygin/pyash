import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import {
  ASYNC_LANE_DURABLE,
  ASYNC_LANE_FAST,
  resolveAsyncLane
} from "../library/async_lane.mjs";
import { enqueueInputEnvelope } from "../agent/android_core/queue.mjs";
import {
  readAndroidHandleState,
  writeAndroidHandleState,
  isTerminalHandleStatus
} from "../agent/android/state.mjs";
import { appendAndroidOutcome } from "../agent/android/outcome.mjs";
import { createAdbAdapter } from "../agent/android/adapter_adb.mjs";
import {
  runAndroidOnce,
  runAndroidPollOnce,
  runAndroidInputOnce,
  runAndroidProduceOnce
} from "../agent/android/index.mjs";

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

function readVyahMode(sentence = {}) {
  const values = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const first = String(values[0] ?? "").trim().toLowerCase();
  return first;
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

function queuedSentence({ commandId, intent, deviceId, lane = ASYNC_LANE_DURABLE, stateText = "queued" }) {
  return {
    mood: "ya",
    su: { name: commandId },
    be: "android command",
    vyah: { ve: { type: "name", values: ["start", "success"] } },
    as: { name: intent },
    from: { text: deviceId },
    fromstate: { text: lane },
    ob: { text: stateText },
    since: { date: nowIso() }
  };
}

function phaseSentence({ phase = "all", result = {} } = {}) {
  const received = Number(result?.received ?? 0);
  const handled = Number(result?.handled ?? 0);
  const sent = Number(result?.sent ?? 0);
  const queue = Number(result?.queueDepth ?? 0);
  return {
    mood: "ya",
    su: { name: "android runtime" },
    be: "android command",
    vyah: { name: "status" },
    as: { name: phase },
    ob: { text: `received=${received} handled=${handled} sent=${sent} queue=${queue}` },
    to: { num: queue }
  };
}

function statusSentence({ mode = "status", state = null, handleId = "" } = {}) {
  const current = state || {};
  const status = String(current.status || "missing").trim() || "missing";
  const vyahValues = status === "success" || status === "fail" || status === "cancel"
    ? [mode, status]
    : [mode];
  return {
    mood: "ya",
    su: { name: String(handleId || current.handleId || "").trim() || String(handleId || "android-handle") },
    be: "android command",
    vyah: { ve: { type: "name", values: vyahValues } },
    as: { name: String(current.intent || "").trim() || "unknown" },
    from: { text: String(current.deviceId || "").trim() || "" },
    totext: { text: String(current.lane || "").trim() || "" },
    ob: { text: status },
    fromstate: { text: String(current.summary || "").trim() || "" },
    since: { date: String(current.queuedAt || "").trim() || "" },
    during: { date: String(current.finishedAt || current.updatedAt || "").trim() || "" }
  };
}

async function readAndroidWorkerPresence(worldRoot) {
  const primaryPath = path.join(worldRoot, "house", "android-host-worker", ".presence.pya");
  const fallbackPath = path.join(worldRoot, "presence", "android-host-worker.pya");
  const candidates = [primaryPath, fallbackPath];
  for (const presencePath of candidates) {
    try {
      const text = await fs.readFile(presencePath, "utf8");
      const match = String(text).match(/during\s+date\s+"([^"]+)"/i);
      const latestIso = String(match?.[1] ?? "").trim();
      if (!latestIso) continue;
      const latestMs = Date.parse(latestIso);
      if (!Number.isFinite(latestMs)) continue;
      const ageMs = Math.max(0, Date.now() - latestMs);
      return {
        found: true,
        stale: ageMs > 15000,
        latestIso,
        ageMs
      };
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      throw err;
    }
  }
  return { found: false, stale: true, latestIso: "", ageMs: null };
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
  const base = current || { status: "timeout" };
  const presence = await readAndroidWorkerPresence(worldRoot);
  const pending = !isTerminalHandleStatus(base.status);
  if (pending) {
    if (!presence.found || presence.stale) {
      base.summary = `await timeout: handle still ${base.status}; android worker presence missing/stale. start host worker: npm run android:worker`;
    } else {
      base.summary = `await timeout: handle still ${base.status}; android worker present (last heartbeat ${presence.latestIso})`;
    }
  } else if (!base.summary) {
    base.summary = "await timeout";
  }
  return statusSentence({ mode: "await", state: base, handleId });
}

async function handlePhaseRun(intent, { worldRoot } = {}) {
  if (intent === "poll" || intent === "probe") {
    const result = await runAndroidPollOnce({ worldRoot });
    return phaseSentence({ phase: intent, result });
  }
  if (intent === "input") {
    const result = await runAndroidInputOnce({ worldRoot, maxItems: 20 });
    return phaseSentence({ phase: intent, result });
  }
  if (intent === "produce") {
    const result = await runAndroidProduceOnce({ worldRoot, maxItems: 20 });
    return phaseSentence({ phase: intent, result });
  }
  if (intent === "all") {
    const result = await runAndroidOnce({ worldRoot, inputMaxItems: 20, produceMaxItems: 20 });
    return phaseSentence({ phase: intent, result });
  }
  return null;
}

export async function android(call, { remember: rememberFn = remember } = {}) {
  const vyahMode = readVyahMode(call);
  const intent = ensureIntent(normalizeIntent(call?.be), call);
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
  if (intent === "status" || vyahMode === "status") return handleStatus(call, { worldRoot });
  if (intent === "await" || vyahMode === "await") return handleAwait(call, { worldRoot });
  const phase = await handlePhaseRun(intent, { worldRoot });
  if (phase) return phase;
  if (vyahMode !== "start") {
    throwErrorSentence({
      name: "android command defective",
      message: `android command defective: ${intent} requires vyah start`,
      from: { name: "android" },
      raw: { call }
    });
  }
  const commandId = resolveCommandId(call);
  const deviceId = ensureDeviceId(resolveDeviceId(call, { rememberFn }), call);
  const agentName = resolveAgentName(call, { rememberFn });
  const queuedAt = nowIso();
  const lane = resolveAsyncLane(call, { defaultLane: ASYNC_LANE_DURABLE, verb: "android" }).lane;
  const payloadSentence = buildPayloadSentence(call, intent);

  if (lane === ASYNC_LANE_FAST) {
    const adapter = createAdbAdapter({ worldRoot });
    const startedAt = nowIso();
    await writeAndroidHandleState(worldRoot, commandId, {
      handleId: commandId,
      intent,
      deviceId,
      agentName,
      lane,
      status: "running",
      queuedAt: startedAt,
      startedAt,
      summary: "running"
    });
    try {
      await appendAndroidOutcome(worldRoot, {
        agentName,
        handleId: commandId,
        intent,
        state: "running",
        deviceId,
        message: "running"
      });
    } catch {
      // best-effort only
    }
    try {
      const result = await adapter.execute({
        worldRoot,
        envelope: {
          deviceId,
          identity: "adb://local",
          agentName,
          commandId,
          payloadId: commandId,
          lane,
          payloadSentence
        },
        intent,
        deviceId,
        agentName,
        payloadSentence
      });
      const success = result?.success !== false;
      const summary = String(result?.summary ?? (success ? "ok" : "fail")).trim() || (success ? "ok" : "fail");
      await writeAndroidHandleState(worldRoot, commandId, {
        status: success ? "success" : "fail",
        finishedAt: nowIso(),
        summary
      });
      try {
        await appendAndroidOutcome(worldRoot, {
          agentName,
          handleId: commandId,
          intent,
          state: success ? "success" : "fail",
          deviceId,
          message: summary
        });
      } catch {
        // best-effort only
      }
      return queuedSentence({
        commandId,
        intent,
        deviceId,
        lane,
        stateText: success ? "success" : "fail"
      });
    } catch (err) {
      const summary = String(err?.message ?? err).trim() || "fail";
      await writeAndroidHandleState(worldRoot, commandId, {
        status: "fail",
        finishedAt: nowIso(),
        summary
      });
      try {
        await appendAndroidOutcome(worldRoot, {
          agentName,
          handleId: commandId,
          intent,
          state: "fail",
          deviceId,
          message: summary
        });
      } catch {
        // best-effort only
      }
      return queuedSentence({
        commandId,
        intent,
        deviceId,
        lane,
        stateText: "fail"
      });
    }
  }

  await enqueueInputEnvelope(worldRoot, {
    queuedAt,
    deviceId,
    identity: "adb://local",
    agentName,
    commandId,
    payloadId: commandId,
    lane,
    payloadSentence
  });
  await writeAndroidHandleState(worldRoot, commandId, {
    handleId: commandId,
    intent,
    deviceId,
    agentName,
    lane,
    status: "queued",
    queuedAt,
    summary: "queued"
  });
  try {
    await appendAndroidOutcome(worldRoot, {
      agentName,
      handleId: commandId,
      intent,
      state: "queued",
      deviceId,
      message: "queued"
    });
  } catch {
    // outcome logging must be best-effort and must not break command submission
  }

  return queuedSentence({ commandId, intent, deviceId, lane, stateText: "queued" });
}

export default android;

export const signatures = [
  { signatureWords: ["be", "android", "verify", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "verify", "from", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "verify", "from", "text", "to", "name", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "observe", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "observe", "from", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "observe", "from", "text", "to", "filename", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "tap", "ob", "vec", "num", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "tap", "from", "text", "ob", "vec", "num", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "glide", "ob", "vec", "num", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "glide", "from", "text", "ob", "vec", "num", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "glide", "during", "num", "ob", "vec", "num", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "glide", "during", "num", "from", "text", "ob", "vec", "num", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "scroll", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "scroll", "from", "text", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "scroll", "during", "num", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "scroll", "during", "num", "from", "text", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "press", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "press", "from", "text", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "type", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "type", "from", "text", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "begin", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "begin", "from", "text", "ob", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "send", "from", "filename", "to", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "send", "from", "filename", "fromstate", "text", "to", "text", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "accept", "from", "text", "to", "filename", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "accept", "from", "text", "fromstate", "text", "to", "filename", "vyah", "start"], handler: android },
  { signatureWords: ["be", "android", "status", "accordingto", "text"], handler: android },
  { signatureWords: ["be", "android", "await", "accordingto", "text"], handler: android },
  { signatureWords: ["be", "android", "await", "accordingto", "text", "during", "num"], handler: android },
  { signatureWords: ["be", "android", "accordingto", "text", "vyah", "status"], handler: android },
  { signatureWords: ["be", "android", "accordingto", "text", "vyah", "await"], handler: android },
  { signatureWords: ["be", "android", "accordingto", "text", "during", "num", "vyah", "await"], handler: android },
  { signatureWords: ["be", "android", "poll"], handler: android },
  { signatureWords: ["be", "android", "probe"], handler: android },
  { signatureWords: ["be", "android", "input"], handler: android },
  { signatureWords: ["be", "android", "produce"], handler: android },
  { signatureWords: ["be", "android", "all"], handler: android }
];
