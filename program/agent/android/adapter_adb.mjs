import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { ensureAndroidQueueDirs } from "../android_core/queue.mjs";

function toArgs(deviceId, args = []) {
  const serial = String(deviceId ?? "").trim();
  if (!serial) throw new Error("android command defective: missing device id");
  return ["-s", serial, ...args.map((value) => String(value))];
}

function runAdbRaw({ deviceId, args = [], timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("adb", toArgs(deviceId, args), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`android adb timeout: ${args.join(" ")}`));
    }, Math.max(1000, Math.trunc(Number(timeoutMs) || 20000)));
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: 0 });
        return;
      }
      reject(new Error(`android adb defective (${code}): ${args.join(" ")} ${stderr.trim()}`.trim()));
    });
  });
}

function shortText(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function expectVector(value, size, { intent, fieldName = "ob" } = {}) {
  const values = Array.isArray(value?.ve?.values) ? value.ve.values : [];
  if (values.length < size) {
    throw new Error(`android command rejected: ${intent} expects ${fieldName} ve num length >= ${size}`);
  }
  const out = [];
  for (let index = 0; index < size; index += 1) {
    const num = asNumber(values[index]);
    if (num == null) {
      throw new Error(`android command rejected: ${intent} requires numeric ${fieldName} index ${index}`);
    }
    out.push(num);
  }
  return out;
}

function expectText(value, { intent, fieldName = "ob" } = {}) {
  const text = String(value?.text ?? "").trim();
  if (!text) throw new Error(`android command rejected: ${intent} requires ${fieldName} text`);
  return text;
}

function encodeInputText(text = "") {
  return String(text)
    .replace(/%/g, "%25")
    .replace(/\s+/g, "%s")
    .replace(/["'`\\]/g, "");
}

function parsePhysicalSize(text = "") {
  const match = String(text).match(/(\d+)x(\d+)/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width: Math.trunc(width), height: Math.trunc(height) };
}

function scrollCoordinates({ direction, width, height } = {}) {
  const dir = String(direction ?? "").trim().toLowerCase();
  const w = Math.max(1, Math.trunc(Number(width) || 1));
  const h = Math.max(1, Math.trunc(Number(height) || 1));
  const cx = Math.max(1, Math.floor(w * 0.5));
  const cy = Math.max(1, Math.floor(h * 0.5));

  if (dir === "down") return [cx, Math.floor(h * 0.80), cx, Math.floor(h * 0.30)];
  if (dir === "up") return [cx, Math.floor(h * 0.30), cx, Math.floor(h * 0.80)];
  if (dir === "left") return [Math.floor(w * 0.80), cy, Math.floor(w * 0.20), cy];
  if (dir === "right") return [Math.floor(w * 0.20), cy, Math.floor(w * 0.80), cy];
  throw new Error("android command rejected: scroll direction must be down|up|left|right");
}

function optionalDurationMs(payloadSentence = {}) {
  const num = asNumber(payloadSentence?.during?.num);
  if (num == null || num <= 0) return null;
  return num;
}

async function verifyIntent({ deviceId, runAdb } = {}) {
  const [model, version, size, focus] = await Promise.all([
    runAdb({ deviceId, args: ["shell", "getprop", "ro.product.model"] }),
    runAdb({ deviceId, args: ["shell", "getprop", "ro.build.version.release"] }),
    runAdb({ deviceId, args: ["shell", "wm", "size"] }),
    runAdb({ deviceId, args: ["shell", "dumpsys", "window"] })
  ]);
  const focusLine = String(focus.stdout ?? "")
    .split("\n")
    .find((line) => line.includes("mCurrentFocus")) || "";
  const summary = [
    `model=${shortText(model.stdout, 64)}`,
    `android=${shortText(version.stdout, 32)}`,
    `size=${shortText(size.stdout, 64)}`,
    focusLine ? `focus=${shortText(focusLine, 96)}` : "focus=unknown"
  ].join(" ");
  return {
    success: true,
    summary,
    data: {
      model: String(model.stdout ?? "").trim(),
      version: String(version.stdout ?? "").trim(),
      size: String(size.stdout ?? "").trim(),
      focus: focusLine.trim()
    }
  };
}

async function observeIntent({ worldRoot, deviceId, commandId = "", payloadId = "", runAdb } = {}) {
  const queuePaths = await ensureAndroidQueueDirs(worldRoot);
  await fs.mkdir(queuePaths.artifactsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const base = String(commandId || payloadId || `observe-${stamp}`)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || `observe-${stamp}`;
  const remote = `/sdcard/Download/pyash-${base}.png`;
  const local = path.join(queuePaths.artifactsDir, `${base}.png`);
  await runAdb({ deviceId, args: ["shell", "screencap", "-p", remote] });
  await runAdb({ deviceId, args: ["pull", remote, local] });
  await runAdb({ deviceId, args: ["shell", "rm", "-f", remote] }).catch(() => {});
  const stat = await fs.stat(local);
  return {
    success: true,
    summary: `observe ok file=${path.basename(local)} bytes=${stat.size}`,
    data: {
      file: local,
      bytes: stat.size
    }
  };
}

async function tapIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const [x, y] = expectVector(payloadSentence?.ob, 2, { intent: "tap" });
  await runAdb({ deviceId, args: ["shell", "input", "tap", x, y] });
  return { success: true, summary: `tap ok x=${x} y=${y}` };
}

async function glideIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const [x1, y1, x2, y2] = expectVector(payloadSentence?.ob, 4, { intent: "glide" });
  const durationMs = optionalDurationMs(payloadSentence);
  const args = ["shell", "input", "swipe", x1, y1, x2, y2];
  if (durationMs != null) args.push(durationMs);
  await runAdb({ deviceId, args });
  return { success: true, summary: `glide ok ${x1},${y1}->${x2},${y2}${durationMs != null ? ` ${durationMs}ms` : ""}` };
}

async function scrollIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const direction = expectText(payloadSentence?.ob, { intent: "scroll" }).toLowerCase();
  const size = await runAdb({ deviceId, args: ["shell", "wm", "size"] });
  const parsed = parsePhysicalSize(size.stdout);
  if (!parsed) throw new Error("android command defective: unable to parse wm size");
  const [x1, y1, x2, y2] = scrollCoordinates({ direction, width: parsed.width, height: parsed.height });
  const durationMs = optionalDurationMs(payloadSentence) ?? 350;
  await runAdb({ deviceId, args: ["shell", "input", "swipe", x1, y1, x2, y2, durationMs] });
  return { success: true, summary: `scroll ${direction} ok` };
}

async function typeIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const text = expectText(payloadSentence?.ob, { intent: "type" });
  const encoded = encodeInputText(text);
  await runAdb({ deviceId, args: ["shell", "input", "text", encoded] });
  return { success: true, summary: `type ok chars=${text.length}` };
}

async function beginIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const target = expectText(payloadSentence?.ob, { intent: "begin" });
  if (/^https?:\/\//i.test(target)) {
    await runAdb({
      deviceId,
      args: ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", target]
    });
    return { success: true, summary: `begin url ok ${shortText(target, 120)}` };
  }
  await runAdb({
    deviceId,
    args: ["shell", "monkey", "-p", target, "-c", "android.intent.category.LAUNCHER", "1"]
  });
  return { success: true, summary: `begin app ok ${target}` };
}

async function pressIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const keycode = expectText(payloadSentence?.ob, { intent: "press" }).toUpperCase();
  if (!/^KEYCODE_[A-Z0-9_]+$/.test(keycode)) {
    throw new Error("android command rejected: press keycode must look like KEYCODE_HOME");
  }
  await runAdb({ deviceId, args: ["shell", "input", "keyevent", keycode] });
  return { success: true, summary: `press ok ${keycode}` };
}

async function sendIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const local = String(payloadSentence?.from?.filename ?? "").trim();
  const remote = String(payloadSentence?.to?.text ?? "").trim();
  if (!local || !remote) {
    throw new Error("android command rejected: send requires from filename and to text");
  }
  await runAdb({ deviceId, args: ["push", local, remote] });
  return { success: true, summary: `send ok ${path.basename(local)} -> ${remote}` };
}

async function acceptIntent({ deviceId, payloadSentence, runAdb } = {}) {
  const remote = String(payloadSentence?.from?.text ?? "").trim();
  const local = String(payloadSentence?.to?.filename ?? "").trim();
  if (!remote || !local) {
    throw new Error("android command rejected: accept requires from text and to filename");
  }
  await runAdb({ deviceId, args: ["pull", remote, local] });
  return { success: true, summary: `accept ok ${remote} -> ${path.basename(local)}` };
}

export function createAdbAdapter({ worldRoot, runAdb = runAdbRaw } = {}) {
  return {
    async execute({ envelope, intent, deviceId, payloadSentence } = {}) {
      const selectedDeviceId = String(deviceId ?? envelope?.deviceId ?? "").trim();
      const selectedIntent = String(intent ?? "").trim().toLowerCase();
      const command = payloadSentence || envelope?.payloadSentence || {};
      if (!selectedDeviceId) {
        return { success: false, summary: "android command rejected: missing device id" };
      }
      try {
        if (selectedIntent === "verify") {
          return verifyIntent({ deviceId: selectedDeviceId, runAdb });
        }
        if (selectedIntent === "observe") {
          return observeIntent({
            worldRoot,
            deviceId: selectedDeviceId,
            commandId: envelope?.commandId,
            payloadId: envelope?.payloadId,
            runAdb
          });
        }
        if (selectedIntent === "tap") {
          return tapIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        if (selectedIntent === "glide") {
          return glideIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        if (selectedIntent === "scroll") {
          return scrollIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        if (selectedIntent === "type") {
          return typeIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        if (selectedIntent === "begin") {
          return beginIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        if (selectedIntent === "press") {
          return pressIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        if (selectedIntent === "send") {
          return sendIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        if (selectedIntent === "accept") {
          return acceptIntent({ deviceId: selectedDeviceId, payloadSentence: command, runAdb });
        }
        return {
          success: false,
          summary: `android command rejected: unsupported intent ${selectedIntent || "unknown"}`
        };
      } catch (err) {
        return {
          success: false,
          summary: shortText(String(err?.message ?? err), 280)
        };
      }
    }
  };
}
