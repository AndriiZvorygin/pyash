import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../../beautiful.mjs";
import { worldNewspaperLogPath } from "../../agent/newspaper_log.mjs";

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

function normalizeOutcome(raw = "") {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "success" || value === "fail" || value === "queued" || value === "running") return value;
  return "status";
}

export function gpuOutcomeLogPath(worldRoot, { agentName = "" } = {}) {
  const safeAgent = sanitizeName(agentName || "agent", "agent");
  return worldNewspaperLogPath({
    worldRoot,
    name: `gpu-${safeAgent}`
  });
}

export async function appendGpuOutcome(worldRoot, {
  agentName = "",
  handleId = "",
  intent = "",
  outcome = "status",
  gpuId = "",
  message = "",
  timestamp = ""
} = {}) {
  if (!worldRoot) return;
  const normalizedOutcome = normalizeOutcome(outcome);
  const safeAgent = sanitizeName(agentName || "agent", "agent");
  const target = gpuOutcomeLogPath(worldRoot, { agentName: safeAgent });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const sentence = {
    mood: "ya",
    su: { name: String(handleId || "gpu handle").trim() || "gpu handle" },
    as: { name: String(intent || "unknown").trim() || "unknown" },
    vyah: { ve: { type: "name", values: [normalizedOutcome] } },
    be: "gpu outcome",
    during: { date: timestamp || nowIso() },
    for: { text: safeAgent },
    ob: { text: shortText(message || normalizedOutcome) }
  };
  if (gpuId) sentence.from = { text: String(gpuId).trim() };
  await fs.appendFile(target, `${sentenceToPyash(sentence)}\n`, "utf8");
}
