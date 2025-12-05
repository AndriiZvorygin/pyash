import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { interpret } from "../bridge/index.mjs";
import { forget, remember } from "../remember/index.mjs";
import { builtInSignatures } from "../verbs/index.mjs";
import { registerSignatureHandler } from "../bridge/signature.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

async function main() {
  const args = process.argv.slice(2);
  const gross = args.includes("--gross");
  const full = args.includes("--full");
  const filePath = args.find(a => !a.startsWith("--"));

  if (!filePath) {
    console.error("Usage: node program/cli/run_pya_program.mjs [--gross] <path/to/file.pya>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  const text = await fs.readFile(resolved, "utf8");

  forget();
  for (const sig of builtInSignatures) registerSignatureHandler(sig);
  const sentences = splitSentences(text);
  const outputs = [];

  for (const raw of sentences) {
    const line = raw.trim();
    if (!line) continue;
    const sentence = parse(line);
    const res = await interpret(sentence);
    if (sentence?.mood === "que") outputs.push(res);
  }

  const result = remember("result");

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
    console.log(JSON.stringify({ outputs, result }, null, 2));
    return;
  }

  if (outputs.length) {
    console.log("Outputs:");
    outputs.forEach(o => console.log(o ?? "(null)"));
    console.log("\nResult:");
  }

  try {
    console.log(result ? sentenceToPyash(result) : "(no result)");
  } catch {
    console.log(result ? JSON.stringify(result, null, 2) : "(no result)");
  }
}

main();
