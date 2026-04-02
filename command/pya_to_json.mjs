#!/usr/bin/env node
import path from "node:path";

import { pyaFileToJson } from "../program/library/pya_to_json.mjs";

process.stdout.on("error", (err) => {
  if (err && err.code === "EPIPE") process.exit(0);
  throw err;
});

function usage() {
  return [
    "Usage: node command/pya_to_json.mjs <path/to/file.pya> [--memory-only] [--pretty]",
    "Example: node command/pya_to_json.mjs configure/secret.pya --pretty",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes("--pretty");
  const memoryOnly = args.includes("--memory-only");
  const fileArg = args.find((x) => !x.startsWith("--"));
  if (!fileArg) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const p = path.resolve(fileArg);
  const payload = await pyaFileToJson(p, { memoryOnly });
  process.stdout.write(JSON.stringify(payload, null, pretty ? 2 : 0));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
