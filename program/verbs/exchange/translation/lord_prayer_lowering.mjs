import { readFile } from "node:fs/promises";

import { buildProgram } from "../../../program.mjs";

export const LORD_PRAYER_LOWERING_FORMAT = "lord-prayer-lowering-v1";
export const LORD_PRAYER_LOWERING_NAME = "translation_lord_prayer_lowering";

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-lord-prayer-lowering";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function parsePayload(sentence, index) {
  if (typeof sentence?.ob?.text !== "string") {
    throw invalid("Lord's Prayer lowering row requires a JSON text payload", { index });
  }
  try {
    return JSON.parse(sentence.ob.text);
  } catch (error) {
    throw invalid("Lord's Prayer lowering row JSON payload is malformed", { index, cause: error.message });
  }
}

function stringList(value, label, index, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array`, { index });
  const values = value.map((item) => text(item));
  if (!allowEmpty && values.length === 0) throw invalid(`${label} must be non-empty`, { index });
  if (values.some((item) => !item)) throw invalid(`${label} contains an empty item`, { index });
  return values;
}

function normalizeSequenceItem(item, index, itemIndex) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw invalid("Lord's Prayer lowering sequence item must be an object", { index, itemIndex });
  }
  const term = text(item.term);
  const pya = text(item.pya);
  if (Boolean(term) === Boolean(pya)) {
    throw invalid("Lord's Prayer lowering item requires exactly one term or pya", { index, itemIndex });
  }
  const markers = stringList(item.markers ?? [], "lowering markers", index, { allowEmpty: true });
  const take = item.take === undefined ? null : item.take;
  if (take !== null && (!Number.isInteger(take) || take < 1)) {
    throw invalid("Lord's Prayer lowering take must be a positive integer", { index, itemIndex });
  }
  if (pya && (take !== null || markers.length > 0)) {
    throw invalid("Literal Pyac lowering items cannot take or append markers", { index, itemIndex });
  }
  return {
    ...(term ? { term } : { pya }),
    ...(take === null ? {} : { take }),
    markers
  };
}

function normalizeClause(payload, locatorKey, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("Lord's Prayer lowering clause must be an object", { index });
  }
  const locator = text(payload.locator ?? locatorKey);
  const source = text(payload.source);
  if (!locator || !source || locator !== locatorKey) {
    throw invalid("Lord's Prayer lowering clause has invalid source identity", { index, locator, locatorKey });
  }
  if (!Array.isArray(payload.sequence) || payload.sequence.length === 0) {
    throw invalid("Lord's Prayer lowering clause requires a non-empty sequence", { index, locator });
  }
  return {
    locator,
    source,
    sequence: payload.sequence.map((item, itemIndex) => normalizeSequenceItem(item, index, itemIndex))
  };
}

export function parseLordPrayerLowering(source, {
  name = LORD_PRAYER_LOWERING_NAME
} = {}) {
  if (typeof source !== "string") throw invalid("Lord's Prayer lowering source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    sentence?.su?.name === name
  ));
  if (!header) throw invalid("Lord's Prayer lowering has no canonical map header");

  const metadata = new Map();
  for (const sentence of sentences) {
    if (sentence?.mood === "ya" && typeof sentence.su?.text === "string" && typeof sentence.ob?.text === "string") {
      if (sentence.su.text.startsWith("clause:")) continue;
      metadata.set(sentence.su.text, sentence.ob.text);
    }
  }
  if (metadata.get("format") !== LORD_PRAYER_LOWERING_FORMAT) {
    throw invalid("Lord's Prayer lowering has an unsupported format", { format: metadata.get("format") });
  }

  const clauses = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    const key = sentence?.su?.text;
    if (sentence?.mood !== "ya" || typeof key !== "string" || !key.startsWith("clause:")) continue;
    const locatorKey = key.slice("clause:".length);
    const clause = normalizeClause(parsePayload(sentence, index), locatorKey, index);
    if (seen.has(clause.locator)) throw invalid("Lord's Prayer lowering clause is duplicated", { index, locator: clause.locator });
    seen.add(clause.locator);
    clauses.push(clause);
  }
  if (clauses.length === 0) throw invalid("Lord's Prayer lowering has no clauses");
  return {
    format: LORD_PRAYER_LOWERING_FORMAT,
    name,
    metadata: Object.fromEntries(metadata),
    clauses
  };
}

export async function loadLordPrayerLowering({
  url = new URL("./lord_prayer_lowering.pya", import.meta.url),
  name = LORD_PRAYER_LOWERING_NAME
} = {}) {
  return parseLordPrayerLowering(await readFile(url, "utf8"), { name });
}
