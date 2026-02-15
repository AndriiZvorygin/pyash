import { parse } from "../../program/understand/index.mjs";
import { splitSentences } from "../../program/library/sentenceSplitter.mjs";
import { blockMarkers, escapeRegex } from "./managed_blocks.mjs";

function quoteText(value) {
  const text = String(value ?? "");
  return `\"${text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
}

export function buildChannelPollCalendarBlock({
  channelType = "matrix",
  intervalMinutes = 1,
  intervalSeconds = null
}) {
  const useSeconds = Number.isFinite(Number(intervalSeconds)) && Number(intervalSeconds) > 0;
  const interval = useSeconds
    ? Math.max(1, Math.floor(Number(intervalSeconds) || 1))
    : Math.max(1, Math.floor(Number(intervalMinutes) || 1));
  const duringUnit = useSeconds ? "second" : "minute";
  const normalizedChannelType = String(channelType ?? "").trim().toLowerCase() || "matrix";
  const subject = `su name ${normalizedChannelType} poll`;
  return [
    `${subject} vyah habit during ${duringUnit} ${interval} be calendar ya`,
    `su name ${normalizedChannelType} poll lane ob text ${quoteText(`${normalizedChannelType}_poll`)} ya`
  ].join("\n");
}

export function buildChannelInputCalendarBlock({ agentName, channels = [], intervalSeconds = 1 }) {
  const interval = Math.max(1, Math.floor(Number(intervalSeconds) || 1));
  const orderedChannels = Array.from(new Set(
    (Array.isArray(channels) ? channels : [])
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  ));
  const channelValues = orderedChannels.length ? orderedChannels : ["matrix"];
  const vectorLiteral = channelValues.map((value) => quoteText(value)).join(" ");
  const normalizedAgent = String(agentName ?? "").trim();
  const subject = normalizedAgent
    ? `su name channel input for name ${normalizedAgent}`
    : "su name channel input";
  return [
    `${subject} with ve text ${vectorLiteral} vyah habit during second ${interval} be calendar ya`,
    "su name channel input lane ob text \"channel_input\" ya"
  ].join("\n");
}

export function buildChannelProduceCalendarBlock({ agentName, channels = [], intervalSeconds = 1 }) {
  const interval = Math.max(1, Math.floor(Number(intervalSeconds) || 1));
  const orderedChannels = Array.from(new Set(
    (Array.isArray(channels) ? channels : [])
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  ));
  const channelValues = orderedChannels.length ? orderedChannels : ["matrix"];
  const vectorLiteral = channelValues.map((value) => quoteText(value)).join(" ");
  const normalizedAgent = String(agentName ?? "").trim();
  const subject = normalizedAgent
    ? `su name channel produce for name ${normalizedAgent}`
    : "su name channel produce";
  return [
    `${subject} with ve text ${vectorLiteral} vyah habit during second ${interval} be calendar ya`,
    "su name channel produce lane ob text \"channel_produce\" ya"
  ].join("\n");
}

export function stripAgentChannelScheduleText({ existing, agentName, scheduleName, includeManagedBlockLines = true }) {
  const normalizedAgent = String(agentName ?? "").trim();
  const normalizedSchedule = String(scheduleName ?? "").trim().toLowerCase();
  if (!normalizedAgent || !normalizedSchedule) return String(existing ?? "");
  const managedMarkers = blockMarkers("agent channel schedule");
  let insideManagedBlock = false;
  const lines = String(existing ?? "").split("\n");
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === managedMarkers.start.trim()) {
      insideManagedBlock = true;
      kept.push(line);
      continue;
    }
    if (trimmed === managedMarkers.end.trim()) {
      insideManagedBlock = false;
      kept.push(line);
      continue;
    }
    if (!includeManagedBlockLines && insideManagedBlock) {
      kept.push(line);
      continue;
    }
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    if (normalizedSchedule === "poll") {
      if (new RegExp(`^su name (channel|[a-z0-9_-]+)\\s+poll for name ${escapeRegex(normalizedAgent)}\\b.*be calendar ya$`, "i").test(trimmed)) {
        continue;
      }
      if (insideManagedBlock && /^su name (channel|[a-z0-9_-]+)\s+poll lane ob text ".*" ya$/i.test(trimmed)) {
        continue;
      }
    }
    if (normalizedSchedule === "input") {
      if (new RegExp(`^su name channel input for name ${escapeRegex(normalizedAgent)}\\b.*be calendar ya$`, "i").test(trimmed)) {
        continue;
      }
      if (insideManagedBlock && /^su name channel input lane ob text ".*" ya$/i.test(trimmed)) {
        continue;
      }
    }
    if (normalizedSchedule === "produce") {
      if (new RegExp(`^su name channel produce for name ${escapeRegex(normalizedAgent)}\\b.*be calendar ya$`, "i").test(trimmed)) {
        continue;
      }
      if (insideManagedBlock && /^su name channel produce lane ob text ".*" ya$/i.test(trimmed)) {
        continue;
      }
    }
    kept.push(line);
  }
  let next = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  if (next && !next.endsWith("\n")) next = `${next}\n`;
  return next;
}

export function stripLegacySingleChannelScheduleText({
  existing,
  channelType = "matrix",
  scheduleNames = ["poll", "probe", "input", "produce"]
}) {
  const normalizedChannel = String(channelType ?? "").trim().toLowerCase();
  if (!normalizedChannel) return String(existing ?? "");
  const accepted = new Set(
    (Array.isArray(scheduleNames) ? scheduleNames : [])
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (!accepted.size) return String(existing ?? "");

  const lines = String(existing ?? "").split("\n");
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    let sentence;
    try {
      sentence = parse(trimmed);
    } catch {
      kept.push(line);
      continue;
    }
    if (!sentence || sentence.mood !== "ya") {
      kept.push(line);
      continue;
    }
    const subject = String(sentence?.su?.name ?? "").trim().toLowerCase();
    const parts = subject.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts[0] !== normalizedChannel) {
      kept.push(line);
      continue;
    }
    const action = parts.slice(1).join(" ");
    const baseAction = action.endsWith(" lane") ? action.slice(0, -5) : action;
    if (accepted.has(baseAction)) continue;
    kept.push(line);
  }
  let next = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  if (next && !next.endsWith("\n")) next = `${next}\n`;
  return next;
}

export function scrubLegacyMatrixChannelSeed(text) {
  const original = String(text ?? "");
  const lines = original.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^su name matrix homeserver ob text "https:\/\/matrix\.example\.org" ya$/i.test(trimmed)) return false;
    if (/^su name matrix room ob text "!roomid:example\.org" ya$/i.test(trimmed)) return false;
    if (/^su name matrix room lane ob text "matrix_main" ya$/i.test(trimmed)) return false;
    return true;
  });
  let next = filtered.join("\n").replace(/\n{3,}/g, "\n\n");
  if (next && !next.endsWith("\n")) next = `${next}\n`;
  if (next === original) return original;
  return next;
}

export function extractChannelPollVectorForAgent({ existing, agentName }) {
  const sentences = splitSentences(String(existing ?? ""));
  const collected = [];
  for (const line of sentences) {
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (!sentence || sentence.mood !== "ya" || sentence.be !== "calendar") continue;
    if (String(sentence?.su?.name ?? "").trim().toLowerCase() !== "channel poll") continue;
    if (String(sentence?.for?.name ?? "").trim() !== String(agentName ?? "").trim()) continue;
    const values = sentence?.with?.ve?.values;
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const normalized = String(value ?? "").trim().toLowerCase();
      if (normalized) collected.push(normalized);
    }
  }
  return Array.from(new Set(collected));
}

export function upsertChannelPollCalendarText({
  existing,
  agentName,
  channelType,
  intervalMinutes = 1,
  intervalSeconds = null
}) {
  const priorVector = extractChannelPollVectorForAgent({ existing, agentName });
  const normalizedChannelType = String(channelType ?? "").trim().toLowerCase();
  const nextVector = normalizedChannelType
    ? Array.from(new Set([...priorVector, normalizedChannelType]))
    : priorVector;
  const pollLines = buildChannelPollCalendarBlock({
    agentName,
    channels: nextVector,
    intervalMinutes,
    intervalSeconds
  }).split("\n");
  const lines = String(existing ?? "").split("\n");
  const pollPattern = /^su name (channel|[a-z0-9_-]+)\s+poll for name .* be calendar ya$/i;
  const lanePattern = /^su name (channel|[a-z0-9_-]+)\s+poll lane ob text ".*" ya$/i;
  const kept = lines.filter((line) => !pollPattern.test(line.trim()) && !lanePattern.test(line.trim()));
  const body = kept.join("\n").trim();
  const block = pollLines.join("\n");
  const nextText = body ? `${body}\n${block}\n` : `${block}\n`;
  return {
    changed: nextText !== existing,
    action: String(existing || "").trim() ? "append" : "create",
    nextText
  };
}
