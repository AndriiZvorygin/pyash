import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../../beautiful.mjs";
import { worldNewspaperLogPath } from "../newspaper_log.mjs";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeName(raw, fallback = "value") {
  const text = String(raw ?? "").trim().toLowerCase();
  const cleaned = text
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function shortText(raw, limit = 260) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function normalizeState(raw = "") {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "success" || value === "fail") return value;
  if (value === "queued" || value === "running" || value === "cancel") return value;
  return "status";
}

function isTerminalState(state = "") {
  return state === "success" || state === "fail" || state === "cancel";
}

export function androidOutcomeLogPath(worldRoot, { agentName = "" } = {}) {
  const safeAgent = sanitizeName(agentName || "agent", "agent");
  return worldNewspaperLogPath({
    worldRoot,
    name: `android-${safeAgent}`
  });
}

export async function appendAndroidOutcome(worldRoot, {
  agentName = "",
  handleId = "",
  intent = "",
  state = "",
  deviceId = "",
  message = "",
  timestamp = ""
} = {}) {
  if (!worldRoot) return;
  const normalizedState = normalizeState(state);
  const target = androidOutcomeLogPath(worldRoot, { agentName });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const values = isTerminalState(normalizedState)
    ? [normalizedState]
    : [normalizedState, "success"];
  const sentence = {
    mood: "ya",
    su: { name: String(handleId || "android handle").trim() || "android handle" },
    as: { name: String(intent || "unknown").trim() || "unknown" },
    vyah: { ve: { type: "name", values } },
    be: "android outcome",
    during: { date: timestamp || nowIso() },
    ob: { text: shortText(message || normalizedState) }
  };
  if (deviceId) sentence.from = { text: String(deviceId).trim() };
  await fs.appendFile(target, `${sentenceToPyash(sentence)}\n`, "utf8");
}
