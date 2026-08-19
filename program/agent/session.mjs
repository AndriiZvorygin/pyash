import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { callMindBackend } from "../verbs/mind/backend.mjs";
import { resolveConfigMapBool, resolveConfigText } from "../configure/env.mjs";
import { remember } from "../remember/index.mjs";
import { resolveWorldAgentHouseDirectory } from "../library/agent_command_policy.mjs";
import { emitExchangeSentence, getExchangeSentenceId, recordArtifact } from "../bridge/exchange.mjs";
import {
  buildSessionCheckpointSentence,
  buildCompactSessionSnapshot,
  buildSessionTurnSentence,
  canonicalRequestHash,
  deriveTurnIdentity,
  hashText,
  nextSessionOrdinal,
  projectSessionReplay
} from "./session_replay.mjs";

export function normalizeHistoryWindow(historyWindow, {
  defaultPairs = 50,
  minPairs = 0,
  maxPairs = 200
} = {}) {
  const numeric = Number(historyWindow);
  const fallback = Number.isFinite(Number(defaultPairs)) ? Number(defaultPairs) : 50;
  const min = Math.max(0, Math.trunc(Number(minPairs) || 0));
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
  return resolveWorldAgentHouseDirectory({
    worldRoot: resolvedRoot,
    agentName: String(mindName ?? "").trim(),
    includeFallback: true
  }) ?? path.join(resolvedRoot, "house", String(mindName));
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
  const importPath = path.join(conductDir, "import.pya");
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
  try {
    await fs.access(importPath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    const seed = [
      "su name import be map def",
      '  su name default ob text "" ya',
      '  su name photograph ob text "" ya',
      '  su name documentation ob text "" ya',
      '  su name audio ob text "" ya',
      '  su name text ob text "" ya',
      '  su name file ob text "" ya',
      '  su name read tool ob text "" ya',
      '  su name see tool ob text "" ya',
      '  su name command tool ob text "" ya',
      '  su name repair tool ob text "" ya',
      "prah"
    ].join("\n") + "\n";
    await fs.writeFile(importPath, seed, "utf8");
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
    `AGENT: ${responseText ?? ""}`
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
  model,
  metadata
} = {}) {
  if (!sessionFile || !role) return;
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  if (meta.turnId) {
    const sentence = buildSessionTurnSentence({
      role,
      content,
      turnId: meta.turnId,
      requestHash: meta.requestHash,
      ordinal: meta.ordinal,
      metadata: meta,
      timestamp: meta.timestamp || nowIso()
    });
    await fs.appendFile(sessionFile, `${sentenceToPyash(sentence)}\n`, "utf8");
    return;
  }
  const sentence = {
    su: { name: role },
    ob: { text: String(content ?? "") },
    during: { date: String(meta.timestamp || nowIso()) },
    mood: "ya"
  };
  if (role === "system" && model) {
    sentence.as = { name: model };
  }
  if (meta.sender) sentence.from = { name: String(meta.sender) };
  if (meta.channelId) sentence.to = { name: String(meta.channelId) };
  if (meta.channelType) {
    if (role === "assistant" || role === "agent") sentence.become = { text: String(meta.channelType) };
    else sentence.fromstate = { text: String(meta.channelType) };
  }
  if (meta.payloadId) sentence.accordingto = { text: String(meta.payloadId) };
  const line = sentenceToPyash(sentence);
  await fs.appendFile(sessionFile, `${line}\n`, "utf8");
}

async function readSessionSentences({ sessionFile } = {}) {
  if (!sessionFile) return [];
  let text;
  try {
    text = await fs.readFile(sessionFile, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  return splitSentences(text, { includeThen: true })
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => parse(raw));
}

export async function readSessionReplay({ sessionFile, historyWindow = 50 } = {}) {
  const sentences = await readSessionSentences({ sessionFile });
  return projectSessionReplay({ sentences, historyWindow });
}

export async function readSessionReplayWithFallback({
  sessionDir,
  baseName,
  historyWindow = 50
} = {}) {
  if (!sessionDir || !baseName) return projectSessionReplay({ sentences: [], historyWindow });
  const maxPairs = normalizeHistoryWindow(historyWindow, { defaultPairs: 50 });
  if (maxPairs <= 0) return projectSessionReplay({ sentences: [], historyWindow: 0 });
  const todayKey = formatCompactDate(new Date());
  const todayName = buildSessionNameForDate({ baseName, dateCompact: todayKey });
  const todayFile = path.join(sessionDir, sessionFilename({ sessionName: todayName }));
  const yesterdayKey = shiftCompactDate(todayKey, -1);
  const yesterdayName = buildSessionNameForDate({ baseName, dateCompact: yesterdayKey });
  const yesterdayFile = path.join(sessionDir, sessionFilename({ sessionName: yesterdayName }));
  const [yesterdaySentences, todaySentences] = await Promise.all([
    readSessionSentences({ sessionFile: yesterdayFile }),
    readSessionSentences({ sessionFile: todayFile })
  ]);
  return projectSessionReplay({
    sentences: [...yesterdaySentences, ...todaySentences],
    historyWindow
  });
}

async function appendReplaySentence(sessionFile, sentence) {
  await fs.appendFile(sessionFile, `${sentenceToPyash(sentence)}\n`, "utf8");
}

const persistedSnapshotLinks = new Set();

function snapshotArtifactPart(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "session";
}

async function persistSessionSnapshot({ sessionFile, turnId, replay } = {}) {
  if (resolveConfigMapBool("session configure", "snapshot enabled", { rememberFn: remember }) === false) return null;
  const snapshotText = buildCompactSessionSnapshot(replay);
  const snapshotHash = hashText(snapshotText);
  const locator = `artifacts/session/${snapshotArtifactPart(turnId)}-${snapshotHash}.pya`;
  const artifact = recordArtifact({
    locator,
    producer: "session",
    bytes: Buffer.from(snapshotText, "utf8"),
    kind: "snapshot"
  });
  if (!artifact) return null;
  const artifactName = String(artifact?.su?.name ?? "").trim();
  const linkKey = `${sessionFile}\n${turnId}\n${snapshotHash}`;
  if (!persistedSnapshotLinks.has(linkKey)) {
    emitExchangeSentence({
      mood: "ya",
      be: "checkpoint",
      su: { name: "checkpoint" },
      ob: { text: snapshotHash },
      accordingto: { text: String(turnId ?? "") },
      from: artifactName ? { name: artifactName } : undefined,
      to: artifact?.to?.filename ? { filename: artifact.to.filename } : undefined,
      vyah: { ve: { type: "name", values: ["success"] } }
    });
    persistedSnapshotLinks.add(linkKey);
  }
  return {
    hash: snapshotHash,
    locator,
    artifactName,
    text: snapshotText
  };
}

export async function beginSessionTurn({
  sessionFile,
  userContent = "",
  request = {},
  metadata = {}
} = {}) {
  if (!sessionFile) return null;
  const replay = await readSessionReplay({ sessionFile, historyWindow: 0 });
  const requestValue = request && typeof request === "object" ? request : { value: request };
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const requestHash = canonicalRequestHash(requestValue);
  const ordinal = nextSessionOrdinal(replay.turns);
  const payloadId = meta.payloadId || requestValue.payloadId || requestValue.inboundPayloadId;
  const exchangeSentenceId = payloadId
    ? ""
    : (meta.exchangeSentenceId || requestValue.exchangeSentenceId || getExchangeSentenceId() || "");
  let identity = deriveTurnIdentity({
    payloadId,
    exchangeSentenceId,
    sessionOrdinal: ordinal,
    request: requestValue
  });
  const pendingMatches = !payloadId && !exchangeSentenceId
    ? replay.pendingTurns.filter((turn) => turn.modern && turn.requestHash === requestHash)
    : [];
  if (pendingMatches.length > 1) {
    throw new Error(`session replay defective: multiple pending turns for request hash ${requestHash}`);
  }
  const pendingMatch = pendingMatches[0] ?? null;
  if (pendingMatch) {
    identity = {
      ...identity,
      turnId: pendingMatch.turnId,
      ordinal: pendingMatch.records?.user?.metadata?.ordinal ?? pendingMatch.records?.assistant?.metadata?.ordinal ?? identity.ordinal,
      source: "pending",
      sourceId: ""
    };
  }
  const existing = replay.turns.find((turn) => turn.turnId === identity.turnId);
  if (existing) {
    if (existing.requestHash && existing.requestHash !== requestHash) {
      throw new Error(`session replay defective: conflicting request for ${identity.turnId}`);
    }
    if (existing.hasUser && existing.userContent !== String(userContent ?? "")) {
      throw new Error(`session replay defective: conflicting user record for ${identity.turnId}`);
    }
    if (existing.complete) {
      return {
        status: "completed",
        replayed: true,
        turnId: identity.turnId,
        requestHash,
        responseText: existing.responseText,
        sessionFile
      };
    }
    return {
      status: "pending",
      replayed: true,
      turnId: identity.turnId,
      requestHash,
      ordinal: identity.ordinal,
      source: identity.source,
      sourceId: identity.sourceId,
      sessionFile,
      metadata: meta
    };
  }

  const recordMetadata = {
    ...meta,
    payloadId: payloadId ? String(payloadId) : meta.payloadId,
    exchangeSentenceId: exchangeSentenceId ? String(exchangeSentenceId) : meta.exchangeSentenceId,
    turnId: identity.turnId,
    requestHash,
    ordinal
  };
  const sentence = buildSessionTurnSentence({
    role: "user",
    content: userContent,
    turnId: identity.turnId,
    requestHash,
    ordinal,
    metadata: recordMetadata,
    timestamp: meta.timestamp || nowIso()
  });
  await appendReplaySentence(sessionFile, sentence);
  return {
    status: "pending",
    replayed: false,
    turnId: identity.turnId,
    requestHash,
    ordinal,
    source: identity.source,
    sourceId: identity.sourceId,
    sessionFile,
    metadata: recordMetadata
  };
}

export async function completeSessionTurn({
  sessionFile,
  turn,
  responseText = "",
  metadata = {}
} = {}) {
  if (!sessionFile || !turn?.turnId) return null;
  const replay = await readSessionReplay({ sessionFile, historyWindow: 0 });
  const current = replay.turns.find((entry) => entry.turnId === turn.turnId);
  if (!current) throw new Error(`session replay defective: missing turn ${turn.turnId}`);
  if (current.requestHash && turn.requestHash && current.requestHash !== turn.requestHash) {
    throw new Error(`session replay defective: conflicting request for ${turn.turnId}`);
  }
  const response = String(responseText ?? "");
  if (current.complete) {
    if (current.responseText !== response) {
      throw new Error(`session replay defective: conflicting response for ${turn.turnId}`);
    }
    const snapshotReplay = await readSessionReplay({ sessionFile, historyWindow: 0 });
    const snapshotArtifact = await persistSessionSnapshot({ sessionFile, turnId: turn.turnId, replay: snapshotReplay });
    return { ...turn, status: "completed", replayed: true, responseText: current.responseText, snapshotArtifact, sessionFile };
  }
  if (current.records.assistant && current.records.assistant.content !== response) {
    throw new Error(`session replay defective: conflicting response for ${turn.turnId}`);
  }
  const priorMetadata = current.records.user?.metadata ?? {};
  const recordMetadata = {
    ...priorMetadata,
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    turnId: turn.turnId,
    requestHash: turn.requestHash || current.requestHash,
    ordinal: turn.ordinal || priorMetadata.ordinal
  };
  if (!current.records.assistant) {
    await appendReplaySentence(sessionFile, buildSessionTurnSentence({
      role: "assistant",
      content: response,
      turnId: turn.turnId,
      requestHash: recordMetadata.requestHash,
      ordinal: recordMetadata.ordinal,
      metadata: recordMetadata,
      timestamp: recordMetadata.timestamp || nowIso()
    }));
  }
  const afterAssistant = await readSessionReplay({ sessionFile, historyWindow: 0 });
  const afterTurn = afterAssistant.turns.find((entry) => entry.turnId === turn.turnId);
  if (afterTurn?.hasCheckpoint) {
    if (!afterTurn.complete || afterTurn.responseText !== response) {
      throw new Error(`session replay defective: conflicting checkpoint for ${turn.turnId}`);
    }
    const snapshotArtifact = await persistSessionSnapshot({ sessionFile, turnId: turn.turnId, replay: afterAssistant });
    return { ...turn, status: "completed", replayed: true, responseText, snapshotArtifact, sessionFile };
  }
  await appendReplaySentence(sessionFile, buildSessionCheckpointSentence({
    turnId: turn.turnId,
    requestHash: recordMetadata.requestHash,
    responseText: response,
    ordinal: recordMetadata.ordinal,
    metadata: recordMetadata,
    timestamp: recordMetadata.timestamp || nowIso()
  }));
  const completedReplay = await readSessionReplay({ sessionFile, historyWindow: 0 });
  const snapshotArtifact = await persistSessionSnapshot({ sessionFile, turnId: turn.turnId, replay: completedReplay });
  return { ...turn, status: "completed", replayed: false, responseText: response, snapshotArtifact, sessionFile };
}

export async function appendAcceptedSessionCheckpoint({
  sessionFile,
  turnId,
  generatorName = "",
  verifierName = "",
  verifierText = ""
} = {}) {
  if (!sessionFile || !turnId) return null;
  const replay = await readSessionReplay({ sessionFile, historyWindow: 0 });
  const turn = replay.turns.find((entry) => entry.turnId === turnId);
  if (!turn?.complete || !turn.checkpoint?.success) {
    throw new Error(`session replay defective: cannot accept incomplete turn ${turnId}`);
  }
  if (turn.accepted) {
    const snapshotArtifact = await persistSessionSnapshot({ sessionFile, turnId, replay });
    return { ...turn, snapshotArtifact, sessionFile };
  }
  await appendReplaySentence(sessionFile, buildSessionCheckpointSentence({
    turnId,
    requestHash: turn.requestHash,
    responseText: turn.responseText,
    ordinal: turn.records?.user?.metadata?.ordinal,
    metadata: {
      accepted: true,
      generatorName,
      verifierName,
      verifierText
    }
  }));
  const acceptedReplay = await readSessionReplay({ sessionFile, historyWindow: 0 });
  const acceptedTurn = acceptedReplay.turns.find((entry) => entry.turnId === turnId);
  if (!acceptedTurn?.accepted) {
    throw new Error(`session replay defective: accepted checkpoint was not projected for ${turnId}`);
  }
  const snapshotArtifact = await persistSessionSnapshot({
    sessionFile,
    turnId,
    replay: acceptedReplay
  });
  return { ...acceptedTurn, snapshotArtifact, sessionFile };
}

export async function appendAcceptedSessionCheckpointForMind({
  mindName,
  task,
  responseText,
  generatorName = mindName,
  verifierName = "",
  verifierText = ""
} = {}) {
  if (!mindName || !task || !responseText) return null;
  const agentHouse = resolveAgentHouse({ mindName, rememberFn: remember });
  const { sessionDir } = await ensureAgentDirs(agentHouse);
  const files = await listSessionFiles(sessionDir);
  for (const filename of files) {
    const sessionFile = path.join(sessionDir, filename);
    const replay = await readSessionReplay({ sessionFile, historyWindow: 0 });
    const candidates = replay.turns
      .filter((turn) => turn.complete && turn.userContent === String(task) && turn.responseText === String(responseText))
      .sort((left, right) => right.firstIndex - left.firstIndex);
    if (!candidates.length) continue;
    return appendAcceptedSessionCheckpoint({
      sessionFile,
      turnId: candidates[0].turnId,
      generatorName,
      verifierName,
      verifierText
    });
  }
  return null;
}

export async function readSessionMessages({ sessionFile, historyWindow = 50 } = {}) {
  if (!sessionFile) return { messages: [], lastSystemModel: null };
  const projected = await readSessionReplay({ sessionFile, historyWindow });
  const messages = projected.messages.map(({ role, content }) => ({ role, content }));
  const maxMessages = normalizeHistoryWindow(historyWindow, { defaultPairs: 50 }) * 2;
  if (maxMessages <= 0) {
    return { messages: [], lastSystemModel: projected.lastSystemModel };
  }
  return { messages, lastSystemModel: projected.lastSystemModel };
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
  const projected = await readSessionReplayWithFallback({ sessionDir, baseName, historyWindow });
  const maxMessages = normalizeHistoryWindow(historyWindow, { defaultPairs: 50 }) * 2;
  const messages = projected.messages.map(({ role, content }) => ({ role, content }));
  return {
    messages: maxMessages > 0 ? messages : [],
    lastSystemModel: projected.lastSystemModel
  };
}
