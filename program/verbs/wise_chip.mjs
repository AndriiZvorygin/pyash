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

function extractPairs(entry) {
  const pairs = [];
  const values = entry?.ob?.ve?.values;
  if (Array.isArray(values) && values.length >= 2) {
    for (let i = 0; i + 1 < values.length; i += 2) {
      const start = values[i];
      const end = values[i + 1];
      if (typeof start === "string" && typeof end === "string") {
        pairs.push({ start, end, chipIndex: entry?.from?.num ?? null });
      }
    }
    return pairs;
  }
  const start = entry?.ob?.text;
  const end = entry?.from?.text;
  if (typeof start === "string" && typeof end === "string") {
    pairs.push({ start, end, chipIndex: entry?.from?.num ?? null });
  }
  return pairs;
}

function resolveWiseSlices(source, pairs) {
  const slices = [];
  let cursor = 0;
  for (const pair of pairs) {
    const startIdx = source.indexOf(pair.start, cursor);
    if (startIdx === -1) continue;
    const endIdx = source.indexOf(pair.end, startIdx + pair.start.length);
    if (endIdx === -1) continue;
    const sliceEnd = endIdx + pair.end.length;
    slices.push(source.slice(startIdx, sliceEnd));
    cursor = sliceEnd;
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

  const pairs = entries.flatMap(entry => extractPairs(entry));
  const slices = resolveWiseSlices(sourceText, pairs);
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
  { signatureWords: ["be", "wise", "chip", "by", "name", "series", "from", "text"], handler: wiseChip }
];
