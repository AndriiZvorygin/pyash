import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { callMindBackend } from "../verbs/mind/backend.mjs";
import { resolveConfigText } from "../configure/env.mjs";

const SESSION_ROLE_NAMES = new Set(["user", "assistant", "tool"]);

export function normalizeHistoryWindow(historyWindow, {
  defaultPairs = 50,
  minPairs = 1,
  maxPairs = 200
} = {}) {
  const numeric = Number(historyWindow);
  const fallback = Number.isFinite(Number(defaultPairs)) ? Number(defaultPairs) : 50;
  const min = Math.max(1, Math.trunc(Number(minPairs) || 1));
  const max = Math.max(min, Math.trunc(Number(maxPairs) || 200));
  const base = Number.isFinite(numeric) ? numeric : fallback;
  const clamped = Math.max(min, Math.min(max, Math.trunc(base)));
  return clamped;
}

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function todayCompact() {
  return todayDate().replace(/-/g, "");
}

function dateFromCompact(compact) {
  if (!compact || String(compact).length !== 8) return null;
  const str = String(compact);
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
}

function formatCompactDate(dateObj) {
  return dateObj.toISOString().slice(0, 10).replace(/-/g, "");
}

function shiftCompactDate(compact, days) {
  const dateStr = dateFromCompact(compact) ?? todayDate();
  const dt = new Date(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatCompactDate(dt);
}

function sanitizeSessionName(raw) {
  const base = String(raw ?? "").toLowerCase();
  const cleaned = base.replace(/[^a-z0-9]+/g, " ").trim();
  if (!cleaned) return "session";
  const parts = cleaned.split(/\s+/).slice(0, 2);
  const joined = parts.join("-");
  return joined || "session";
}

function sanitizeSessionFilenameBase(raw) {
  const base = String(raw ?? "").toLowerCase();
  const cleaned = base.replace(/[^a-z0-9]+/g, " ").trim();
  if (!cleaned) return "session";
  return cleaned.split(/\s+/).join("_");
}

function sessionFilename({ sessionName }) {
  return `${sessionName}.pya`;
}

export function resolveAgentHouse({ mindName, rememberFn }) {
  const worldRoot = rememberFn?.("world root")?.ob?.filename ?? "world";
  const resolvedRoot = path.isAbsolute(worldRoot) ? worldRoot : path.resolve(worldRoot);
  return path.join(resolvedRoot, "house", String(mindName));
}

export async function ensureAgentDirs(agentHouse) {
  const identityDir = path.join(agentHouse, "identity");
  const memoryDir = path.join(agentHouse, "memory");
  const sessionDir = path.join(agentHouse, "session");
  const conductDir = path.join(agentHouse, "conduct");
  await fs.mkdir(identityDir, { recursive: true });
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.mkdir(conductDir, { recursive: true });
  await maybeSeedIdentity(identityDir);
  await maybeSeedConduct(conductDir);
  return { identityDir, memoryDir, sessionDir, conductDir };
}

async function dirIsEmpty(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.length === 0;
  } catch (err) {
    if (err?.code === "ENOENT") return true;
    throw err;
  }
}

async function copyIdentityTemplate(templateDir, destDir) {
  const entries = await fs.readdir(templateDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src = path.join(templateDir, entry.name);
    const dest = path.join(destDir, entry.name);
    try {
      await fs.copyFile(src, dest);
    } catch (err) {
      if (err?.code === "EEXIST") continue;
      throw err;
    }
  }
}

async function maybeSeedIdentity(identityDir) {
  const empty = await dirIsEmpty(identityDir);
  if (!empty) return;
  const templateDir = path.resolve("examples", "agent-identity", "agent-helper", "identity");
  try {
    await fs.access(templateDir);
  } catch {
    return;
  }
  await copyIdentityTemplate(templateDir, identityDir);
}

async function maybeSeedConduct(conductDir) {
  const calendarPath = path.join(conductDir, "calendar.pya");
  const channelsPath = path.join(conductDir, "channels.pya");
  try {
    await fs.access(calendarPath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    const seed = [
      "su name heartbeat with wo tools vyah habit during minute 24 be calendar ya",
      'su name heartbeat lane ob text "heartbeat" ya'
    ].join("\n") + "\n";
    await fs.writeFile(calendarPath, seed, "utf8");
  }
  try {
    await fs.access(channelsPath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    await fs.writeFile(channelsPath, "", "utf8");
  }
}

export async function listSessionFiles(sessionDir, { datePrefix } = {}) {
  try {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".pya"))
      .map((entry) => entry.name)
      .filter((name) => !datePrefix || name.startsWith(datePrefix));
    return files.sort();
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

export async function pickLatestSessionFile(sessionDir, { datePrefix } = {}) {
  const files = await listSessionFiles(sessionDir, { datePrefix });
  if (!files.length) return null;
  let latest = null;
  let latestMtime = 0;
  for (const name of files) {
    const fullPath = path.join(sessionDir, name);
    try {
      const stat = await fs.stat(fullPath);
      const mtime = stat.mtimeMs || 0;
      if (mtime >= latestMtime) {
        latestMtime = mtime;
        latest = name;
      }
    } catch {
      // ignore missing files
    }
  }
  return latest ? path.join(sessionDir, latest) : null;
}

export async function findSessionFileBySystemPrompt({
  sessionDir,
  datePrefix,
  systemPrompt
} = {}) {
  if (!systemPrompt) return null;
  const files = await listSessionFiles(sessionDir, { datePrefix });
  if (!files.length) return null;
  for (const name of files) {
    const fullPath = path.join(sessionDir, name);
    let text = "";
    try {
      text = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(0, 6)) {
      let sentence = null;
      try {
        sentence = parse(line);
      } catch {
        continue;
      }
      if (sentence?.su?.name !== "system") continue;
      if (sentence?.ob?.text === systemPrompt) return fullPath;
    }
  }
  return null;
}

export async function updateSessionSummary({
  agentHouse,
  mindName,
  backendName,
  model,
  ollamaHost,
  mindDebug,
  debugMind,
  rememberFn,
  callPrompt,
  responseText
} = {}) {
  if (!agentHouse) return;
  const memoryDir = path.join(agentHouse, "memory");
  await fs.mkdir(memoryDir, { recursive: true });
  const summaryPath = path.join(memoryDir, "SUMMARY.md");
  let prior = "";
  try {
    prior = await fs.readFile(summaryPath, "utf8");
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  const mockResponse = resolveConfigText("mind response", { rememberFn });
  if (!mockResponse && !backendName) return;

  const system = "You maintain a concise running summary of the session. Output 3-5 bullet points. Keep it short and factual.";
  const user = [
    "Current summary (if any):",
    prior ? prior.trim() : "(empty)",
    "",
    "New turn:",
    `USER: ${callPrompt ?? ""}`,
    `ASSISTANT: ${responseText ?? ""}`
  ].join("\n");
  const requestPayload = {
    mode: "chat",
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    stream: false,
    options: { num_predict: 120 }
  };
  if (ollamaHost) requestPayload.host = ollamaHost;
  debugMind?.("summary request", requestPayload);

  let summaryText = "";
  if (mockResponse) {
    summaryText = String(mockResponse);
  } else {
    const response = await callMindBackend({ backendName, payload: requestPayload, debug: mindDebug });
    summaryText =
      response?.message?.content ??
      response?.response ??
      response?.content ??
      "";
  }
  if (!summaryText) return;
  await fs.writeFile(summaryPath, summaryText.trim() + "\n", "utf8");
}

export async function generateSessionName({
  promptText,
  model,
  backendName,
  ollamaHost,
  mindDebug,
  debugMind,
  rememberFn
} = {}) {
  const system = "You name sessions. Reply with 1-2 short words, lowercase, letters only.";
  const user = `Name this session based on the first prompt:\n${promptText || "(empty)"}`;
  const requestPayload = {
    mode: "chat",
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    stream: false,
    options: { num_predict: 8 }
  };
  if (ollamaHost) requestPayload.host = ollamaHost;
  debugMind?.("request", requestPayload);
  const mockResponse = resolveConfigText("mind response", { rememberFn });
  let responseText = "";
  if (mockResponse) {
    responseText = String(mockResponse);
  } else if (backendName) {
    const response = await callMindBackend({ backendName, payload: requestPayload, debug: mindDebug });
    responseText =
      response?.message?.content ??
      response?.response ??
      response?.content ??
      "";
  }
  if (!responseText) return sanitizeSessionName("session");
  return sanitizeSessionName(responseText);
}

function buildSessionHeaderLines({ sessionName, systemPrompt, model } = {}) {
  const headerSentence = {
    su: { name: sessionName },
    since: { date: todayDate() },
    be: "series",
    mood: "def"
  };
  const systemSentence = {
    su: { name: "system" },
    ob: { text: systemPrompt || "" },
    as: model ? { name: model } : undefined,
    during: { date: nowIso() },
    mood: "ya"
  };
  return `${sentenceToPyash(headerSentence)}\n${sentenceToPyash(systemSentence)}\n`;
}

export async function ensureSessionFile({
  sessionDir,
  sessionName,
  systemPrompt,
  model
} = {}) {
  await fs.mkdir(sessionDir, { recursive: true });
  const filename = sessionFilename({ sessionName });
  const filePath = path.join(sessionDir, filename);
  if (fsSync.existsSync(filePath)) return filePath;
  await fs.writeFile(filePath, buildSessionHeaderLines({ sessionName, systemPrompt, model }), "utf8");
  return filePath;
}

export async function ensureSessionFileAtPath({
  sessionFile,
  sessionName,
  systemPrompt,
  model
} = {}) {
  if (!sessionFile) return null;
  if (fsSync.existsSync(sessionFile)) return sessionFile;
  const resolvedName = sessionName || path.basename(sessionFile, path.extname(sessionFile) || ".pya");
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(sessionFile, buildSessionHeaderLines({ sessionName: resolvedName, systemPrompt, model }), "utf8");
  return sessionFile;
}

export async function appendSessionEntry({
  sessionFile,
  role,
  content,
  model
} = {}) {
  if (!sessionFile || !role) return;
  const sentence = {
    su: { name: role },
    ob: { text: String(content ?? "") },
    during: { date: nowIso() },
    mood: "ya"
  };
  if (role === "system" && model) {
    sentence.as = { name: model };
  }
  const line = sentenceToPyash(sentence);
  await fs.appendFile(sessionFile, `${line}\n`, "utf8");
}

export async function readSessionMessages({ sessionFile, historyWindow = 50 } = {}) {
  if (!sessionFile) return { messages: [], lastSystemModel: null };
  let text;
  try {
    text = await fs.readFile(sessionFile, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { messages: [], lastSystemModel: null };
    throw err;
  }
  const sentences = splitSentences(text, { includeThen: true });
  const messages = [];
  let lastSystemModel = null;
  for (const raw of sentences) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const sentence = parse(trimmed);
    const role = sentence?.su?.name;
    if (role === "system") {
      const model = sentence?.as?.name ?? sentence?.as?.text ?? null;
      if (model) lastSystemModel = model;
      continue;
    }
    if (!SESSION_ROLE_NAMES.has(role)) continue;
    const content = sentence?.ob?.text ?? "";
    messages.push({ role, content: String(content) });
  }
  const maxMessages = normalizeHistoryWindow(historyWindow, { defaultPairs: 50 }) * 2;
  if (maxMessages > 0 && messages.length > maxMessages) {
    return {
      messages: messages.slice(-maxMessages),
      lastSystemModel
    };
  }
  return { messages, lastSystemModel };
}

export function buildSessionNamePrefix() {
  return `${todayCompact()}-`;
}

export function buildSessionNameForDate({ baseName, dateCompact }) {
  if (!baseName) return null;
  const safeBase = sanitizeSessionFilenameBase(baseName);
  return `${dateCompact}-${safeBase}`;
}

export async function readSessionMessagesWithFallback({
  sessionDir,
  baseName,
  historyWindow = 50
} = {}) {
  if (!sessionDir || !baseName) return { messages: [], lastSystemModel: null };
  const maxMessages = normalizeHistoryWindow(historyWindow, { defaultPairs: 50 }) * 2;
  const todayKey = formatCompactDate(new Date());
  const todayName = buildSessionNameForDate({ baseName, dateCompact: todayKey });
  const todayFile = path.join(sessionDir, sessionFilename({ sessionName: todayName }));
  const todayMessages = await readSessionMessages({ sessionFile: todayFile, historyWindow });
  if (maxMessages > 0 && todayMessages.messages.length >= maxMessages) return todayMessages;
  const yesterdayKey = shiftCompactDate(todayKey, -1);
  const yesterdayName = buildSessionNameForDate({ baseName, dateCompact: yesterdayKey });
  const yesterdayFile = path.join(sessionDir, sessionFilename({ sessionName: yesterdayName }));
  const yesterdayMessages = await readSessionMessages({ sessionFile: yesterdayFile, historyWindow });
  const merged = [...yesterdayMessages.messages, ...todayMessages.messages];
  const sliced = maxMessages > 0 ? merged.slice(-maxMessages) : merged;
  return { messages: sliced, lastSystemModel: todayMessages.lastSystemModel ?? yesterdayMessages.lastSystemModel };
}
