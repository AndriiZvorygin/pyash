import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, getMemory } from "../memory.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../pretty.mjs";

async function main() {
  const args = process.argv.slice(2);
  const gross = args.includes("--gross");
  const full = args.includes("--full");
  const filePath = args.find(a => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: node scripts/run_pya_program.mjs [--gross] <path/to/file.pya>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  const text = await fs.readFile(resolved, "utf8");

  resetMemory();
  const sentences = splitSentences(text);

  for (const raw of sentences) {
    const line = raw.trim();
    if (!line) continue;
    const sentence = parse(line);
    await interpret(sentence);
  }

  const result = getMemory("result");

  if (full) {
    console.log("Program:");
    if (gross) {
      console.log(JSON.stringify(sentences, null, 2));
    } else {
      console.log(text.trim());
    }
    console.log("\nResult:");
  }

  if (gross) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  try {
    console.log(result ? sentenceToPyash(result) : "(no result)");
  } catch {
    console.log(result ? JSON.stringify(result, null, 2) : "(no result)");
  }
}

main();
