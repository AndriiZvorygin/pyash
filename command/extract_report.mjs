import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { buildErrorSentence, surfaceErrorSentence } from "../program/error.mjs";
import { extractReport } from "../program/report/extract.mjs";

function readFlagValue(args, name) {
  const prefix = `${name}=`;
  const idx = args.findIndex(arg => arg === name || arg.startsWith(prefix));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return args[idx + 1] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const runId = readFlagValue(args, "--run-id") || "run";
  const outPath = readFlagValue(args, "--out");
  const runRootOverride = readFlagValue(args, "--run-root");
  const runRoot = runRootOverride ? path.resolve(runRootOverride) : process.cwd();
  let output = "";
  try {
    output = await extractReport({ runId, runRoot });
  } catch (err) {
    const errSentence = surfaceErrorSentence(buildErrorSentence({
      name: "reporter lost",
      message: err?.message ?? "reporter lost",
      from: { name: "reporter" }
    }));
    console.error(sentenceToPyash(errSentence));
    process.exit(1);
  }
  const normalized = output.endsWith("\n") ? output : `${output}\n`;
  if (outPath) {
    await fs.writeFile(path.resolve(outPath), normalized, "utf8");
  } else {
    try {
      fsSync.writeFileSync(1, normalized);
    } catch {
      await new Promise(resolve => process.stdout.write(normalized, resolve));
    }
  }
}

try {
  await main();
} catch (err) {
  const errSentence = surfaceErrorSentence(buildErrorSentence({
    name: "reporter defective",
    message: err?.message ?? "reporter defective",
    from: { name: "reporter" }
  }));
  console.error(sentenceToPyash(errSentence));
  process.exit(1);
}
