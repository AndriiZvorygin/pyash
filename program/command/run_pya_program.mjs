import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { interpret } from "../bridge/index.mjs";
import { forget, remember } from "../remember/index.mjs";
import { builtInSignatures } from "../verbs/index.mjs";
import { signatures as compileSignatures } from "../verbs/exchange/compile.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../bridge/signature.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { setEntryModulePath } from "../bridge/modules.mjs";

async function main() {
  const args = process.argv.slice(2);
  const gross = args.includes("--gross");
  const full = args.includes("--full");
  const positional = args.filter(a => !a.startsWith("--"));
  const filePath = positional[0];

  if (!filePath) {
    console.error("Usage: node program/cli/run_pya_program.mjs [--gross] <path/to/file.pya>");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  setEntryModulePath(resolved);
  let text;
  try {
    text = await fs.readFile(resolved, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // Treat the positional args as inline Pyash when the path does not exist.
    text = positional.join(" ");
  }

  forget();
  clearSignatureHandlers();
  for (const sig of [...builtInSignatures, ...compileSignatures]) {
    registerSignatureHandler(sig);
  }
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

  // If the result is a compiled artifact with a text payload, stream it directly.
  if (result?.ob?.text) {
    console.log(result.ob.text);
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

try {
  await main();
} catch (err) {
  console.error(err?.message ?? err);
  process.exit(1);
}
