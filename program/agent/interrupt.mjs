import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import { sentenceToPyash } from "../beautiful.mjs";
import { worldRootFromAgentHouse } from "./newspaper_log.mjs";

const activeMindRuns = new Map();
const activeMindAbortControllers = new Map();
const mindInterruptContext = new AsyncLocalStorage();

export function runWithMindInterruptSignal({ signal } = {}, action) {
  if (typeof action !== "function") throw new TypeError("mind interrupt context requires an action");
  return mindInterruptContext.run({ signal: signal ?? null }, action);
}

export function currentMindInterruptSignal() {
  return mindInterruptContext.getStore()?.signal ?? null;
}

function sanitizeToken(value, fallback = "agent") {
  const text = String(value ?? "").trim().toLowerCase();
  const cleaned = text
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function activeKey(worldRoot, agentName) {
  return `${String(worldRoot)}::${String(agentName).trim().toLowerCase()}`;
}

function presencePath(worldRoot) {
  return path.join(String(worldRoot), "presence");
}

function activePath(worldRoot, agentName) {
  return path.join(presencePath(worldRoot), `${sanitizeToken(agentName)}-mind-active.pya`);
}

function interruptPath(worldRoot, agentName) {
  return path.join(presencePath(worldRoot), `${sanitizeToken(agentName)}-mind-interrupt.pya`);
}

async function writeActiveFile(worldRoot, agentName, count) {
  await fs.mkdir(presencePath(worldRoot), { recursive: true });
  const sentence = {
    mood: "ya",
    su: { name: String(agentName).trim() || "agent" },
    be: "mind active",
    ob: { num: count },
    during: { date: new Date().toISOString() }
  };
  await fs.writeFile(activePath(worldRoot, agentName), `${sentenceToPyash(sentence)}\n`, "utf8");
}

function parseInterruptTimestamp(text = "") {
  const match = String(text).match(/\bduring date ([0-9T:\-.Z]+)\b/i);
  if (!match) return null;
  const value = Date.parse(match[1]);
  return Number.isFinite(value) ? value : null;
}

export async function beginActiveMindRun({ worldRoot, agentName, controller = null } = {}) {
  if (!worldRoot) return async () => {};
  const key = activeKey(worldRoot, agentName);
  const next = (activeMindRuns.get(key) ?? 0) + 1;
  activeMindRuns.set(key, next);
  if (controller?.signal && typeof controller.abort === "function") {
    const controllers = activeMindAbortControllers.get(key) ?? new Set();
    controllers.add(controller);
    activeMindAbortControllers.set(key, controllers);
  }
  try {
    await writeActiveFile(worldRoot, agentName, next);
  } catch (error) {
    const controllers = activeMindAbortControllers.get(key);
    controllers?.delete(controller);
    if (!controllers?.size) activeMindAbortControllers.delete(key);
    const remaining = Math.max(0, (activeMindRuns.get(key) ?? 1) - 1);
    if (remaining === 0) {
      activeMindRuns.delete(key);
      await fs.rm(activePath(worldRoot, agentName), { force: true }).catch(() => {});
    } else {
      activeMindRuns.set(key, remaining);
      await writeActiveFile(worldRoot, agentName, remaining).catch(() => {});
    }
    throw error;
  }
  return async () => {
    const controllers = activeMindAbortControllers.get(key);
    controllers?.delete(controller);
    if (!controllers?.size) activeMindAbortControllers.delete(key);
    const current = activeMindRuns.get(key) ?? 0;
    const remaining = Math.max(0, current - 1);
    if (remaining === 0) {
      activeMindRuns.delete(key);
      await fs.rm(activePath(worldRoot, agentName), { force: true }).catch(() => {});
      return;
    }
    activeMindRuns.set(key, remaining);
    await writeActiveFile(worldRoot, agentName, remaining);
  };
}

export function hasActiveMindRun({ worldRoot, agentName } = {}) {
  if (!worldRoot) return false;
  const key = activeKey(worldRoot, agentName);
  return (activeMindRuns.get(key) ?? 0) > 0;
}

export async function requestMindInterrupt({
  worldRoot,
  agentName,
  source = "",
  reason = "stop"
} = {}) {
  const active = hasActiveMindRun({ worldRoot, agentName });
  if (!active) return { requested: false, active: false };
  await fs.mkdir(presencePath(worldRoot), { recursive: true });
  const sentence = {
    mood: "ya",
    su: { name: String(agentName).trim() || "agent" },
    be: "mind interrupt",
    from: { name: String(source).trim() || "channel" },
    ob: { text: String(reason).trim() || "stop" },
    during: { date: new Date().toISOString() }
  };
  const target = interruptPath(worldRoot, agentName);
  await fs.writeFile(target, `${sentenceToPyash(sentence)}\n`, "utf8");
  const controllers = activeMindAbortControllers.get(activeKey(worldRoot, agentName));
  let abortedRuns = 0;
  for (const controller of controllers ?? []) {
    if (controller.signal.aborted) continue;
    controller.abort(String(reason).trim() || "stop");
    abortedRuns += 1;
  }
  return { requested: true, active: true, path: target, abortedRuns };
}

export async function consumeMindInterrupt({
  agentHouse,
  agentName,
  maxAgeMs = 60 * 1000
} = {}) {
  if (!agentHouse || !agentName) return null;
  const worldRoot = worldRootFromAgentHouse(agentHouse);
  const target = interruptPath(worldRoot, agentName);
  let text = "";
  try {
    text = await fs.readFile(target, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  const createdAtMs = parseInterruptTimestamp(text);
  const nowMs = Date.now();
  if (createdAtMs && Number.isFinite(maxAgeMs) && maxAgeMs > 0 && (nowMs - createdAtMs) > maxAgeMs) {
    await fs.rm(target, { force: true }).catch(() => {});
    return null;
  }
  await fs.rm(target, { force: true }).catch(() => {});
  return {
    agentName: String(agentName).trim(),
    worldRoot,
    at: createdAtMs ? new Date(createdAtMs).toISOString() : new Date().toISOString(),
    text: String(text).trim()
  };
}

