import fs from "node:fs/promises";
import path from "node:path";

import { sentenceToPyash } from "../../beautiful.mjs";
import { worldRootFromAgentHouse, worldNewspaperLogPath } from "../newspaper_log.mjs";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeName(raw, fallback = "value") {
  const text = String(raw ?? "").trim().toLowerCase();
  const cleaned = text
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function channelTelemetryPath(agentHouse, { channelType, agentName } = {}) {
  const worldRoot = worldRootFromAgentHouse(agentHouse);
  const logName = `channel-${channelType}-${agentName}`;
  return worldNewspaperLogPath({ worldRoot, name: logName });
}

function normalizeOutcome(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "success" ? "success" : "fail";
}

function shortText(raw, limit = 260) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

export async function appendChannelOutcome(agentHouse, {
  channelType = "matrix",
  agentName = "",
  area = "runtime",
  stage = "status",
  outcome = "success",
  message = "",
  timestamp = ""
} = {}) {
  if (!agentHouse) return;
  const target = channelTelemetryPath(agentHouse, { channelType, agentName });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const safeArea = sanitizeName(area, "runtime");
  const safeStage = sanitizeName(stage, "status");
  const sentence = {
    mood: "ya",
    su: { name: `${String(channelType).trim() || "channel"} ${safeArea}` },
    as: { name: safeStage },
    vyah: { ve: { type: "name", values: [normalizeOutcome(outcome)] } },
    be: "channel outcome",
    during: { date: timestamp || nowIso() },
    ob: { text: shortText(message || (normalizeOutcome(outcome) === "success" ? "ok" : "defective")) }
  };
  await fs.appendFile(target, `${sentenceToPyash(sentence)}\n`, "utf8");
}
