import crypto from "node:crypto";

import { sentenceToPyash } from "../beautiful.mjs";
import { resolveVerbAlias } from "./verbAliases.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EVIDENTIAL_PATTERN = /^(direct|reported|inferential)-evidential$/u;
const SOURCE_PART_PATTERN = /^[^\s#]+$/u;
const ANCHOR_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const EVIDENTIAL_NAMES = Object.freeze({
  direct: "direct-evidential",
  reported: "reported-evidential",
  inferential: "inferential-evidential"
});

export function isEvidenceSentence(sentence = {}) {
  const name = String(sentence?.accordingto?.name ?? "").trim().toLowerCase();
  return EVIDENTIAL_PATTERN.test(name);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)])
  );
}

function valueKey(value) {
  return JSON.stringify(canonicalJson(value));
}

function aliasName(value, aliases = {}) {
  const text = String(value ?? "").trim().replace(/\s+/gu, " ");
  if (!text) return text;
  return String(aliases[text] ?? aliases[text.toLowerCase()] ?? text).trim().replace(/\s+/gu, " ");
}

function canonicalNp(value, { aliases = {} } = {}) {
  if (!value || typeof value !== "object") return value;
  const normalized = cloneValue(value);
  if (normalized.name !== undefined) normalized.name = aliasName(normalized.name, aliases);
  if (normalized.text !== undefined) normalized.text = String(normalized.text);
  if (normalized.wo !== undefined) normalized.wo = String(normalized.wo);
  if (normalized.filename !== undefined) normalized.filename = String(normalized.filename);
  if (normalized.genitive?.chain) {
    normalized.genitive.chain = normalized.genitive.chain.map(part => aliasName(part, aliases));
  }
  return normalized;
}

function canonicalDate(value, field) {
  const text = String(value?.date ?? "").trim();
  if (!DATE_PATTERN.test(text)) {
    throw new Error(`time window defective: ${field} must be YYYY-MM-DD`);
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`time window defective: ${field} is not a calendar date`);
  }
  return text;
}

export function normalizeTimeWindow(sentence = {}) {
  const during = sentence.during;
  const until = sentence.until;
  const hasDuring = during !== undefined;
  const hasUntil = until !== undefined;
  const hasUnsupportedStart = sentence.since !== undefined;

  if (hasUnsupportedStart || hasDuring !== hasUntil) {
    throw new Error("time window defective: use both during and until dates or neither");
  }
  if (!hasDuring) return { kind: "timeless", bucket: "timeless" };

  const start = canonicalDate(during, "during");
  const end = canonicalDate(until, "until");
  if (start > end) {
    throw new Error("time window defective: during date must not follow until date");
  }
  return { kind: "date", start, end, bucket: `${start}..${end}` };
}

function normalizedPredicate(value) {
  const raw = String(value ?? "").trim().replace(/\s+/gu, " ");
  if (!raw) throw new Error("claim identity defective: be predicate is required");
  return resolveVerbAlias(raw);
}

function subjectFor(sentence, options) {
  const subject = canonicalNp(sentence.su, options);
  if (!subject || typeof subject !== "object" || (subject.name === undefined && subject.text === undefined && subject.wo === undefined)) {
    throw new Error("claim identity defective: su subject is required");
  }
  return subject;
}

export function normalizeClaimSentence(sentence = {}, { aliases = {} } = {}) {
  if (!sentence || typeof sentence !== "object") {
    throw new Error("claim identity defective: sentence is required");
  }
  const normalized = cloneValue(sentence);
  normalized.su = subjectFor(sentence, { aliases });
  normalized.be = normalizedPredicate(sentence.be);
  if (sentence.as !== undefined) normalized.as = canonicalNp(sentence.as, { aliases });
  if (normalized.accordingto?.name !== undefined) {
    const evidential = String(normalized.accordingto.name).trim().toLowerCase();
    if (EVIDENTIAL_PATTERN.test(evidential)) normalized.accordingto.name = evidential;
  }

  const window = normalizeTimeWindow(sentence);
  if (window.kind === "timeless") {
    delete normalized.during;
    delete normalized.until;
  } else {
    normalized.during = { date: window.start };
    normalized.until = { date: window.end };
  }
  return normalized;
}

export function deriveClaimKey(sentence = {}, options = {}) {
  const normalized = normalizeClaimSentence(sentence, options);
  const identity = {
    su: normalized.su,
    ...(normalized.during ? { during: normalized.during, until: normalized.until } : {}),
    ...(normalized.as !== undefined ? { as: normalized.as } : {}),
    be: normalized.be,
    mood: "ya"
  };
  return sentenceToPyash(identity);
}

export const claimKey = deriveClaimKey;
export const deriveClaimIdentity = deriveClaimKey;

export function claimKeyHash(sentence, options = {}) {
  return crypto.createHash("sha256").update(deriveClaimKey(sentence, options), "utf8").digest("hex");
}

function evidenceName(sentence) {
  const raw = String(sentence?.accordingto?.name ?? "").trim().toLowerCase();
  if (!EVIDENTIAL_PATTERN.test(raw)) {
    throw new Error("evidential defective: accordingto name must be direct-evidential, reported-evidential, or inferential-evidential");
  }
  return raw;
}

function sourceAnchor(sentence) {
  const sourceValue = sentence?.fromtext;
  if (sourceValue === undefined) return { source: null, anchor: null, anchorId: null };

  if (sourceValue && typeof sourceValue === "object" && sourceValue.source !== undefined) {
    const source = String(sourceValue.source ?? "").trim();
    const anchor = String(sourceValue.anchor ?? "").trim();
    return validateSourceAnchor(source, anchor);
  }

  const raw = String(sourceValue?.text ?? sourceValue?.name ?? sourceValue?.wo ?? "").trim();
  const hashParts = raw.split("#");
  const parts = hashParts.length === 2 ? hashParts : raw.split(/\s+/u);
  if (parts.length !== 2) {
    throw new Error("source anchor defective: fromtext must contain <src> <anchor>");
  }
  return validateSourceAnchor(parts[0], parts[1]);
}

function validateSourceAnchor(source, anchor) {
  if (!SOURCE_PART_PATTERN.test(source) || !ANCHOR_PART_PATTERN.test(anchor)) {
    throw new Error("source anchor defective: source and anchor must be stable identifiers");
  }
  return { source, anchor, anchorId: `${source}#${anchor}` };
}

function confidenceFor(sentence) {
  if (sentence?.by === undefined) return null;
  const confidence = Number(sentence.by?.num);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence defective: by num must be between 0 and 1");
  }
  return confidence;
}

export function normalizeEvidence(sentence = {}, options = {}) {
  const normalized = normalizeClaimSentence(sentence, options);
  const evidentialName = evidenceName(normalized);
  const provenance = sourceAnchor(normalized);
  const confidence = confidenceFor(normalized);
  return {
    key: deriveClaimKey(normalized, options),
    payload: cloneValue(normalized.ob ?? { hollow: true }),
    evidential: evidentialName.replace(/-evidential$/u, ""),
    confidence,
    source: provenance.source,
    anchor: provenance.anchor,
    anchorId: provenance.anchorId,
    sentence: sentenceToPyash(normalized)
  };
}

export function evidentialName(kind) {
  const normalized = String(kind ?? "").trim().toLowerCase().replace(/-evidential$/u, "");
  return EVIDENTIAL_NAMES[normalized] ?? null;
}

function asEvidenceRecord(record) {
  if (record?.key && record?.payload !== undefined && record?.sentence) return cloneValue(record);
  return normalizeEvidence(record);
}

function recordsForKey(records, key) {
  return (Array.isArray(records) ? records : [])
    .map(asEvidenceRecord)
    .filter(record => record.key === key);
}

function compareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), "en", { numeric: false });
}

function compareRecords(left, right) {
  const anchor = compareText(left.anchorId, right.anchorId);
  if (anchor !== 0) return anchor;
  const confidenceLeft = left.confidence ?? -1;
  const confidenceRight = right.confidence ?? -1;
  if (confidenceLeft !== confidenceRight) return confidenceRight - confidenceLeft;
  return compareText(left.sentence, right.sentence);
}

function compareDuplicateRecords(left, right) {
  const confidenceLeft = left.confidence ?? -1;
  const confidenceRight = right.confidence ?? -1;
  if (confidenceLeft !== confidenceRight) return confidenceRight - confidenceLeft;
  return compareRecords(left, right);
}

function selectedPayloadRecords(records) {
  const selected = new Map();
  for (const record of records) {
    const payloadKey = valueKey(record.payload);
    const prior = selected.get(payloadKey);
    if (!prior || compareDuplicateRecords(record, prior) < 0) selected.set(payloadKey, record);
  }
  return [...selected.values()].sort((left, right) => valueKey(left.payload).localeCompare(valueKey(right.payload)));
}

export function resolveCurrentView(records, key) {
  const selected = selectedPayloadRecords(recordsForKey(records, key));
  const contested = selected.length > 1;
  return {
    view: "current",
    key,
    status: contested ? "contested" : "current",
    record: contested ? null : (selected[0] ?? null),
    records: selected
  };
}

export function resolveContestedView(records, key) {
  const selected = selectedPayloadRecords(recordsForKey(records, key));
  return {
    view: "contested",
    key,
    status: "contested",
    records: selected,
    conflict: selected.length > 1
  };
}

export function resolveProvenanceView(records, key) {
  const matching = recordsForKey(records, key).sort(compareRecords);
  return {
    view: "provenance",
    key,
    status: "provenance",
    records: matching
  };
}

export function resolveKnowledgeView(records, key, view = "current") {
  if (view === "contested") return resolveContestedView(records, key);
  if (view === "provenance") return resolveProvenanceView(records, key);
  if (view !== "current") throw new Error(`knowledge view defective: unknown view ${view}`);
  return resolveCurrentView(records, key);
}

export const resolveClaim = resolveCurrentView;
export const resolveEvidencePair = resolveCurrentView;
