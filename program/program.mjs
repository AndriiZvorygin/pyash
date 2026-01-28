// program.mjs (future helper)
import { parse } from "./understand/index.mjs";
import { splitSentencesWithLines } from "./library/sentenceSplitter.mjs";

export function buildProgram(source) {
  const entries = splitSentencesWithLines(source);
  const sentences = entries
    .map(entry => entry.text.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(parse);
  const labels = new Map();

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s.be === "topic" && s.mood === "ya" && s.su?.name) {
      if (labels.has(s.su.name)) {
        throw new Error(`Duplicate label: ${s.su.name}`);
      }
      labels.set(s.su.name, i + 1); // pc = next sentence
    }
  }

  return { sentences, labels };
}
