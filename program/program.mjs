// program.mjs (future helper)
import { parse } from "./understand/index.mjs";

export function buildProgram(source) {
  const rawLines = source.split("\n");
  const lines = [];
  let buffer = "";
  let inQuote = false;
  let quoteTag = null;

  for (const rawLine of rawLines) {
    const line = inQuote ? rawLine : rawLine.trim();
    if (!inQuote) {
      if (!line || line.startsWith("#")) continue;
      buffer = buffer ? `${buffer}\n${line}` : line;

      const startMatch = buffer.match(/quoted\.([^.]+)\./);
      if (startMatch) {
        const tag = startMatch[1];
        const endRegex = new RegExp(`\\.${tag}\\.quoted`);
        if (!endRegex.test(buffer)) {
          inQuote = true;
          quoteTag = tag;
          continue;
        }
      }

      lines.push(buffer);
      buffer = "";
      continue;
    }

    buffer = `${buffer}\n${line}`;
    if (quoteTag) {
      const endRegex = new RegExp(`\\.${quoteTag}\\.quoted`);
      if (endRegex.test(buffer)) {
        lines.push(buffer);
        buffer = "";
        inQuote = false;
        quoteTag = null;
      }
    }
  }

  if (buffer) lines.push(buffer);

  const sentences = lines.map(parse);
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
