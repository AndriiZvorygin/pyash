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

async function verifyIntent({ deviceId } = {}) {
  const [model, version, size, focus] = await Promise.all([
    runAdbRaw({ deviceId, args: ["shell", "getprop", "ro.product.model"] }),
    runAdbRaw({ deviceId, args: ["shell", "getprop", "ro.build.version.release"] }),
    runAdbRaw({ deviceId, args: ["shell", "wm", "size"] }),
    runAdbRaw({ deviceId, args: ["shell", "dumpsys", "window"] })
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

async function observeIntent({ worldRoot, deviceId, commandId = "", payloadId = "" } = {}) {
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
  await runAdbRaw({ deviceId, args: ["shell", "screencap", "-p", remote] });
  await runAdbRaw({ deviceId, args: ["pull", remote, local] });
  await runAdbRaw({ deviceId, args: ["shell", "rm", "-f", remote] }).catch(() => {});
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

export function createAdbAdapter({ worldRoot } = {}) {
  return {
    async execute({ envelope, intent, deviceId } = {}) {
      const selectedDeviceId = String(deviceId ?? envelope?.deviceId ?? "").trim();
      const selectedIntent = String(intent ?? "").trim().toLowerCase();
      if (!selectedDeviceId) {
        return { success: false, summary: "android command rejected: missing device id" };
      }
      if (selectedIntent === "verify") {
        return verifyIntent({ deviceId: selectedDeviceId });
      }
      if (selectedIntent === "observe") {
        return observeIntent({
          worldRoot,
          deviceId: selectedDeviceId,
          commandId: envelope?.commandId,
          payloadId: envelope?.payloadId
        });
      }
      return {
        success: false,
        summary: `android command rejected: unsupported intent ${selectedIntent || "unknown"}`
      };
    }
  };
}
