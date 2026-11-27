import { VliwEncodingError } from "./plus.mjs";

export function hasVectorCodelets(codelets) {
  return codelets.some((codelet) => (
    codelet?.semantic === "vector" || codelet?.semantic === "vector-literal"
  ));
}

export async function executeVectorProgram(codelets, {
  executeOneCodelet,
  decodePyashProgram,
  decodeVectorSequence
}) {
  const results = [];
  const state = new Map();
  let cursor = 0;
  while (cursor < codelets.length) {
    const semantic = codelets[cursor]?.semantic;
    if (semantic !== "vector" && semantic !== "vector-literal") {
      const start = cursor;
      while (cursor < codelets.length
        && codelets[cursor]?.semantic !== "vector"
        && codelets[cursor]?.semantic !== "vector-literal") cursor += 1;
      for (const codelet of codelets.slice(start, cursor)) {
        results.push(await executeOneCodelet(codelet, state));
      }
      continue;
    }

    if (semantic === "vector") {
      const words = [];
      while (cursor < codelets.length && codelets[cursor]?.semantic === "vector") {
        words.push(codelets[cursor++].words);
      }
      const sentences = decodePyashProgram(words);
      for (const sentence of sentences) {
        if (sentence.su?.name) state.set(sentence.su.name, structuredClone(sentence));
        results.push(sentence);
      }
      continue;
    }

    const words = [];
    do {
      const codelet = codelets[cursor++];
      if (codelet?.semantic !== "vector-literal") {
        throw new VliwEncodingError(
          "malformed-codelet",
          "vector continuation ended before its completion index"
        );
      }
      words.push(codelet.words ?? codelet);
    } while ((words.at(-1)[0] & 1) === 0 && cursor < codelets.length);
    const sentence = decodeVectorSequence(words);
    if (sentence.su?.name) state.set(sentence.su.name, structuredClone(sentence));
    results.push(sentence);
  }
  return results;
}
