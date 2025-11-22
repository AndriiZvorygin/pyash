import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, dumpMemory, dumpSandpits } from "../memory.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/read_pya_trace.mjs <path/to/file.pya>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  const text = await fs.readFile(resolved, "utf8");

  resetMemory();
  const sentences = splitSentences(text);

  for (const raw of sentences) {
    const line = raw.trim();
    if (!line) continue;

    try {
      const sentence = parse(line);
      await interpret(sentence);
    } catch (err) {
      console.error(`Error on sentence "${line}": ${err.message}`);
      process.exit(1);
    }
  }

  console.log(JSON.stringify({ memory: dumpMemory(), sandpits: dumpSandpits() }, null, 2));
}

main();
