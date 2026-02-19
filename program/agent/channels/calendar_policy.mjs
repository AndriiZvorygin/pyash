import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";

function normalizeAgentKey(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

function ensureChannel(out, channelType) {
  if (!out[channelType]) {
    out[channelType] = {
      longPollMs: null,
      byAgent: {}
    };
  }
  return out[channelType];
}

function readLongPollMs(sentence) {
  const raw = sentence?.ob?.num ?? sentence?.ob?.text ?? sentence?.ob?.name ?? null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

export function parseChannelCalendarPolicyText(text, { defaultAgentName = null } = {}) {
  const out = {};
  const lines = splitSentences(String(text ?? ""));
  for (const line of lines) {
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (!sentence || sentence.mood !== "ya" || sentence.be !== "calendar") continue;
    const subject = String(sentence?.su?.name ?? "").trim().toLowerCase();
    if (!subject) continue;
    const parts = subject.split(/\s+/).filter(Boolean);
    if (parts.length < 4) continue;
    if (parts.slice(1).join(" ") !== "long poll ms") continue;

    const channelType = parts[0];
    const longPollMs = readLongPollMs(sentence);
    if (!longPollMs) continue;

    const channel = ensureChannel(out, channelType);
    const rawAgentName = sentence?.for?.name ?? defaultAgentName ?? "";
    const agentKey = normalizeAgentKey(rawAgentName);
    if (agentKey) channel.byAgent[agentKey] = longPollMs;
    else channel.longPollMs = longPollMs;
  }
  return out;
}

function mergeChannelCalendarEntry(base = {}, override = {}) {
  return {
    longPollMs: override.longPollMs ?? base.longPollMs ?? null,
    byAgent: {
      ...(base.byAgent ?? {}),
      ...(override.byAgent ?? {})
    }
  };
}

export function mergeChannelCalendarPolicies(basePolicy = {}, overridePolicy = {}) {
  const channelTypes = new Set([
    ...Object.keys(basePolicy ?? {}),
    ...Object.keys(overridePolicy ?? {})
  ]);
  const out = {};
  for (const channelType of channelTypes) {
    out[channelType] = mergeChannelCalendarEntry(
      basePolicy[channelType],
      overridePolicy[channelType]
    );
  }
  return out;
}

export function resolveChannelCalendarSetting(policy = {}, {
  channelType = "matrix",
  agentName = ""
} = {}) {
  const channel = policy?.[String(channelType ?? "").trim().toLowerCase()] ?? null;
  if (!channel) {
    return {
      longPollMs: null,
      hasLongPollMs: false
    };
  }
  const agentKey = normalizeAgentKey(agentName);
  const byAgentValue = agentKey ? channel?.byAgent?.[agentKey] : null;
  const longPollMs = byAgentValue ?? channel.longPollMs ?? null;
  return {
    longPollMs,
    hasLongPollMs: longPollMs != null
  };
}

export async function loadChannelCalendarPolicyFromPath(
  policyPath,
  { defaultAgentName = null } = {}
) {
  let text = "";
  try {
    text = await fs.readFile(policyPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
  return parseChannelCalendarPolicyText(text, { defaultAgentName });
}

export async function loadChannelCalendarPolicyWithGlobal({
  worldRoot,
  agentHouse,
  agentName = ""
} = {}) {
  const globalPath = worldRoot ? path.join(worldRoot, "conduct", "calendar.pya") : null;
  const agentPath = agentHouse ? path.join(agentHouse, "conduct", "calendar.pya") : null;
  const [globalPolicy, agentPolicy] = await Promise.all([
    globalPath
      ? loadChannelCalendarPolicyFromPath(globalPath)
      : Promise.resolve({}),
    agentPath
      ? loadChannelCalendarPolicyFromPath(agentPath, { defaultAgentName: agentName })
      : Promise.resolve({})
  ]);
  return mergeChannelCalendarPolicies(globalPolicy, agentPolicy);
}
