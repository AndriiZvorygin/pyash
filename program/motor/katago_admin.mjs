import { spawnSync } from "node:child_process";
import { resolveConfigText } from "../configure/env.mjs";

function parseJsonText(text, fallback = null) {
  const value = String(text ?? "").trim();
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function resolveProfile(profileName, { rememberFn } = {}) {
  const explicit = String(profileName ?? "").trim();
  if (explicit) return explicit;
  return String(resolveConfigText("katago profile", { rememberFn }) ?? "default").trim() || "default";
}

export async function katagoLifecycle(action, profileName, { rememberFn } = {}) {
  const payload = {
    action: String(action ?? "status").trim().toLowerCase() || "status",
    katagoProfile: resolveProfile(profileName, { rememberFn })
  };
  const timeout = Math.max(1000, Math.trunc(Number(process.env.PYA_COMMAND_TIMEOUT_MS) || 900000));
  const proc = spawnSync(process.execPath, ["command/katago_runner.mjs"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024 * 8,
    env: process.env
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const errText = String(proc.stderr || proc.stdout || "").trim();
    throw new Error(errText || `katago ${payload.action} failed`);
  }
  const parsed = parseJsonText(proc.stdout, {});
  return parsed && typeof parsed === "object" ? parsed : { response: String(proc.stdout ?? "").trim() };
}
