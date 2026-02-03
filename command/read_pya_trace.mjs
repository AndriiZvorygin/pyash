import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember, dumpSandpits } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";

async function main() {
  const args = process.argv.slice(2);
  const beautiful = !args.includes("--gross");

  const filePath = args.find(a => !a.startsWith("--"));
  if (!filePath) {
    console.error("Usage: node program/cli/read_pya_trace.mjs [--gross] <path/to/file.pya>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  const text = await fs.readFile(resolved, "utf8");

  forget();
  const sentences = splitSentences(text, { includeThen: true });

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

  const mem = allRemember();
  const pits = dumpSandpits();

  if (beautiful) {
    printBeautiful(mem, pits);
  } else {
    console.log(JSON.stringify({ memory: mem, sandpits: pits }, null, 2));
  }
}

await main();

function printBeautiful(memory, sandpits) {
  const safeSentence = s => {
    try {
      return sentenceToPyash(s);
    } catch (err) {
      return JSON.stringify(s);
    }
  };

  console.log("\nBeautiful Trace");
  console.log("============");
  console.log("Memory:");
  memory.forEach((s, i) => {
    console.log(`  [${i}] ${safeSentence(s)}`);
  });

  if (sandpits.length) {
    console.log("\nSandpits:");
    sandpits.forEach((pit, idx) => {
      console.log(`  Sandpit ${idx}:`);
      pit.forEach((s, i) => {
        console.log(`    [${i}] ${safeSentence(s)}`);
      });
    });
  }
}
