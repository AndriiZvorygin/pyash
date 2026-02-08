import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function isContinuationByte(byte) {
  return (byte & 0xc0) === 0x80;
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
  if (!fact || fact.be !== "series" || !Array.isArray(fact.ob?.series)) return null;
  return fact.ob.series;
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

function resolveWiseSlices(source, positions) {
  const slices = [];
  for (let i = 0; i < positions.length; i += 1) {
    const startIdx = positions[i].start;
    const endIdx = positions[i + 1]?.start ?? source.length;
    if (startIdx >= 0 && endIdx > startIdx) {
      slices.push(source.slice(startIdx, endIdx));
    }
  }
  return slices;
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
  const sourceText = resolveSourceText(sentence, { rememberFn });
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "wise chip defective",
      message: "wise chip defective: missing source text",
      from: { name: "wise chip" },
      raw: sentence
    });
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
  const positions = dedupePositions(resolveMarkerPositions(sourceText, markers));
  const baseSlices = resolveWiseSlices(sourceText, positions);
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
  { signatureWords: ["be", "wise", "chip", "atleast", "byte", "atmost", "byte", "by", "name", "text", "from", "text"], handler: wiseChip }
];
