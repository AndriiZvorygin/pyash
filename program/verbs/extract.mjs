import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveTextValue(slot, { rememberFn = remember } = {}) {
  if (typeof slot?.text === "string") return slot.text;
  if (typeof slot?.name === "string") {
    const fact = rememberFn(slot.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

function defect(message, raw) {
  throwErrorSentence({
    name: "extract defective",
    message,
    from: { name: "extract" },
    raw
  });
}

function resolveSourceText(sentence, rememberFn) {
  const sourceText = resolveTextValue(sentence?.from, { rememberFn });
  if (typeof sourceText !== "string") {
    defect("extract defective: missing source text", sentence);
  }
  return sourceText;
}

function resolveStartFromSince(sentence, rememberFn) {
  const startMarker = resolveTextValue(sentence?.since, { rememberFn });
  if (typeof startMarker !== "string" || !startMarker.length) {
    defect("extract defective: missing since text marker", sentence);
  }
  const sourceText = resolveSourceText(sentence, rememberFn);
  const startIndex = sourceText.indexOf(startMarker);
  if (startIndex < 0) {
    defect("extract defective: since marker not found", sentence);
  }
  return { sourceText, startMarker, startIndex };
}

function resolveStopIndex(tail, startMarker, sentence, rememberFn) {
  const stopMarker = resolveTextValue(sentence?.until, { rememberFn });
  if (typeof stopMarker !== "string" || !stopMarker.length) return -1;
  return tail.indexOf(stopMarker, startMarker.length);
}

export async function extract(sentence, { remember: rememberFn = remember } = {}) {
  const sourceText = resolveSourceText(sentence, rememberFn);

  if (sentence?.until && !sentence?.since) {
    const stopMarker = resolveTextValue(sentence.until, { rememberFn });
    if (typeof stopMarker !== "string" || !stopMarker.length) {
      defect("extract defective: missing until text marker", sentence);
    }
    const stopIndex = sourceText.indexOf(stopMarker);
    return {
      ob: { text: stopIndex < 0 ? sourceText : sourceText.slice(0, stopIndex) },
      be: "text"
    };
  }

  const { startMarker, startIndex } = resolveStartFromSince(sentence, rememberFn);
  const tail = sourceText.slice(startIndex);
  const stopIndex = resolveStopIndex(tail, startMarker, sentence, rememberFn);
  const outputText = stopIndex < 0 ? tail : tail.slice(0, stopIndex);

  return { ob: { text: outputText }, be: "text" };
}

export default extract;

export const signatures = [
  { signatureWords: ["be", "extract", "from", "text", "until", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "until", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "until", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "until", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "to", "name", "text", "until", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "to", "name", "text", "until", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "to", "name", "text", "until", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "to", "name", "text", "until", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "text", "until", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "text", "until", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "name", "text", "until", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "name", "text", "until", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "text", "until", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "text", "until", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "name", "text", "until", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "name", "text", "until", "name", "text", "to", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "text", "to", "name", "text", "until", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "text", "to", "name", "text", "until", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "name", "text", "to", "name", "text", "until", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "name", "text", "to", "name", "text", "until", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "text", "to", "name", "text", "until", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "text", "to", "name", "text", "until", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "text", "since", "name", "text", "to", "name", "text", "until", "name", "text"], handler: extract },
  { signatureWords: ["be", "extract", "from", "name", "text", "since", "name", "text", "to", "name", "text", "until", "name", "text"], handler: extract }
];
