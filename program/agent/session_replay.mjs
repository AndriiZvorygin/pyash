import crypto from "node:crypto";

import { sentenceToPyash } from "../beautiful.mjs";

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

const MODERN_TURN_KIND = "write";
const SESSION_CHECKPOINT_NAME = "checkpoint";
const SESSION_CHECKPOINT_KIND = "checkpoint";
const LEGACY_MODERN_TURN_KIND = "session turn";
const LEGACY_SESSION_CHECKPOINT_NAME = "session turn checkpoint";
const ACCEPTANCE_VALUES = new Set(["accept", "accepted", "pass", "passed", "satisfied"]);

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
  const metadata = {};
  if (typeof raw === "string" && /^[a-f0-9]{64}$/i.test(raw.trim())) {
    metadata.requestHash = raw.trim().toLowerCase();
  } else if (sentence?.be === LEGACY_MODERN_TURN_KIND || sentence?.su?.name === LEGACY_SESSION_CHECKPOINT_NAME) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Legacy malformed metadata remains typed by the sentence fields below.
    }
  }
  const ordinal = sentence?.by?.num ?? sentence?.by?.quantity?.num;
  if (Number.isFinite(Number(ordinal))) metadata.ordinal = Math.trunc(Number(ordinal));
  if (sentence?.from?.name) metadata.sender = String(sentence.from.name);
  if (sentence?.to?.name) metadata.channelId = String(sentence.to.name);
  if (sentence?.as?.name) metadata.channelType = String(sentence.as.name);
  if (sentence?.fromstate?.text) metadata.channelType = String(sentence.fromstate.text);
  if (sentence?.become?.text) metadata.channelType = String(sentence.become.text);
  return metadata;
}

function textFrom(sentence, key) {
  return String(sentence?.[key]?.text ?? sentence?.[key]?.name ?? "");
}

function checkpointSucceeded(sentence) {
  const values = sentence?.vyah?.ve?.values;
  return Array.isArray(values) && values.map((value) => String(value).toLowerCase()).includes("success");
}

function checkpointAccepted(sentence) {
  const values = sentence?.vyah?.ve?.values;
  if (Array.isArray(values) && values.some((value) => ACCEPTANCE_VALUES.has(String(value).toLowerCase()))) return true;
  return String(sentence?.as?.name ?? "").toLowerCase() === "accept";
}

function verifierTextFrom(sentence) {
  const direct = textFrom(sentence, "totext");
  if (direct) return direct;
  const result = sentence?.to?.la;
  return String(result?.ob?.text ?? result?.ob?.name ?? "");
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
  return sentence?.be === MODERN_TURN_KIND || sentence?.be === LEGACY_MODERN_TURN_KIND;
}

function isSessionCheckpoint(sentence, metadata) {
  return sentence?.be === "checkpoint"
    && (normalizeText(sentence?.su?.name) === SESSION_CHECKPOINT_NAME
      || normalizeText(sentence?.su?.name) === LEGACY_SESSION_CHECKPOINT_NAME
      || metadata.record === SESSION_CHECKPOINT_KIND);
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
      accepted: checkpointAccepted(sentence),
      generatorName: normalizeText(sentence?.from?.name),
      verifierName: normalizeText(sentence?.to?.name),
      verifierText: verifierTextFrom(sentence),
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
      && prior.accepted === record.accepted
      && prior.generatorName === record.generatorName
      && prior.verifierName === record.verifierName
      && prior.verifierText === record.verifierText
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
    accepted: Boolean(checkpoint?.accepted),
    generatorName: checkpoint?.generatorName ?? "",
    verifierName: checkpoint?.verifierName ?? "",
    verifierText: checkpoint?.verifierText ?? "",
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
    accepted: turn.accepted,
    generatorName: turn.generatorName,
    verifierName: turn.verifierName,
    verifierText: turn.verifierText,
    checkpoint: turn.checkpoint
      ? {
        responseText: turn.checkpoint.responseText,
        requestHash: turn.checkpoint.requestHash,
        success: turn.checkpoint.success,
        accepted: turn.checkpoint.accepted,
        generatorName: turn.checkpoint.generatorName,
        verifierName: turn.checkpoint.verifierName,
        verifierText: turn.checkpoint.verifierText
      }
      : null
  };
}

function originalTaskFromTurns(turns) {
  return turns.find((turn) => turn.hasUser)?.userContent ?? "";
}

function buildGoldenMessages({ turns, acceptedEvidence, originalTask }) {
  const latest = acceptedEvidence.at(-1);
  if (!latest) return [];
  const original = turns.find((turn) => turn.hasUser);
  const messages = [{
    role: "user",
    content: originalTask,
    turnId: original?.turnId ?? ""
  }, {
    role: "assistant",
    content: latest.responseText,
    turnId: latest.turnId
  }];
  if (latest.verifierText) {
    messages.push({
      role: "tool",
      content: latest.verifierText,
      turnId: latest.turnId,
      name: latest.verifierName || "verifier"
    });
  }
  return messages;
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
    .filter((turn) => turn.checkpoint?.success && turn.checkpoint?.accepted)
    .map((turn) => ({
      turnId: turn.turnId,
      requestHash: turn.requestHash,
      responseText: turn.responseText,
      generatorName: turn.generatorName,
      verifierName: turn.verifierName,
      verifierText: turn.verifierText,
      checkpoint: turn.checkpoint?.sentence ? canonicalSnapshot(turn.checkpoint.sentence) : null
    }));
  const originalTask = originalTaskFromTurns(turns);
  const goldenMessages = buildGoldenMessages({ turns, acceptedEvidence, originalTask });
  const systemSentences = source.filter((sentence) => sentence?.su?.name === "system");
  const lastSystem = systemSentences.at(-1);
  const snapshotHash = sha256(canonicalSnapshotText({ turns: turns.map(stableTurnSnapshot), acceptedEvidence }));
  return {
    turns,
    messages: goldenMessages.length ? goldenMessages : messages,
    pendingTurns: turns.filter((turn) => turn.pending),
    acceptedEvidence,
    goldenProjection: {
      originalTask,
      latestAcceptedGenerator: acceptedEvidence.length
        ? {
          turnId: acceptedEvidence.at(-1).turnId,
          content: acceptedEvidence.at(-1).responseText,
          name: acceptedEvidence.at(-1).generatorName
        }
        : null,
      latestAcceptedVerifier: acceptedEvidence.at(-1)?.verifierText
        ? {
          turnId: acceptedEvidence.at(-1).turnId,
          content: acceptedEvidence.at(-1).verifierText,
          name: acceptedEvidence.at(-1).verifierName
        }
        : null
    },
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
  const sentence = {
    su: { name: normalizedRole },
    ob: { text: String(content ?? "") },
    accordingto: { text: String(turnId ?? "") },
    fromtext: { text: String(requestHash ?? "") },
    be: MODERN_TURN_KIND,
    mood: "ya"
  };
  if (ordinal) sentence.by = { num: ordinal };
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
  const sentence = {
    su: { name: SESSION_CHECKPOINT_NAME },
    ob: { text: String(responseText ?? "") },
    accordingto: { text: String(turnId ?? "") },
    fromtext: { text: String(requestHash ?? "") },
    vyah: { ve: { type: "name", values: ["success"] } },
    be: "checkpoint",
    mood: "ya"
  };
  if (ordinal) sentence.by = { num: ordinal };
  if (metadata.accepted === true || String(metadata.acceptance ?? metadata.disposition ?? "").toLowerCase() === "accept") {
    sentence.vyah.ve.values.push("accept");
  }
  if (metadata.generatorName) sentence.from = { name: String(metadata.generatorName) };
  if (metadata.verifierName) sentence.to = { name: String(metadata.verifierName) };
  if (metadata.verifierText) sentence.totext = { text: String(metadata.verifierText) };
  if (timestamp || metadata.timestamp) sentence.during = { date: String(timestamp || metadata.timestamp) };
  return sentence;
}

export function buildCompactSessionSnapshot(projected) {
  const projection = projected && typeof projected === "object" ? projected : {};
  const golden = projection.goldenProjection ?? {};
  const lines = [sentenceToPyash({ su: { name: "snapshot" }, be: "series", mood: "def" })];
  lines.push(sentenceToPyash({ su: { name: "duty" }, ob: { text: golden.originalTask ?? "" }, be: "write", mood: "ya" }));
  const generator = golden.latestAcceptedGenerator;
  if (generator) {
    lines.push(sentenceToPyash({
      su: { name: "generator" },
      ob: { text: generator.content ?? "" },
      accordingto: { text: generator.turnId ?? "" },
      be: "write",
      mood: "ya"
    }));
  }
  const verifier = golden.latestAcceptedVerifier;
  if (verifier) {
    lines.push(sentenceToPyash({
      su: { name: "verifier" },
      ob: { text: verifier.content ?? "" },
      accordingto: { text: verifier.turnId ?? "" },
      be: "write",
      mood: "ya"
    }));
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function hashText(value) {
  return sha256(value);
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
