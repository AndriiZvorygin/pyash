import crypto from "node:crypto";

const TIMESTAMP_KEYS = new Set([
  "created",
  "createdAt",
  "during",
  "finishedAt",
  "since",
  "startedAt",
  "timestamp",
  "updatedAt"
]);

const MODERN_TURN_KIND = "session turn";
const SESSION_CHECKPOINT_NAME = "session turn checkpoint";
const SESSION_CHECKPOINT_KIND = "checkpoint";

export class SessionReplayDefectiveError extends Error {
  constructor(message = "session replay defective") {
    super(message.startsWith("session replay defective") ? message : `session replay defective: ${message}`);
    this.name = "SessionReplayDefectiveError";
  }
}

function defective(message) {
  throw new SessionReplayDefectiveError(message);
}

function canonicalize(value, key = "") {
  if (TIMESTAMP_KEYS.has(key)) return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const name of Object.keys(value).sort()) {
    const normalized = canonicalize(value[name], name);
    if (normalized !== undefined) result[name] = normalized;
  }
  return result;
}

export function canonicalSnapshot(value) {
  return canonicalize(value);
}

export function canonicalSnapshotText(value) {
  return JSON.stringify(canonicalSnapshot(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function canonicalRequestHash(request) {
  return sha256(canonicalSnapshotText(request ?? {}));
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function sourcePart(value) {
  const source = normalizeText(value);
  const safe = source.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || `source-${sha256(source).slice(0, 12)}`;
}

function readSource({ payloadId, exchangeSentenceId } = {}) {
  const payload = normalizeText(payloadId);
  if (payload) return { kind: "payload", value: payload };
  const exchange = normalizeText(exchangeSentenceId);
  if (exchange) return { kind: "exchange", value: exchange };
  return null;
}

export function deriveTurnIdentity({
  payloadId,
  exchangeSentenceId,
  sessionOrdinal = 1,
  request = {}
} = {}) {
  const requestHash = canonicalRequestHash(request);
  const source = readSource({ payloadId, exchangeSentenceId });
  if (source) {
    return {
      turnId: `turn-${source.kind}-${sourcePart(source.value)}-${sha256(source.value).slice(0, 8)}`,
      requestHash,
      ordinal: null,
      source: source.kind,
      sourceId: source.value
    };
  }
  const ordinal = Math.max(1, Math.trunc(Number(sessionOrdinal) || 1));
  return {
    turnId: `turn-${String(ordinal).padStart(6, "0")}-${requestHash.slice(0, 12)}`,
    requestHash,
    ordinal,
    source: "ordinal",
    sourceId: ""
  };
}

function metadataFromSentence(sentence) {
  const raw = sentence?.fromtext?.text;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function textFrom(sentence, key) {
  return String(sentence?.[key]?.text ?? sentence?.[key]?.name ?? "");
}

function checkpointSucceeded(sentence) {
  const values = sentence?.vyah?.ve?.values;
  return Array.isArray(values) && values.map((value) => String(value).toLowerCase()).includes("success");
}

function roleFor(sentence) {
  const raw = normalizeText(sentence?.su?.name).toLowerCase();
  if (raw === "agent" || raw === "assistant") return "assistant";
  if (raw === "user") return "user";
  return raw;
}

function requestHashFor({ sentence, metadata, role }) {
  const explicit = normalizeText(metadata.requestHash);
  if (explicit) return explicit;
  if (role === "user") return canonicalRequestHash({ content: textFrom(sentence, "ob") });
  return "";
}

function turnIdFor(sentence, metadata) {
  return normalizeText(
    textFrom(sentence, "accordingto")
    || metadata.turnId
  );
}

function isModernTurn(sentence) {
  return sentence?.be === MODERN_TURN_KIND;
}

function isSessionCheckpoint(sentence, metadata) {
  return sentence?.be === "checkpoint"
    && (normalizeText(sentence?.su?.name) === SESSION_CHECKPOINT_NAME || metadata.record === SESSION_CHECKPOINT_KIND);
}

function recordFromSentence(sentence, index) {
  const metadata = metadataFromSentence(sentence);
  const role = roleFor(sentence);
  if (isSessionCheckpoint(sentence, metadata)) {
    const turnId = turnIdFor(sentence, metadata);
    if (!turnId) defective(`checkpoint at record ${index} has no turn id`);
    return {
      kind: "checkpoint",
      modern: true,
      index,
      turnId,
      requestHash: normalizeText(metadata.requestHash),
      responseText: textFrom(sentence, "ob"),
      success: checkpointSucceeded(sentence),
      metadata,
      sentence
    };
  }
  if (isModernTurn(sentence)) {
    if (role !== "user" && role !== "assistant") defective(`record ${index} has invalid turn role`);
    const turnId = turnIdFor(sentence, metadata);
    if (!turnId) defective(`record ${index} has no turn id`);
    return {
      kind: role,
      modern: true,
      index,
      turnId,
      requestHash: requestHashFor({ sentence, metadata, role }),
      content: textFrom(sentence, "ob"),
      metadata,
      sentence
    };
  }
  if (role === "user" || role === "assistant") {
    return {
      kind: role,
      modern: false,
      index,
      content: textFrom(sentence, "ob"),
      sentence
    };
  }
  return null;
}

function compareModernRecord(turn, record) {
  const prior = turn.records[record.kind];
  if (!prior) {
    turn.records[record.kind] = record;
    return;
  }
  const same = record.kind === "checkpoint"
    ? prior.responseText === record.responseText
      && prior.success === record.success
      && (!prior.requestHash || !record.requestHash || prior.requestHash === record.requestHash)
    : prior.content === record.content
      && (!prior.requestHash || !record.requestHash || prior.requestHash === record.requestHash);
  if (!same) defective(`conflicting ${record.kind} records for ${record.turnId}`);
}

function addModernRecord(turns, record) {
  let turn = turns.get(record.turnId);
  if (!turn) {
    turn = {
      turnId: record.turnId,
      modern: true,
      legacy: false,
      firstIndex: record.index,
      requestHash: record.requestHash || "",
      records: {}
    };
    turns.set(record.turnId, turn);
  }
  turn.firstIndex = Math.min(turn.firstIndex, record.index);
  if (record.requestHash && turn.requestHash && record.requestHash !== turn.requestHash) {
    defective(`conflicting request hashes for ${record.turnId}`);
  }
  if (record.requestHash) turn.requestHash = record.requestHash;
  compareModernRecord(turn, record);
}

function syntheticLegacyId(user, assistant, ordinal) {
  const hash = canonicalRequestHash({ user: user.content, assistant: assistant.content });
  return `legacy-turn-${String(ordinal).padStart(6, "0")}-${hash.slice(0, 12)}`;
}

function addLegacyTurn(turns, user, assistant, ordinal) {
  const turnId = syntheticLegacyId(user, assistant, ordinal);
  turns.set(turnId, {
    turnId,
    modern: false,
    legacy: true,
    firstIndex: user.index,
    requestHash: canonicalRequestHash({ content: user.content }),
    records: { user, assistant }
  });
}

function buildTurns(sentences) {
  const modernTurns = new Map();
  const legacyRecords = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const record = recordFromSentence(sentences[index], index);
    if (!record) continue;
    if (record.modern) addModernRecord(modernTurns, record);
    else legacyRecords.push(record);
  }

  const turns = new Map(modernTurns);
  let legacyOrdinal = 1;
  for (let index = 0; index < legacyRecords.length; index += 1) {
    const current = legacyRecords[index];
    if (current.kind === "user") {
      const next = legacyRecords[index + 1];
      if (next?.kind === "assistant" && next.index === current.index + 1) {
        addLegacyTurn(turns, current, next, legacyOrdinal);
        legacyOrdinal += 1;
        index += 1;
      } else {
        const turnId = `legacy-pending-${String(legacyOrdinal).padStart(6, "0")}-${canonicalRequestHash({ content: current.content }).slice(0, 12)}`;
        turns.set(turnId, {
          turnId,
          modern: false,
          legacy: true,
          firstIndex: current.index,
          requestHash: canonicalRequestHash({ content: current.content }),
          records: { user: current }
        });
        legacyOrdinal += 1;
      }
      continue;
    }
    defective(`orphan legacy assistant at record ${current.index}`);
  }
  return [...turns.values()].sort((left, right) => left.firstIndex - right.firstIndex || left.turnId.localeCompare(right.turnId));
}

function normalizeTurn(turn) {
  const user = turn.records.user;
  const assistant = turn.records.assistant;
  const checkpoint = turn.records.checkpoint;
  const complete = turn.legacy
    ? Boolean(user && assistant)
    : Boolean(user && assistant && checkpoint?.success);
  if (checkpoint && (!user || !assistant)) defective(`checkpoint ${turn.turnId} is missing its turn records`);
  if (checkpoint && !checkpoint.success) defective(`checkpoint ${turn.turnId} is not successful`);
  if (checkpoint && assistant && checkpoint.responseText !== assistant.content) {
    defective(`conflicting assistant and checkpoint responses for ${turn.turnId}`);
  }
  if (assistant && user && assistant.requestHash && user.requestHash && assistant.requestHash !== user.requestHash) {
    defective(`conflicting request hashes for ${turn.turnId}`);
  }
  return {
    turnId: turn.turnId,
    modern: turn.modern,
    legacy: turn.legacy,
    firstIndex: turn.firstIndex,
    requestHash: turn.requestHash || user?.requestHash || "",
    userContent: user?.content ?? "",
    responseText: assistant?.content ?? checkpoint?.responseText ?? "",
    hasUser: Boolean(user),
    hasAssistant: Boolean(assistant),
    hasCheckpoint: Boolean(checkpoint),
    complete,
    pending: !complete,
    checkpoint: checkpoint ?? null,
    records: turn.records
  };
}

function stableTurnSnapshot(turn) {
  return {
    turnId: turn.turnId,
    modern: turn.modern,
    legacy: turn.legacy,
    requestHash: turn.requestHash,
    userContent: turn.userContent,
    responseText: turn.responseText,
    hasUser: turn.hasUser,
    hasAssistant: turn.hasAssistant,
    hasCheckpoint: turn.hasCheckpoint,
    complete: turn.complete,
    checkpoint: turn.checkpoint
      ? {
        responseText: turn.checkpoint.responseText,
        requestHash: turn.checkpoint.requestHash,
        success: turn.checkpoint.success
      }
      : null
  };
}

export function projectSessionReplay({ sentences = [], historyWindow = 50 } = {}) {
  const source = Array.isArray(sentences) ? sentences : [];
  const turns = buildTurns(source).map(normalizeTurn);
  const completeTurns = turns.filter((turn) => turn.complete);
  const maxPairs = Math.max(0, Math.trunc(Number(historyWindow) || 0));
  const recentTurns = maxPairs > 0 ? completeTurns.slice(-maxPairs) : [];
  const messages = recentTurns.flatMap((turn) => [
    { role: "user", content: turn.userContent, turnId: turn.turnId },
    { role: "assistant", content: turn.responseText, turnId: turn.turnId }
  ]);
  const acceptedEvidence = completeTurns
    .filter((turn) => turn.checkpoint?.success)
    .map((turn) => ({
      turnId: turn.turnId,
      requestHash: turn.requestHash,
      responseText: turn.responseText,
      checkpoint: turn.checkpoint?.sentence ? canonicalSnapshot(turn.checkpoint.sentence) : null
    }));
  const systemSentences = source.filter((sentence) => sentence?.su?.name === "system");
  const lastSystem = systemSentences.at(-1);
  const snapshotHash = sha256(canonicalSnapshotText({ turns: turns.map(stableTurnSnapshot), acceptedEvidence }));
  return {
    turns,
    messages,
    pendingTurns: turns.filter((turn) => turn.pending),
    acceptedEvidence,
    snapshotHash,
    lastSystemModel: lastSystem?.as?.name ?? lastSystem?.as?.text ?? null
  };
}

export function buildSessionTurnSentence({
  role,
  content,
  turnId,
  requestHash,
  ordinal,
  metadata = {},
  timestamp = ""
} = {}) {
  const normalizedRole = role === "assistant" ? "agent" : String(role ?? "");
  const replayMetadata = {
    record: normalizedRole === "agent" ? "assistant" : normalizedRole,
    turnId: String(turnId ?? ""),
    requestHash: String(requestHash ?? ""),
    ...(ordinal ? { ordinal } : {}),
    ...(metadata.payloadId ? { payloadId: String(metadata.payloadId) } : {}),
    ...(metadata.exchangeSentenceId ? { exchangeSentenceId: String(metadata.exchangeSentenceId) } : {})
  };
  const sentence = {
    su: { name: normalizedRole },
    ob: { text: String(content ?? "") },
    accordingto: { text: String(turnId ?? "") },
    fromtext: { text: JSON.stringify(replayMetadata) },
    be: MODERN_TURN_KIND,
    mood: "ya"
  };
  if (timestamp || metadata.timestamp) sentence.during = { date: String(timestamp || metadata.timestamp) };
  if (metadata.sender) sentence.from = { name: String(metadata.sender) };
  if (metadata.channelId) sentence.to = { name: String(metadata.channelId) };
  if (metadata.channelType) {
    if (normalizedRole === "agent") sentence.become = { text: String(metadata.channelType) };
    else sentence.fromstate = { text: String(metadata.channelType) };
  }
  return sentence;
}

export function buildSessionCheckpointSentence({
  turnId,
  requestHash,
  responseText,
  ordinal,
  metadata = {},
  timestamp = ""
} = {}) {
  const replayMetadata = {
    record: SESSION_CHECKPOINT_KIND,
    turnId: String(turnId ?? ""),
    requestHash: String(requestHash ?? ""),
    ...(ordinal ? { ordinal } : {}),
    ...(metadata.payloadId ? { payloadId: String(metadata.payloadId) } : {}),
    ...(metadata.exchangeSentenceId ? { exchangeSentenceId: String(metadata.exchangeSentenceId) } : {})
  };
  const sentence = {
    su: { name: SESSION_CHECKPOINT_NAME },
    ob: { text: String(responseText ?? "") },
    accordingto: { text: String(turnId ?? "") },
    fromtext: { text: JSON.stringify(replayMetadata) },
    vyah: { ve: { type: "name", values: ["success"] } },
    be: "checkpoint",
    mood: "ya"
  };
  if (timestamp || metadata.timestamp) sentence.during = { date: String(timestamp || metadata.timestamp) };
  return sentence;
}

export function nextSessionOrdinal(turns = []) {
  let max = 0;
  for (const turn of turns) {
    const ordinal = Number(turn.records?.user?.metadata?.ordinal ?? turn.records?.assistant?.metadata?.ordinal);
    if (Number.isFinite(ordinal)) max = Math.max(max, Math.trunc(ordinal));
  }
  return Math.max(max, turns.length) + 1;
}

export function sessionTurnKind() {
  return MODERN_TURN_KIND;
}
