import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, dumpMemory, dumpSandpits } from "../memory.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../pretty.mjs";

async function main() {
  const args = process.argv.slice(2);
  const pretty = !args.includes("--gross");

  const filePath = args.find(a => !a.startsWith("--"));
  if (!filePath) {
    console.error("Usage: node scripts/read_pya_trace.mjs [--gross] <path/to/file.pya>");
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

  const mem = dumpMemory();
  const pits = dumpSandpits();

  if (pretty) {
    printPretty(mem, pits);
  } else {
    console.log(JSON.stringify({ memory: mem, sandpits: pits }, null, 2));
  }
}

main();

function printPretty(memory, sandpits) {
  const safeSentence = s => {
    try {
      return sentenceToPyash(s);
    } catch (err) {
      return JSON.stringify(s);
    }
  };

  console.log("\nPretty Trace");
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
