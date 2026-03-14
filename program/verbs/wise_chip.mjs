import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

const BOUNDARY_SPLIT_MARKER = "\n<<<PYA_BOUNDARY>>>\n";

function isContinuationByte(byte) {
  return (byte & 0xc0) === 0x80;
}

function normalizeRichText(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\\r\\n/gu, "\n")
    .replace(/\\n/gu, "\n")
    .replace(/\\r/gu, "\n");
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function resolveSourceText(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.from?.text === "string") return sentence.from.text;
  if (typeof sentence?.from?.name === "string") {
    const fact = rememberFn(sentence.from.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function resolveBoundarySeries(sentence, { rememberFn = remember } = {}) {
  const name = sentence?.by?.name ?? sentence?.by?.text ?? sentence?.by?.wo;
  if (!name) return null;
  const fact = rememberFn(name);
  if (!fact) return null;
  if (fact.be === "series" && Array.isArray(fact.ob?.series)) return fact.ob.series;
  if (typeof fact.ob?.text === "string") {
    const normalized = normalizeRichText(fact.ob.text);
    const parts = normalized.includes(BOUNDARY_SPLIT_MARKER)
      ? normalized.split(BOUNDARY_SPLIT_MARKER)
      : normalized.split(/\r?\n/gu);
    return parts
      .map(line => line.trim())
      .filter(Boolean)
      .map(text => ({ ob: { text }, be: "text", mood: "ya" }));
  }
  return null;
}

function resolveMapPrimitive(entry, { rememberFn = remember } = {}) {
  if (!entry || typeof entry !== "object") return undefined;
  if (typeof entry.text === "string") return entry.text;
  if (typeof entry.num === "number") return entry.num;
  if (typeof entry.boolean === "boolean") return entry.boolean;
  if (typeof entry.ob?.text === "string") return entry.ob.text;
  if (typeof entry.ob?.num === "number") return entry.ob.num;
  if (typeof entry.ob?.boolean === "boolean") return entry.ob.boolean;
  if (typeof entry.name === "string") {
    const fact = rememberFn(entry.name);
    return resolveMapPrimitive(fact?.ob ?? fact ?? {}, { rememberFn });
  }
  if (typeof entry.ob?.name === "string") {
    const fact = rememberFn(entry.ob.name);
    return resolveMapPrimitive(fact?.ob ?? fact ?? {}, { rememberFn });
  }
  return undefined;
}

function resolveTextVector(entry = {}, { rememberFn = remember } = {}) {
  const vec = entry?.ve ?? entry?.ob?.ve ?? null;
  if (vec?.type === "text" && Array.isArray(vec?.values)) {
    return vec.values.map(value => String(value ?? ""));
  }
  const primitive = resolveMapPrimitive(entry, { rememberFn });
  if (typeof primitive === "string") {
    return normalizeRichText(primitive).split(/\n/gu).map(line => line.trim()).filter(Boolean);
  }
  return [];
}

function resolveWiseChipConfig(sentence, { rememberFn = remember } = {}) {
  const withName = String(sentence?.with?.name ?? "").trim();
  if (!withName) return null;
  const fact = rememberFn(withName);
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") {
    throwErrorSentence({
      name: "wise chip defective",
      message: "wise chip defective: with name map missing",
      from: { name: "wise chip" },
      raw: { withName }
    });
  }
  return map;
}

function resolveConfigTextList(map = {}, keys = [], { rememberFn = remember } = {}) {
  for (const key of keys) {
    if (!Object.hasOwn(map, key)) continue;
    const values = resolveTextVector(map[key], { rememberFn });
    if (values.length) return values;
  }
  return [];
}

function resolveConfigPrimitive(map = {}, keys = [], { rememberFn = remember } = {}) {
  if (!map || typeof map !== "object") return undefined;
  for (const key of keys) {
    if (!Object.hasOwn(map, key)) continue;
    const value = resolveMapPrimitive(map[key], { rememberFn });
    if (value !== undefined) return value;
  }
  return undefined;
}

function parsePatternSpec(spec) {
  const text = String(spec ?? "").trim();
  if (!text) return null;
  const regexMatch = text.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/u);
  if (regexMatch) {
    const [, body, flagsRaw] = regexMatch;
    const flags = Array.from(new Set(`g${flagsRaw}`.split(""))).join("");
    return { kind: "regex", regex: new RegExp(body, flags) };
  }
  return { kind: "prefix", text };
}

function collectConfiguredMatches(source, specs, type) {
  const matches = [];
  for (const spec of specs) {
    const parsed = parsePatternSpec(spec);
    if (!parsed) continue;
    if (parsed.kind === "regex") {
      for (const match of source.matchAll(parsed.regex)) {
        const marker = String(match?.[0] ?? "").trim();
        if (!marker) continue;
        matches.push({ start: Number(match.index ?? 0), marker, type });
      }
      continue;
    }
    const pattern = new RegExp(`^${escapeRegex(parsed.text)}.*$`, "gmu");
    for (const match of source.matchAll(pattern)) {
      const marker = String(match?.[0] ?? "").trim();
      if (!marker) continue;
      matches.push({ start: Number(match.index ?? 0), marker, type });
    }
  }
  return matches;
}

function dedupeTypedMatches(matches = []) {
  const out = [];
  let lastKey = null;
  for (const match of matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return String(a.type).localeCompare(String(b.type));
  })) {
    const key = `${match.start}:${match.type}:${match.marker}`;
    if (key === lastKey) continue;
    out.push(match);
    lastKey = key;
  }
  return out;
}

function buildPairWiseSlices(source, matches, { joiner = "\n\n" } = {}) {
  const blocks = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].start;
    const end = matches[i + 1]?.start ?? source.length;
    if (start < 0 || end <= start) continue;
    const text = source.slice(start, end).trim();
    if (!text) continue;
    blocks.push({ type: matches[i].type, text });
  }
  const chips = [];
  let first = "";
  let secondParts = [];
  const flush = () => {
    const lhs = String(first ?? "").trim();
    const rhs = secondParts.map(part => String(part ?? "").trim()).filter(Boolean).join(joiner);
    if (lhs && rhs) chips.push(`${lhs}${joiner}${rhs}`);
    first = "";
    secondParts = [];
  };
  for (const block of blocks) {
    if (block.type === "stop") {
      flush();
      break;
    }
    if (block.type === "drop") continue;
    if (block.type === "first") {
      flush();
      first = block.text;
      continue;
    }
    if (block.type === "second") {
      if (!first) continue;
      secondParts.push(block.text);
    }
  }
  flush();
  return chips;
}

function normalizeTimedEntry(entry, index) {
  const since = Number(entry?.since?.num ?? entry?.since ?? 0);
  const until = Number(entry?.until?.num ?? entry?.until ?? since);
  const text = String(entry?.ob?.text ?? entry?.obText ?? "").replace(/\s+/gu, " ").trim();
  return {
    index,
    since: Number.isFinite(since) ? since : 0,
    until: Number.isFinite(until) ? until : (Number.isFinite(since) ? since : 0),
    obText: text
  };
}

function resolveTimedSeries(sentence, { rememberFn = remember } = {}) {
  const name = sentence?.from?.name;
  if (!name) return null;
  const fact = rememberFn(name);
  const entries = Array.isArray(fact?.ob?.series) ? fact.ob.series : null;
  if (!entries) return null;
  if (fact?.be !== "itinerary" && fact?.be !== "series") return null;
  const rows = entries
    .map((entry, idx) => normalizeTimedEntry(entry, idx + 1))
    .filter((entry) => entry.obText && Number.isFinite(entry.since) && Number.isFinite(entry.until))
    .sort((a, b) => a.since - b.since);
  if (!rows.length) return null;
  const timed = rows.some((entry) => entry.until > entry.since || entry.since > 0);
  return timed ? rows : null;
}

function extractMarkers(entry) {
  const normalizeMarker = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const quoted = trimmed.match(/^["'`“”](.*)["'`“”]$/);
    return quoted ? quoted[1] : trimmed;
  };
  const markers = [];
  const values = entry?.ob?.ve?.values;
  if (Array.isArray(values)) {
    for (const value of values) {
      const marker = normalizeMarker(value);
      if (marker) markers.push(marker);
    }
  }
  const textMarker = normalizeMarker(entry?.ob?.text);
  if (textMarker) {
    markers.push(textMarker);
  }
  return markers;
}

function resolveMarkerPositions(source, markers) {
  const positions = [];
  let cursor = 0;
  for (const marker of markers) {
    const startIdx = source.indexOf(marker, cursor);
    if (startIdx === -1) continue;
    positions.push({ start: startIdx, marker });
    cursor = startIdx + marker.length;
  }
  return positions;
}

function dedupePositions(positions) {
  const deduped = [];
  let lastStart = -1;
  for (const pos of positions) {
    if (pos.start === lastStart) continue;
    deduped.push(pos);
    lastStart = pos.start;
  }
  return deduped;
}

function looksLikeQuestionBoundaryMarker(marker) {
  const text = String(marker ?? "").trim();
  if (!text) return false;
  if (/^(?:Questioner|Question|Q)\s*:/u.test(text)) return true;
  return /^####\s+(?!Q[’']?uo\b).+/iu.test(text);
}

function resolveWiseSlices(source, positions) {
  const slices = [];
  if (positions.length > 0 && positions[0].start > 0 && !looksLikeQuestionBoundaryMarker(positions[0].marker)) {
    slices.push(source.slice(0, positions[0].start));
  }
  for (let i = 0; i < positions.length; i += 1) {
    const startIdx = positions[i].start;
    const endIdx = positions[i + 1]?.start ?? source.length;
    if (startIdx >= 0 && endIdx > startIdx) {
      slices.push(source.slice(startIdx, endIdx));
    }
  }
  return slices;
}

function resolvePairWiseSlices(source, sentence, { rememberFn = remember } = {}) {
  const config = resolveWiseChipConfig(sentence, { rememberFn });
  if (!config) return null;
  const kind = String(resolveConfigPrimitive(config, ["kind", "mode"], { rememberFn }) ?? "").trim().toLowerCase();
  if (kind !== "pair") return null;

  const joiner = String(resolveConfigPrimitive(config, ["joiner", "pair joiner"], { rememberFn }) ?? "\n\n");
  const firstPatterns = resolveConfigTextList(config, ["first patterns", "question patterns", "left patterns"], { rememberFn });
  const secondPatterns = resolveConfigTextList(config, ["second patterns", "answer patterns", "right patterns"], { rememberFn });
  const dropPatterns = resolveConfigTextList(config, ["drop patterns", "ignore patterns"], { rememberFn });
  const stopPatterns = resolveConfigTextList(config, ["stop patterns"], { rememberFn });

  const firstMatches = firstPatterns.length
    ? collectConfiguredMatches(source, firstPatterns, "first")
    : dedupePositions(resolveMarkerPositions(source, resolveBoundarySeries(sentence, { rememberFn })?.flatMap(entry => extractMarkers(entry)) ?? []))
      .map(match => ({ ...match, type: "first" }));
  const secondMatches = collectConfiguredMatches(source, secondPatterns, "second");
  const dropMatches = collectConfiguredMatches(source, dropPatterns, "drop");
  const stopMatches = collectConfiguredMatches(source, stopPatterns, "stop");

  if (!firstMatches.length || !secondMatches.length) {
    throwErrorSentence({
      name: "wise chip defective",
      message: "wise chip defective: pair config requires first and second role markers",
      from: { name: "wise chip" },
      raw: sentence
    });
  }

  return buildPairWiseSlices(source, dedupeTypedMatches([
    ...firstMatches,
    ...secondMatches,
    ...dropMatches,
    ...stopMatches
  ]), { joiner });
}

function resolveSizeLimits(sentence) {
  const atleastRaw = sentence?.atleast?.byte ?? sentence?.atleast?.bytes ?? null;
  const atmostRaw = sentence?.atmost?.byte ?? sentence?.atmost?.bytes ?? null;
  const atleastBytes = Number.isFinite(atleastRaw) && atleastRaw > 0 ? Math.trunc(atleastRaw) : null;
  const atmostBytes = Number.isFinite(atmostRaw) && atmostRaw > 0 ? Math.trunc(atmostRaw) : null;
  if (atleastBytes && atmostBytes && atleastBytes > atmostBytes) {
    throwErrorSentence({
      name: "wise chip defective",
      message: "wise chip defective: atleast byte must be <= atmost byte",
      from: { name: "wise chip" },
      raw: sentence
    });
  }
  return { atleastBytes, atmostBytes };
}

function resolveDurationSeconds(slot = {}) {
  const second = Number(slot?.second);
  if (Number.isFinite(second) && second > 0) return second;
  const minute = Number(slot?.minute);
  if (Number.isFinite(minute) && minute > 0) return minute * 60;
  return null;
}

function resolveTimeLimits(sentence) {
  const atleastSeconds = resolveDurationSeconds(sentence?.atleast ?? {});
  const atmostSeconds = resolveDurationSeconds(sentence?.atmost ?? {});
  if (atleastSeconds && atmostSeconds && atleastSeconds > atmostSeconds) {
    throwErrorSentence({
      name: "wise chip defective",
      message: "wise chip defective: atleast time must be <= atmost time",
      from: { name: "wise chip" },
      raw: sentence
    });
  }
  return { atleastSeconds, atmostSeconds };
}

function chipFromTimedRows(rows, idx) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    index: idx,
    since: Number(first?.since ?? 0),
    until: Number(last?.until ?? Number(first?.since ?? 0)),
    text: rows.map((row) => row.obText).join(" ").replace(/\s+/gu, " ").trim()
  };
}

function durationOfRows(rows) {
  if (!rows.length) return 0;
  return Math.max(0, Number(rows[rows.length - 1]?.until ?? 0) - Number(rows[0]?.since ?? 0));
}

function gapBeforeRow(rows, splitIndex) {
  if (splitIndex <= 0 || splitIndex >= rows.length) return 0;
  return Math.max(0, Number(rows[splitIndex]?.since ?? 0) - Number(rows[splitIndex - 1]?.until ?? 0));
}

function chooseForcedSplitIndex(rows, { atleastSeconds, atmostSeconds }) {
  if (rows.length <= 1) return 1;
  let best = null;
  for (let i = 1; i < rows.length; i += 1) {
    const left = rows.slice(0, i);
    const leftDuration = durationOfRows(left);
    const gap = gapBeforeRow(rows, i);
    const withinLower = atleastSeconds == null || leftDuration >= atleastSeconds;
    const withinUpper = atmostSeconds == null || leftDuration <= atmostSeconds;
    const penalty = atleastSeconds == null ? 0 : Math.abs(leftDuration - atleastSeconds);
    const candidate = {
      index: i,
      valid: withinLower && withinUpper,
      gap,
      penalty
    };
    if (!best) {
      best = candidate;
      continue;
    }
    if (candidate.valid && !best.valid) {
      best = candidate;
      continue;
    }
    if (candidate.valid === best.valid) {
      if (candidate.gap > best.gap + 1e-6) {
        best = candidate;
        continue;
      }
      if (Math.abs(candidate.gap - best.gap) <= 1e-6 && candidate.penalty < best.penalty - 1e-6) {
        best = candidate;
      }
    }
  }
  return best?.index ?? Math.max(1, rows.length - 1);
}

function buildTimedChips(rows, { atleastSeconds, atmostSeconds }) {
  const minSeconds = Number.isFinite(atleastSeconds) ? atleastSeconds : 0;
  const maxSeconds = Number.isFinite(atmostSeconds) ? atmostSeconds : Number.POSITIVE_INFINITY;
  const pauseSplitSeconds = 2;
  const chips = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    chips.push(chipFromTimedRows(current, chips.length + 1));
    current = [];
  };

  for (const row of rows) {
    if (current.length > 0) {
      const prev = current[current.length - 1];
      const currentDuration = durationOfRows(current);
      const gap = Math.max(0, Number(row.since) - Number(prev?.until ?? row.since));
      if (currentDuration >= minSeconds && gap >= pauseSplitSeconds) {
        flush();
      }
    }
    current.push(row);
    while (current.length > 1 && durationOfRows(current) > maxSeconds) {
      const splitIndex = chooseForcedSplitIndex(current, { atleastSeconds: minSeconds, atmostSeconds: maxSeconds });
      chips.push(chipFromTimedRows(current.slice(0, splitIndex), chips.length + 1));
      current = current.slice(splitIndex);
    }
  }

  flush();
  if (chips.length > 1 && minSeconds > 0) {
    const last = chips[chips.length - 1];
    const lastDuration = Math.max(0, Number(last.until) - Number(last.since));
    if (lastDuration < minSeconds) {
      const prev = chips[chips.length - 2];
      const mergedDuration = Math.max(0, Number(last.until) - Number(prev.since));
      const boundaryGap = Math.max(0, Number(last.since) - Number(prev.until));
      if ((!Number.isFinite(maxSeconds) || mergedDuration <= maxSeconds * 1.2) && boundaryGap < pauseSplitSeconds) {
        prev.until = last.until;
        prev.text = `${prev.text} ${last.text}`.replace(/\s+/gu, " ").trim();
        chips.pop();
      }
    }
  }
  return chips.map((chip, idx) => ({ ...chip, index: idx + 1 }));
}

function findSplitEnd(buffer, start, maxBytes, minBytes) {
  const length = buffer.length;
  const hardEnd = Math.min(start + maxBytes, length);
  if (hardEnd >= length) return length;

  const minEnd = Math.min(start + Math.max(1, minBytes ?? 1), hardEnd);
  let split = -1;
  for (let i = hardEnd - 1; i >= minEnd; i -= 1) {
    const byte = buffer[i];
    if (byte === 0x20 || byte === 0x0a || byte === 0x09 || byte === 0x0d) {
      split = i + 1;
      break;
    }
  }
  if (split === -1) split = hardEnd;
  while (split > start && split < length && isContinuationByte(buffer[split])) {
    split -= 1;
  }
  if (split <= start) split = hardEnd;
  while (split > start && split < length && isContinuationByte(buffer[split])) {
    split -= 1;
  }
  if (split <= start) split = Math.min(start + 1, length);
  return split;
}

function splitByMaxBytes(text, { atmostBytes, atleastBytes }) {
  if (!atmostBytes) return [text];
  const buffer = Buffer.from(String(text ?? ""), "utf8");
  const pieces = [];
  let start = 0;
  while (start < buffer.length) {
    while (start < buffer.length && isContinuationByte(buffer[start])) start += 1;
    if (start >= buffer.length) break;
    const remaining = buffer.length - start;
    if (remaining <= atmostBytes) {
      pieces.push(buffer.slice(start).toString("utf8"));
      break;
    }
    const end = findSplitEnd(buffer, start, atmostBytes, atleastBytes);
    pieces.push(buffer.slice(start, end).toString("utf8"));
    start = end;
  }
  return pieces;
}

function mergeByMinBytes(slices, atleastBytes) {
  if (!atleastBytes || slices.length <= 1) return slices;
  const out = [];
  for (const slice of slices) {
    if (out.length === 0) {
      out.push(slice);
      continue;
    }
    const last = out[out.length - 1];
    if (Buffer.byteLength(last, "utf8") < atleastBytes) {
      out[out.length - 1] = `${last}${slice}`;
    } else {
      out.push(slice);
    }
  }
  if (out.length > 1) {
    const last = out[out.length - 1];
    if (Buffer.byteLength(last, "utf8") < atleastBytes) {
      out[out.length - 2] = `${out[out.length - 2]}${last}`;
      out.pop();
    }
  }
  return out;
}

export async function wiseChip(sentence, { remember: rememberFn = remember } = {}) {
  const { atleastSeconds, atmostSeconds } = resolveTimeLimits(sentence);
  const timedRows = resolveTimedSeries(sentence, { rememberFn });
  if (timedRows && (atleastSeconds != null || atmostSeconds != null) && !sentence?.by) {
    const chips = buildTimedChips(timedRows, { atleastSeconds, atmostSeconds });
    const outputName = sentence?.to?.name ?? "wise chips";
    const seriesEntries = chips.map((chip) => ({
      mood: "ya",
      su: { name: `wise chip ${String(chip.index).padStart(3, "0")}` },
      since: { num: chip.since },
      until: { num: chip.until },
      ob: { text: chip.text }
    }));
    const seriesSentence = {
      mood: "ya",
      su: { name: outputName },
      be: "series",
      ob: { series: seriesEntries }
    };
    doRemember(seriesSentence);
    return seriesSentence;
  }

  const sourceText = resolveSourceText(sentence, { rememberFn });
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "wise chip defective",
      message: "wise chip defective: missing source text",
      from: { name: "wise chip" },
      raw: sentence
    });
  }
  const normalizedSourceText = normalizeRichText(sourceText);

  const pairSlices = resolvePairWiseSlices(normalizedSourceText, sentence, { rememberFn });
  if (pairSlices) {
    const seriesEntries = pairSlices.map(text => ({
      mood: "ya",
      ob: { text },
      be: "text"
    }));
    const outputName = sentence?.to?.name ?? "wise chips";
    const seriesSentence = {
      mood: "ya",
      su: { name: outputName },
      be: "series",
      ob: { series: seriesEntries }
    };
    doRemember(seriesSentence);
    return seriesSentence;
  }

  const entries = resolveBoundarySeries(sentence, { rememberFn });
  if (!entries) {
    throwErrorSentence({
      name: "wise chip defective",
      message: "wise chip defective: missing boundary proposals series (use by name <series>)",
      from: { name: "wise chip" },
      raw: sentence
    });
  }

  const markers = entries.flatMap(entry => extractMarkers(entry));
  const positions = dedupePositions(resolveMarkerPositions(normalizedSourceText, markers));
  const baseSlices = resolveWiseSlices(normalizedSourceText, positions);
  const { atleastBytes, atmostBytes } = resolveSizeLimits(sentence);
  const splitSlices = baseSlices.flatMap(slice => splitByMaxBytes(slice, { atmostBytes, atleastBytes }));
  const slices = mergeByMinBytes(splitSlices, atleastBytes);
  const seriesEntries = slices.map(text => ({
    mood: "ya",
    ob: { text },
    be: "text"
  }));

  const outputName = sentence?.to?.name ?? "wise chips";
  const seriesSentence = {
    mood: "ya",
    su: { name: outputName },
    be: "series",
    ob: { series: seriesEntries }
  };
  doRemember(seriesSentence);
  return seriesSentence;
}

export default wiseChip;

export const signatures = [
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "with", "name", "map", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "with", "name", "map", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "series", "with", "name", "map", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "series", "with", "name", "map", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "series", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "series", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "with", "name", "map", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "with", "name", "map", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "to", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "to", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "series", "from", "name", "text", "to", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "series", "from", "text", "to", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "text", "from", "name", "text", "to", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "text", "from", "text", "to", "name", "text", "with", "name", "map"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "series", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "series", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "series"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "series"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "series", "from", "name", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "series", "from", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "series", "from", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "series", "from", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "text", "from", "name", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "text", "from", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "text", "from", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "by", "name", "text", "from", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "atmost", "byte", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "atmost", "byte"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "atleast", "byte", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "atleast", "byte"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "atleast", "byte", "atmost", "byte", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "name", "text", "by", "name", "text", "atleast", "byte", "atmost", "byte"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "atmost", "byte", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "atmost", "byte"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "atleast", "byte", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "atleast", "byte"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "atleast", "byte", "atmost", "byte", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "from", "text", "by", "name", "text", "atleast", "byte", "atmost", "byte"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atmost", "byte", "by", "name", "series", "from", "name", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atmost", "byte", "by", "name", "series", "from", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atmost", "byte", "by", "name", "series", "from", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atmost", "byte", "by", "name", "series", "from", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "by", "name", "series", "from", "name", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "by", "name", "series", "from", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "by", "name", "series", "from", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "by", "name", "series", "from", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "atmost", "byte", "by", "name", "text", "from", "name", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "atmost", "byte", "by", "name", "text", "from", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "atmost", "byte", "by", "name", "text", "from", "text", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "atmost", "byte", "by", "name", "text", "from", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "second", "atmost", "second", "from", "name", "itinerary", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "second", "atmost", "minute", "from", "name", "itinerary", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "minute", "atmost", "second", "from", "name", "itinerary", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "minute", "atmost", "minute", "from", "name", "itinerary", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "second", "atmost", "second", "from", "name", "series", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "second", "atmost", "minute", "from", "name", "series", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "minute", "atmost", "second", "from", "name", "series", "to", "name", "text"], handler: wiseChip },
  { signatureWords: ["be", "wise", "chip", "atleast", "minute", "atmost", "minute", "from", "name", "series", "to", "name", "text"], handler: wiseChip }
];
