import fs from "node:fs/promises";
import path from "node:path";

import {
  ensureAgentDirs,
  buildSessionNameForDate,
  ensureSessionFile,
  appendSessionEntry
} from "../../program/agent/session.mjs";
import { sentenceToPyash } from "../../program/beautiful.mjs";
import { worldNewspaperLogPath } from "../../program/agent/newspaper_log.mjs";

const PROJECTION_BLOCK_NAME = "codex projection";
const DEFAULT_SYSTEM_PROMPT = "codex tui projected session";

function quoteText(value = "") {
  return `\"${String(value ?? "").replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}\"`;
}

function unquoteText(value = "") {
  const text = String(value ?? "").trim();
  if (!(text.startsWith("\"") && text.endsWith("\""))) return text;
  const body = text.slice(1, -1);
  return body.replace(/\\\\/g, "\\").replace(/\\\"/g, "\"");
}

function parseProjectionMap(blockText = "") {
  const out = {};
  const linePattern = /su name (.+?)\s+ob text\s+("[^"\\]*(?:\\.[^"\\]*)*")\s+ya/g;
  for (const match of blockText.matchAll(linePattern)) {
    out[String(match[1] ?? "").trim()] = unquoteText(match[2] ?? "");
  }
  return out;
}

function renderProjectionMap(values = {}) {
  const lines = [
    `su name ${PROJECTION_BLOCK_NAME} be map def`
  ];
  const entries = Object.entries(values)
    .filter(([, value]) => String(value ?? "").trim());
  for (const [key, value] of entries) {
    lines.push(`  su name ${key} ob text ${quoteText(value)} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

async function readProjectionState(projectionPath) {
  let text = "";
  try {
    text = await fs.readFile(projectionPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
  const blockMatch = text.match(/su name codex projection be map def([\s\S]*?)\n\s*prah\b/i);
  if (!blockMatch) return {};
  return parseProjectionMap(blockMatch[1] ?? "");
}

async function writeProjectionState(projectionPath, state = {}) {
  await fs.mkdir(path.dirname(projectionPath), { recursive: true });
  await fs.writeFile(projectionPath, renderProjectionMap(state), "utf8");
}

async function* walkJsonlFiles(rootDir) {
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield fullPath;
    }
  }
}

async function readSessionMeta(sessionFile) {
  let text = "";
  try {
    text = await fs.readFile(sessionFile, "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(0, 16)) {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type !== "session_meta") continue;
    return {
      sessionId: String(parsed?.payload?.id ?? "").trim(),
      cwd: String(parsed?.payload?.cwd ?? "").trim(),
      timestamp: String(parsed?.timestamp ?? parsed?.payload?.timestamp ?? "").trim()
    };
  }
  return null;
}

async function findCodexSessionFile({ codexHome, agentHouse, startedAtMs }) {
  const sessionsRoot = path.join(codexHome, "sessions");
  const candidates = [];
  for await (const file of walkJsonlFiles(sessionsRoot)) {
    let stat = null;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (!stat?.isFile?.()) continue;
    candidates.push({ file, mtimeMs: Number(stat.mtimeMs || 0) });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const freshFirst = [
    ...candidates.filter((item) => item.mtimeMs >= (startedAtMs - 90_000)),
    ...candidates.filter((item) => item.mtimeMs < (startedAtMs - 90_000))
  ];

  for (const item of freshFirst) {
    const meta = await readSessionMeta(item.file);
    if (!meta?.sessionId) continue;
    if (meta.cwd && path.resolve(meta.cwd) !== path.resolve(agentHouse)) continue;
    return {
      sessionFile: item.file,
      sessionId: meta.sessionId
    };
  }
  return null;
}

function extractMessageText(payload = {}) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const chunks = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const type = String(item?.type ?? "").trim();
    if (type !== "input_text" && type !== "output_text" && type !== "text") continue;
    const text = String(item?.text ?? "").trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n").trim();
}

function isBootstrapContextMessage(text = "") {
  const sample = String(text ?? "").trim();
  if (!sample) return true;
  const lowered = sample.toLowerCase();
  if (lowered.startsWith("# agents.md instructions")) return true;
  if (lowered.startsWith("<environment_context>")) return true;
  if (lowered.startsWith("<instructions>")) return true;
  return false;
}

async function readProjectedMessages(sessionFile, { startedAtMs, lastEventAtMs, sessionId }) {
  let text = "";
  try {
    text = await fs.readFile(sessionFile, "utf8");
  } catch {
    return [];
  }
  const out = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type !== "response_item") continue;
    const payload = parsed?.payload ?? {};
    if (payload?.type !== "message") continue;
    const role = String(payload?.role ?? "").trim().toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const messageText = extractMessageText(payload);
    if (!messageText) continue;
    if (role === "user" && isBootstrapContextMessage(messageText)) continue;
    const timestampText = String(parsed?.timestamp ?? "").trim();
    const timestampMs = Date.parse(timestampText);
    if (Number.isFinite(timestampMs)) {
      if (Number.isFinite(lastEventAtMs)) {
        if (timestampMs <= lastEventAtMs) continue;
      } else if (timestampMs < startedAtMs) {
        continue;
      }
    }
    out.push({
      sessionId,
      role: role === "assistant" ? "agent" : "user",
      text: messageText,
      timestamp: timestampText || new Date().toISOString()
    });
  }
  return out;
}

async function appendProjectionLog(worldRoot, agentName, sentence) {
  const logPath = worldNewspaperLogPath({
    worldRoot,
    name: `agent-${agentName}-codex`
  });
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${sentenceToPyash(sentence)}\n`, "utf8");
}

export async function projectCodexRunToPyash({
  rootDir,
  worldRoot,
  agentName,
  agentHouse,
  codexHome,
  startedAtMs
} = {}) {
  const projectionPath = path.join(agentHouse, "conduct", "codex_projection.pya");
  const current = await readProjectionState(projectionPath);
  const lastSessionId = String(current["last session id"] ?? "").trim();
  const lastEventAtText = String(current["last event at"] ?? "").trim();
  const lastEventAtMs = Date.parse(lastEventAtText);

  const located = await findCodexSessionFile({ codexHome, agentHouse, startedAtMs });
  if (!located?.sessionFile || !located?.sessionId) {
    await appendProjectionLog(worldRoot, agentName, {
      mood: "ya",
      su: { name: agentName },
      be: "codex projection",
      as: { name: "missing" },
      ob: { text: "no codex session file found for projection" },
      during: { date: new Date().toISOString() }
    });
    return { projected: 0, sessionId: "", sessionFile: "" };
  }

  const effectiveLastEventMs = lastSessionId === located.sessionId && Number.isFinite(lastEventAtMs)
    ? lastEventAtMs
    : Number.NaN;
  const messages = await readProjectedMessages(located.sessionFile, {
    startedAtMs,
    lastEventAtMs: effectiveLastEventMs,
    sessionId: located.sessionId
  });
  if (!messages.length) {
    return { projected: 0, sessionId: located.sessionId, sessionFile: located.sessionFile };
  }

  const { sessionDir } = await ensureAgentDirs(agentHouse);
  const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const sessionName = buildSessionNameForDate({
    baseName: `codex_${located.sessionId.slice(0, 8)}`,
    dateCompact: dateKey
  });
  const sessionFile = await ensureSessionFile({
    sessionDir,
    sessionName,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    model: "codex"
  });

  let maxTimestampMs = Number.isFinite(effectiveLastEventMs) ? effectiveLastEventMs : startedAtMs;
  for (const message of messages) {
    const tsMs = Date.parse(message.timestamp);
    if (Number.isFinite(tsMs) && tsMs > maxTimestampMs) maxTimestampMs = tsMs;
    await appendSessionEntry({
      sessionFile,
      role: message.role,
      content: message.text,
      metadata: {
        timestamp: message.timestamp,
        sender: message.role === "user" ? "user" : agentName,
        channelType: "codex",
        channelId: "codex:tui",
        payloadId: message.sessionId
      }
    });
  }

  await writeProjectionState(projectionPath, {
    "last session id": located.sessionId,
    "last event at": new Date(maxTimestampMs).toISOString(),
    "last session file": located.sessionFile,
    "last projected count": String(messages.length)
  });
  await appendProjectionLog(worldRoot, agentName, {
    mood: "ya",
    su: { name: agentName },
    be: "codex projection",
    as: { name: "success" },
    ob: { text: `projected ${messages.length} messages from ${path.basename(located.sessionFile)}` },
    during: { date: new Date().toISOString() }
  });

  return {
    projected: messages.length,
    sessionId: located.sessionId,
    sessionFile: located.sessionFile
  };
}
