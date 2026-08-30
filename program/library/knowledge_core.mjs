import { sentenceToPyash } from "../beautiful.mjs";
import { resolveVerbAlias } from "./verbAliases.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EVIDENTIAL_PATTERN = /^(direct|reported|inferential)-evidential$/u;
const SOURCE_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const ANCHOR_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const EVIDENTIAL_NAMES = Object.freeze({
  direct: "direct-evidential",
  reported: "reported-evidential",
  inferential: "inferential-evidential"
});

function utf8Bytes(value) {
  const text = String(value ?? "");
  const bytes = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index++;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

export function compareUtf8Bytes(left, right) {
  const leftBytes = utf8Bytes(left);
  const rightBytes = utf8Bytes(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    if (leftBytes[index] < rightBytes[index]) return -1;
    if (leftBytes[index] > rightBytes[index]) return 1;
  }
  return leftBytes.length === rightBytes.length ? 0 : (leftBytes.length < rightBytes.length ? -1 : 1);
}

export function isEvidenceSentence(sentence = {}) {
  const name = String(sentence?.accordingto?.name ?? "").trim().toLowerCase();
  return name.endsWith("-evidential");
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf8Bytes(left, right))
      .map(([key, entry]) => [key, canonicalJson(entry)])
  );
}

function valueKey(value) {
  return JSON.stringify(canonicalJson(value));
}

function canonicalNp(value) {
  if (!value || typeof value !== "object") return value;
  const normalized = cloneValue(value);
  if (normalized.name !== undefined) normalized.name = String(normalized.name).trim().replace(/\s+/gu, " ");
  if (normalized.text !== undefined) normalized.text = String(normalized.text);
  if (normalized.wo !== undefined) normalized.wo = String(normalized.wo);
  if (normalized.filename !== undefined) normalized.filename = String(normalized.filename);
  if (normalized.genitive?.chain) {
    normalized.genitive.chain = normalized.genitive.chain.map(part => String(part).trim().replace(/\s+/gu, " "));
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
  const since = sentence.since;
  const until = sentence.until;
  const hasSince = since !== undefined;
  const hasUntil = until !== undefined;
  const hasUnsupportedStart = sentence.during !== undefined;

  if (hasUnsupportedStart || hasSince !== hasUntil) {
    throw new Error("time window defective: use both since and until dates or neither");
  }
  if (!hasSince) return { kind: "timeless", bucket: "timeless" };

  const start = canonicalDate(since, "since");
  const end = canonicalDate(until, "until");
  if (start > end) {
    throw new Error("time window defective: since date must not follow until date");
  }
  return { kind: "date", start, end, bucket: `${start}..${end}` };
}

function normalizedPredicate(value) {
  const raw = String(value ?? "").trim().replace(/\s+/gu, " ");
  if (!raw) throw new Error("claim identity defective: be predicate is required");
  return resolveVerbAlias(raw);
}

function subjectFor(sentence) {
  const subject = canonicalNp(sentence.su);
  if (!subject || typeof subject !== "object" || (subject.name === undefined && subject.text === undefined && subject.wo === undefined)) {
    throw new Error("claim identity defective: su subject is required");
  }
  return subject;
}

export function normalizeClaimSentence(sentence = {}) {
  if (!sentence || typeof sentence !== "object") {
    throw new Error("claim identity defective: sentence is required");
  }
  const normalized = cloneValue(sentence);
  normalized.su = subjectFor(sentence);
  normalized.be = normalizedPredicate(sentence.be);
  if (sentence.as !== undefined) normalized.as = canonicalNp(sentence.as);
  if (normalized.accordingto?.name !== undefined) {
    const evidential = String(normalized.accordingto.name).trim().toLowerCase();
    if (EVIDENTIAL_PATTERN.test(evidential)) normalized.accordingto.name = evidential;
  }

  const window = normalizeTimeWindow(sentence);
  if (window.kind === "timeless") {
    delete normalized.since;
    delete normalized.until;
  } else {
    delete normalized.during;
    normalized.since = { date: window.start };
    normalized.until = { date: window.end };
  }
  return normalized;
}

export function deriveClaimKey(sentence = {}) {
  const normalized = normalizeClaimSentence(sentence);
  const identity = {
    su: normalized.su,
    ...(normalized.since ? { since: normalized.since, until: normalized.until } : {}),
    ...(normalized.as !== undefined ? { as: normalized.as } : {}),
    be: normalized.be,
    mood: "ya"
  };
  return sentenceToPyash(identity);
}

export const claimKey = deriveClaimKey;
export const deriveClaimIdentity = deriveClaimKey;

function evidenceName(sentence) {
  const raw = String(sentence?.accordingto?.name ?? "").trim().toLowerCase();
  if (!EVIDENTIAL_PATTERN.test(raw)) {
    throw new Error("evidential defective: accordingto name must be direct-evidential, reported-evidential, or inferential-evidential");
  }
  return raw;
}

function sourceAnchor(sentence) {
  const sourceValue = sentence?.fromtext;
  if (sourceValue === undefined) {
    throw new Error("source anchor defective: fromtext embedded source anchor is required");
  }

  if (sourceValue && typeof sourceValue === "object" && sourceValue.source !== undefined) {
    const source = String(sourceValue.source ?? "").trim();
    const anchor = String(sourceValue.anchor ?? "").trim();
    return validateSourceAnchor(source, anchor);
  }

  if (sourceValue?.la) {
    const embedded = sourceValue.la;
    const source = String(embedded?.su?.name ?? embedded?.source?.name ?? embedded?.source?.text ?? "").trim();
    const anchor = String(embedded?.ob?.text ?? embedded?.ob?.name ?? embedded?.ob?.wo ?? embedded?.anchor?.text ?? "").trim();
    if (source || anchor) return validateSourceAnchor(source, anchor);
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
  if (sentence?.by === undefined || sentence.by?.num === undefined) {
    throw new Error("confidence defective: by num is required");
  }
  const confidence = Number(sentence.by?.num);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence defective: by num must be between 0 and 1");
  }
  return confidence;
}

export function normalizeEvidence(sentence = {}) {
  const normalized = normalizeClaimSentence(sentence);
  const evidentialName = evidenceName(normalized);
  const provenance = sourceAnchor(normalized);
  const confidence = confidenceFor(normalized);
  return {
    key: deriveClaimKey(normalized),
    payload: canonicalJson(normalized.ob ?? { hollow: true }),
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
  if (!isEvidenceSentence(record)) return null;
  return normalizeEvidence(record);
}

function recordsForKey(records, key) {
  return (Array.isArray(records) ? records : [])
    .map(asEvidenceRecord)
    .filter(record => record && record.key === key);
}

function compareText(left, right) {
  return compareUtf8Bytes(left, right);
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
  return [...selected.values()].sort((left, right) => compareUtf8Bytes(valueKey(left.payload), valueKey(right.payload)));
}

export function resolveCurrentView(records, key) {
  const selected = selectedPayloadRecords(recordsForKey(records, key));
  const contested = selected.length > 1;
  return {
    view: "current",
    key,
    status: selected.length === 0 ? "unrelated" : (contested ? "contested" : "current"),
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
