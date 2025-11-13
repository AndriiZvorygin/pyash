// program.mjs (future helper)
import { parse } from "./parser.mjs";

export function buildProgram(source) {
  const lines = source
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  const sentences = lines.map(parse);
  const labels = new Map();

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s.be === "topic" && s.mood === "ya" && s.subj?.name) {
      if (labels.has(s.subj.name)) {
        throw new Error(`Duplicate label: ${s.subj.name}`);
      }
      labels.set(s.subj.name, i + 1); // pc = next sentence
    }
  }

  return { sentences, labels };
}
