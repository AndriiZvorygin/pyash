import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseItineraryPya, renderItineraryPya } from "./itinerary_io.mjs";
import { splitTextPhrases } from "../program/verbs/itinerary_media.mjs";

function usage() {
  return "Usage: node command/itinerary_split_phrases.mjs <input-itinerary.pya> <output-itinerary.pya> [--max-seconds <num>]";
}

function hasSpeakableContent(text = "") {
  return /[\p{L}\p{N}]/u.test(String(text ?? ""));
}

function normalizePhraseCapitalization(text = "") {
  const value = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!value) return "";
  return value.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase());
}

function isWeakPhrase(text = "") {
  const value = String(text ?? "").trim();
  if (!value) return true;
  const words = value.split(/\s+/u).filter(Boolean);
  if (!words.length) return true;
  if (words.length > 1) return false;
  const only = words[0].toLowerCase();
  if (only.length <= 2) return true;
  return [
    "and", "or", "but", "so", "yet", "nor", "to", "of", "in", "on", "at", "by", "for", "with", "from", "as", "if", "then"
  ].includes(only);
}

function refinePhraseUnits(units = []) {
  const out = [];
  let pendingPrefix = "";
  for (const raw of Array.isArray(units) ? units : []) {
    const normalized = normalizePhraseCapitalization(raw);
    if (!normalized) continue;
    if (isWeakPhrase(normalized)) {
      const weak = normalized.toLowerCase();
      if (out.length > 0) {
        out[out.length - 1] = `${out[out.length - 1]} ${weak}`.replace(/\s+/gu, " ").trim();
      } else {
        pendingPrefix = pendingPrefix ? `${pendingPrefix} ${weak}` : weak;
      }
      continue;
    }
    const combined = pendingPrefix
      ? `${pendingPrefix} ${normalized}`.replace(/\s+/gu, " ").trim()
      : normalized;
    pendingPrefix = "";
    out.push(combined);
  }
  if (pendingPrefix && out.length > 0) {
    out[out.length - 1] = `${out[out.length - 1]} ${pendingPrefix}`.replace(/\s+/gu, " ").trim();
  }
  return out.filter(Boolean);
}

function splitPhraseByWordGroups(text = "", groups = 1) {
  const words = String(text ?? "").trim().split(/\s+/u).filter(Boolean);
  if (!words.length || groups <= 1) return [String(text ?? "").trim()].filter(Boolean);
  const out = [];
  let cursor = 0;
  for (let i = 0; i < groups; i += 1) {
    const remainingWords = words.length - cursor;
    const remainingGroups = groups - i;
    const take = Math.max(1, Math.ceil(remainingWords / remainingGroups));
    const chunk = words.slice(cursor, cursor + take).join(" ").trim();
    if (chunk) out.push(normalizePhraseCapitalization(chunk));
    cursor += take;
  }
  return out.filter(Boolean);
}

function clampTimedUnits(units = [], maxSeconds = null) {
  const clamp = Number(maxSeconds);
  if (!Number.isFinite(clamp) || clamp <= 0) return units;
  const out = [];
  for (const unit of Array.isArray(units) ? units : []) {
    const since = Number(unit?.since ?? 0);
    const until = Number(unit?.until ?? since);
    const duration = Math.max(0, until - since);
    const text = String(unit?.text ?? "").trim();
    if (!text || duration <= clamp + 1e-9) {
      out.push({ since, until, text: normalizePhraseCapitalization(text) });
      continue;
    }
    const groups = Math.max(2, Math.ceil(duration / clamp));
    const parts = splitPhraseByWordGroups(text, groups);
    if (parts.length <= 1) {
      out.push({ since, until, text: normalizePhraseCapitalization(text) });
      continue;
    }
    const slot = duration / parts.length;
    let cursor = since;
    for (let i = 0; i < parts.length; i += 1) {
      const isLast = i === parts.length - 1;
      const partSince = cursor;
      const partUntil = isLast ? until : cursor + slot;
      out.push({
        since: partSince,
        until: Math.max(partSince, partUntil),
        text: normalizePhraseCapitalization(parts[i])
      });
      cursor = partUntil;
    }
  }
  return out;
}

function splitCutIntoPhrases(cut = {}, sequenceStart = 1, { maxPhraseDurationSeconds = null } = {}) {
  const sourceText = String(cut?.obText ?? "").trim();
  const since = Number(cut?.since ?? 0);
  const until = Number(cut?.until ?? since);
  const duration = Math.max(0, until - since);
  const fallback = sourceText.replace(/\s+/gu, " ").trim();
  const phrases = refinePhraseUnits(splitTextPhrases(sourceText));
  const units = phrases.length ? phrases : (hasSpeakableContent(fallback) ? [normalizePhraseCapitalization(fallback)] : []);
  if (!units.length) return [];

  const timedUnits = [];
  const slot = units.length > 0 ? duration / units.length : 0;
  let cursor = since;
  for (let i = 0; i < units.length; i += 1) {
    const isLast = i === units.length - 1;
    const start = cursor;
    const end = isLast ? until : cursor + slot;
    timedUnits.push({
      since: Number.isFinite(start) ? start : since,
      until: Number.isFinite(end) ? Math.max(start, end) : until,
      text: units[i]
    });
    cursor = end;
  }

  const clamped = clampTimedUnits(timedUnits, maxPhraseDurationSeconds);
  const out = [];
  for (let i = 0; i < clamped.length; i += 1) {
    out.push({
      index: sequenceStart + i,
      name: `phrase-${String(sequenceStart + i).padStart(3, "0")}`,
      since: clamped[i].since,
      until: clamped[i].until,
      obText: clamped[i].text
    });
  }
  return out;
}

export function splitItineraryCutsIntoPhrases(cuts = [], { maxPhraseDurationSeconds = null } = {}) {
  const out = [];
  let seq = 1;
  for (const cut of Array.isArray(cuts) ? cuts : []) {
    const pieces = splitCutIntoPhrases(cut, seq, { maxPhraseDurationSeconds });
    if (!pieces.length) continue;
    out.push(...pieces);
    seq += pieces.length;
  }
  if (!out.length && Array.isArray(cuts) && cuts.length) {
    for (const cut of cuts) {
      const sourceText = String(cut?.obText ?? "").replace(/\s+/gu, " ").trim();
      if (!sourceText) continue;
      out.push({
        index: seq,
        name: `phrase-${String(seq).padStart(3, "0")}`,
        since: Number(cut?.since ?? 0),
        until: Number(cut?.until ?? cut?.since ?? 0),
        obText: normalizePhraseCapitalization(sourceText)
      });
      seq += 1;
    }
  }
  return out;
}

function resolveMaxSecondsFromArgs(argv = []) {
  let maxSeconds = null;
  for (let i = 4; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--max-seconds") {
      maxSeconds = Number(argv[i + 1] ?? "");
      i += 1;
    }
  }
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    const fromEnv = Number(process.env.PYA_IMAGE_MAX_PHRASE_SECONDS ?? "");
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return null;
  }
  return maxSeconds;
}

async function main() {
  const input = String(process.argv[2] ?? "").trim();
  const output = String(process.argv[3] ?? "").trim();
  const maxPhraseDurationSeconds = resolveMaxSecondsFromArgs(process.argv);
  if (!input || !output) {
    throw new Error(usage());
  }
  const text = await fs.readFile(input, "utf8");
  const parsed = parseItineraryPya(text);
  const phraseCuts = splitItineraryCutsIntoPhrases(parsed.cuts, { maxPhraseDurationSeconds });
  if (!phraseCuts.length) {
    throw new Error("phrase split defective: no speakable phrases");
  }
  const rendered = renderItineraryPya({
    itineraryName: parsed.itineraryName,
    cuts: phraseCuts
  });
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs.writeFile(output, rendered, "utf8");
  process.stdout.write(`${path.resolve(output)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(1);
  });
}
