// pyash/verbs/chip.mjs
import fs from "node:fs/promises";

export default async function chip(sentence, inputs, context) {
  const filepath = sentence.from?.path;
  if (!filepath) throw new Error("chip: from.path is required");

  const fmt = sentence.by?.format || "jsonl";
  if (fmt !== "jsonl") {
    throw new Error(`chip: unsupported format "${fmt}"`);
  }

  const raw = await fs.readFile(filepath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const chips = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return { text: line };
    }
  });

  return { chips };
}
