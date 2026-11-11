import { createHash } from "node:crypto";

export const TRANSLATION_SENSE_STATE_FORMAT = "translation-sense-state-v1";

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

export function translationOccurrenceKey({ sourceRecordId, tokenIndex } = {}) {
  const recordId = text(sourceRecordId);
  const index = Number(tokenIndex);
  if (!recordId || !Number.isInteger(index) || index < 0) return "";
  return `${recordId}\u0000${index}`;
}

export function translationOccurrenceId({ sourceRecordId, tokenIndex, surface = "" } = {}) {
  const key = translationOccurrenceKey({ sourceRecordId, tokenIndex });
  if (!key) return "";
  const suffix = text(surface).toLowerCase();
  return `translation-occurrence-${createHash("sha256")
    .update(`${key}\u0000${suffix}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function isTranslationSenseState(value) {
  return text(value) === TRANSLATION_SENSE_STATE_FORMAT;
}
