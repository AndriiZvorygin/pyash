#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember, dumpSandpits } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

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

function toPlainValue(node) {
  if (!node || typeof node !== "object") return node ?? null;
  if (Object.hasOwn(node, "text")) return String(node.text ?? "");
  if (Object.hasOwn(node, "num")) {
    const n = Number(node.num);
    return Number.isFinite(n) ? n : null;
  }
  if (Object.hasOwn(node, "filename")) return String(node.filename ?? "");
  if (Object.hasOwn(node, "name")) return String(node.name ?? "");
  if (Object.hasOwn(node, "map")) return toPlainValue(node.map);
  if (Array.isArray(node.series)) return node.series.map((v) => toPlainValue(v));
  if (node.map && typeof node.map === "object") return toPlainMap(node.map);
  return null;
}

function toPlainMap(mapNode) {
  const out = {};
  if (!mapNode || typeof mapNode !== "object") return out;
  for (const [key, raw] of Object.entries(mapNode)) {
    out[key] = toPlainValue(raw);
  }
  return out;
}

function buildIndex(memory) {
  const byName = {};
  for (const sentence of memory) {
    const key = String(sentence?.su?.name || "").trim();
    if (!key) continue;
    byName[key] = {
      be: sentence?.be ?? "",
      ob: toPlainValue(sentence?.ob),
      raw: sentence,
    };
  }
  return byName;
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
  const srcRaw = await fs.readFile(p, "utf8");
  const src = String(srcRaw)
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .join("\n");

  forget();
  const lines = splitSentences(src, { includeThen: true });
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const sentence = parse(line);
    await interpret(sentence);
  }

  const memory = allRemember();
  const sandpits = dumpSandpits();
  const payload = memoryOnly
    ? { memory }
    : { memory, sandpits, index: buildIndex(memory) };
  process.stdout.write(JSON.stringify(payload, null, pretty ? 2 : 0));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
