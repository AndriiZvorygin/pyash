import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

const MAX_BYTES = 5040;
const OVERLAP_BYTES = Math.floor(MAX_BYTES / 8);

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

function adjustStart(buffer, start) {
  let index = Math.max(0, start);
  while (index < buffer.length && isContinuationByte(buffer[index])) {
    index += 1;
  }
  return index;
}

function findEnd(buffer, start) {
  const length = buffer.length;
  if (length - start <= MAX_BYTES) return length;
  const hardEnd = Math.min(start + MAX_BYTES, length);

  let end = hardEnd;
  for (let i = hardEnd - 1; i >= start; i -= 1) {
    const byte = buffer[i];
    if (byte === 0x20 || byte === 0x0a || byte === 0x09 || byte === 0x0d) {
      end = i + 1;
      break;
    }
  }

  while (end < length && isContinuationByte(buffer[end])) {
    end -= 1;
  }

  if (end <= start) {
    end = hardEnd;
    while (end < length && isContinuationByte(buffer[end])) {
      end -= 1;
    }
    if (end <= start) {
      end = Math.min(start + 1, length);
    }
  }

  return end;
}

function buildGrossChips(text) {
  const buffer = Buffer.from(String(text ?? ""), "utf8");
  const entries = [];
  const length = buffer.length;
  let start = 0;

  while (start < length) {
    start = adjustStart(buffer, start);
    if (start >= length) break;

    const end = findEnd(buffer, start);
    const slice = buffer.slice(start, end);
    const chipText = slice.toString("utf8");
    entries.push({
      mood: "ya",
      ob: { text: chipText },
      be: "text"
    });

    if (end >= length) break;
    let nextStart = end - OVERLAP_BYTES;
    if (nextStart < 0) nextStart = 0;
    if (nextStart <= start) nextStart = end;
    start = nextStart;
  }

  return entries;
}

export async function grossChip(sentence, { remember: rememberFn = remember } = {}) {
  const sourceText = resolveSourceText(sentence, { rememberFn });
  if (typeof sourceText !== "string") {
    throwErrorSentence({
      name: "gross chip defective",
      message: "gross chip defective: missing source text",
      from: { name: "gross chip" },
      raw: sentence
    });
  }

  const entries = buildGrossChips(sourceText);
  const outputName = sentence?.to?.name ?? "gross chips";
  const seriesSentence = {
    mood: "ya",
    su: { name: outputName },
    be: "series",
    ob: { series: entries }
  };
  doRemember(seriesSentence);
  return seriesSentence;
}

export default grossChip;

export const signatures = [
  { signatureWords: ["be", "gross", "chip", "from", "name", "text", "to", "name", "text"], handler: grossChip },
  { signatureWords: ["be", "gross", "chip", "from", "text", "to", "name", "text"], handler: grossChip },
  { signatureWords: ["be", "gross", "chip", "from", "name", "text"], handler: grossChip },
  { signatureWords: ["be", "gross", "chip", "from", "text"], handler: grossChip }
];
