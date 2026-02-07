import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

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
  const slices = resolveWiseSlices(sourceText, positions);
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
  { signatureWords: ["be", "wise", "chip", "by", "name", "text", "from", "text"], handler: wiseChip }
];
