import fs from "node:fs/promises";
import path from "node:path";

function sanitizePart(raw, fallback) {
  const text = String(raw ?? "").trim().toLowerCase();
  const clean = text
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

function safeEventId() {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function decodeLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function eventFromRecord(record = {}, fallbackChannel = "cli") {
  const channelId = String(record.channelId ?? fallbackChannel).trim() || fallbackChannel;
  const sender = String(record.sender ?? "cli").trim() || "cli";
  const text = String(record.text ?? "").trim();
  if (!text) return null;
  const eventId = String(record.eventId ?? "").trim() || safeEventId();
  return {
    channelType: "cli",
    channelId,
    eventId,
    sender,
    text
  };
}

async function readRecords(filePath) {
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const rows = [];
  for (const line of text.split("\n")) {
    const value = decodeLine(line);
    if (value) rows.push(value);
  }
  return rows;
}

function parseCheckpointOffset(checkpoint) {
  const raw = Number.parseInt(String(checkpoint?.nextBatch ?? ""), 10);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
}

export function resolveCliChannelPaths({ worldRoot, agentName } = {}) {
  const root = path.join(
    String(worldRoot ?? ""),
    "holding",
    "channel",
    "cli",
    sanitizePart(agentName, "agent")
  );
  return {
    root,
    inbound: path.join(root, "inbound.jsonl")
  };
}

export async function enqueueCliInbound({
  worldRoot,
  agentName,
  channelId = "cli",
  sender = "cli",
  text = "",
  eventId = ""
} = {}) {
  const payloadText = String(text ?? "").trim();
  if (!payloadText) throw new Error("cli inbound text required");
  const paths = resolveCliChannelPaths({ worldRoot, agentName });
  await fs.mkdir(path.dirname(paths.inbound), { recursive: true });
  const record = {
    ts: new Date().toISOString(),
    channelId: String(channelId ?? "").trim() || "cli",
    sender: String(sender ?? "").trim() || "cli",
    eventId: String(eventId ?? "").trim() || safeEventId(),
    text: payloadText
  };
  await fs.appendFile(paths.inbound, `${JSON.stringify(record)}\n`, "utf8");
  return { eventId: record.eventId, filePath: paths.inbound, record };
}

export function createCliAdapter({ worldRoot, agentName } = {}) {
  if (!worldRoot) throw new Error("cli adapter requires worldRoot");
  if (!agentName) throw new Error("cli adapter requires agentName");
  const paths = resolveCliChannelPaths({ worldRoot, agentName });
  return {
    type: "cli",
    async receive({ config, checkpoint }) {
      const configuredRoom = Array.isArray(config?.rooms) ? String(config.rooms[0]?.id ?? "").trim() : "";
      const fallbackChannel = configuredRoom || String(config?.channelId ?? "cli").trim() || "cli";
      const records = await readRecords(paths.inbound);
      const offset = parseCheckpointOffset(checkpoint);
      const start = Math.min(Math.max(offset, 0), records.length);
      const selected = records.slice(start);
      const events = selected
        .map((record) => eventFromRecord(record, fallbackChannel))
        .filter(Boolean);
      return {
        events,
        checkpoint: { nextBatch: String(records.length) },
        diagnostics: {
          inboundPath: paths.inbound,
          cursor: start,
          seen: records.length
        }
      };
    },

    async send({ event, content }) {
      const text = String(content ?? "").trim();
      if (!text) throw new Error("cli send content required");
      const eventId = safeEventId();
      return {
        eventId,
        channelId: String(event?.channelId ?? "cli").trim() || "cli",
        text
      };
    },

    async markSeen() {
      return { ok: true };
    }
  };
}
