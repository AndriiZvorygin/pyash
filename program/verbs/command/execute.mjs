import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { remember } from "../../remember/index.mjs";
import { resolveConfigBool, resolveConfigMapBool } from "../../configure/env.mjs";
import { canRunDirect, splitCommand, resolveDirectProgram, resolveShellCommand } from "./classify.mjs";

export function resolveStreamOutputPath(sentence) {
  const base = sentence?.su?.name ?? `command-${Date.now()}`;
  return path.join("artifacts", "command", `${base}.stream.txt`);
}

export function parseCommandTimeoutOverride(cmd) {
  const match = String(cmd ?? "").match(/(?:^|\s)PYA_COMMAND_TIMEOUT_MS=(\d+)(?:\s|$)/u);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.trunc(value));
}

export function isInlineTimeoutOverrideEnabled({ rememberFn = remember } = {}) {
  const envFlag = String(process.env.PYA_COMMAND_INLINE_TIMEOUTS ?? "").trim();
  if (envFlag === "1" || /^true$/iu.test(envFlag)) return true;
  return resolveConfigMapBool("command configure", "inline timeout override enabled", { rememberFn }) === true
    || resolveConfigBool("command inline timeout override enabled", { rememberFn }) === true;
}

export function startFileTail({ filename, onLine }) {
  let offset = 0;
  let pending = "";
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fsSync.statSync(filename);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fsSync.openSync(filename, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fsSync.readSync(fd, buffer, 0, buffer.length, offset);
    fsSync.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length) onLine(line);
    }
  }, 200);
  return () => clearInterval(interval);
}

export async function runCommandText(cmd, { input, timeoutMs, cwd, env, maxOutputBytes, onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    const spawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env
    };
    if (canRunDirect(cmd)) {
      const parts = splitCommand(cmd);
      proc = spawn(resolveDirectProgram(parts[0]), parts.slice(1), spawnOptions);
    } else {
      const shell = resolveShellCommand();
      if (!shell) {
        reject(new Error("command shell defective: no shell executable found"));
        return;
      }
      proc = spawn(shell, ["-lc", String(cmd)], spawnOptions);
    }
    let stdout = "";
    let stderr = "";
    let exceededOutputLimit = false;
    let timedOut = false;
    let timeoutHandle = null;
    const checkOutputLimit = () => {
      if (!(typeof maxOutputBytes === "number" && maxOutputBytes > 0)) return;
      if ((Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8")) <= maxOutputBytes) return;
      exceededOutputLimit = true;
      proc.kill("SIGKILL");
    };
    proc.stdout.on("data", data => {
      const text = data.toString("utf8");
      stdout += text;
      if (typeof onStdout === "function" && text) onStdout(text);
      checkOutputLimit();
    });
    proc.stderr.on("data", data => {
      const text = data.toString("utf8");
      stderr += text;
      if (typeof onStderr === "function" && text) onStderr(text);
      checkOutputLimit();
    });
    proc.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });
    proc.on("close", status => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (exceededOutputLimit) {
        stderr += `output exceeded ${maxOutputBytes} bytes`;
      }
      resolve({ status, signal: proc.signalCode ?? null, stdout, stderr, timedOut, exceededOutputLimit });
    });
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
        stderr += `timeout after ${timeoutMs}ms`;
      }, timeoutMs);
    }
    if (input !== null && input !== undefined) {
      proc.stdin.end(Buffer.from(String(input), "utf8"));
    } else {
      proc.stdin.end();
    }
  });
}

