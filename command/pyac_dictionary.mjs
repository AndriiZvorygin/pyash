#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { buildDictionarySource } from "../program/library/dictionary/source.mjs";
import { decodePyashProgram } from "../program/library/vliw/index.mjs";
import { lookupLegacyName } from "../program/library/vliw/quotes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaryCandidates = [
  path.join(root, "rust/pyac/target/release/pyac-dictionary"),
  path.join(root, "rust/pyac/target/debug/pyac-dictionary")
];

function usageError(message) {
  return new Error(`${message}\nusage:\n  pyash dictionary volume build from <source.pya> to <volume.pyac>\n  pyash dictionary volume inspect <volume.pyac>\n  pyash dictionary volume lookup <volume.pyac> surface <language> <surface>\n  pyash dictionary volume lookup <volume.pyac> source <dataset> <release> <identifier>\n  pyash dictionary volume read <volume.pyac> key <pyash-name>\n  pyash dictionary volume benchmark <volume.pyac> surface <language> <surface> <iterations> to <record.pya>`);
}

async function executablePath() {
  for (const candidate of binaryCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // The Rust executable is built once during setup, never on command invocation.
    }
  }
  throw new Error(`pyac-dictionary executable is missing; build it once with: cargo build --release --manifest-path ${path.join(root, "rust/pyac/Cargo.toml")} --bin pyac-dictionary`);
}

function runBinary(binary, args, input) {
  const result = spawnSync(binary, args, {
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `pyac-dictionary exited ${result.status}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`pyac-dictionary returned invalid result: ${error.message}`);
  }
}

function binaryKey(name) {
  const words = String(name).trim().split(/\s+/u).filter(Boolean);
  if (!words.length) throw usageError("read requires a Pyash key");
  return words.map((word) => {
    const entry = lookupLegacyName(word);
    if (!entry?.hnuc) throw new Error(`Pyash dictionary key has no HNUC mapping: ${word}`);
    return Number.parseInt(entry.hnuc, 16).toString(16);
  }).join(",");
}

function metricRecord(result) {
  const lines = [
    "su name criterion be series def",
    `su name criterion ob text ${JSON.stringify(`startedAt=${result.startedAt}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`host=${os.hostname()}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`platform=${process.platform}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`architecture=${process.arch}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`volume=${result.path}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`executableBytes=${result.executableBytes}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`volumeBytes=${result.volumeBytes}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`codeletCount=${result.codeletCount ?? 0}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`language=${result.language}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`surface=${result.surface}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`iterations=${result.iterations}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`warmupIterations=${result.warmupIterations}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`openMs=${Number(result.openMs ?? 0).toFixed(3)}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`lookupTotalNs=${result.lookupTotalNs}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`lookupMeanNs=${result.lookupMeanNs}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`lookupsPerSecond=${result.lookupsPerSecond}`)} be text ya`,
    `su name criterion ob text ${JSON.stringify(`matchesPerIteration=${result.matchesPerIteration}`)} be text ya`,
    `su name run duration ms ob num ${Number(result.totalMs ?? 0).toFixed(3)} be number ya`,
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

export async function runPyacDictionary(args = process.argv.slice(2), { stdout = process.stdout } = {}) {
  const binary = await executablePath();
  let result;
  let benchmarkPath = null;
  if (args[0] === "build" && args[1] === "from" && args[3] === "to" && args.length === 5) {
    const sourcePath = path.resolve(args[2]);
    const volumePath = path.resolve(args[4]);
    const started = performance.now();
    const source = await fs.readFile(sourcePath, "utf8");
    const parsed = buildDictionarySource(source);
    const parsedMs = performance.now() - started;
    await fs.mkdir(path.dirname(volumePath), { recursive: true });
    result = runBinary(binary, ["build", volumePath], JSON.stringify(parsed));
    result.source = sourcePath;
    result.sourceBytes = Buffer.byteLength(source);
    result.sourceParseMs = Number(parsedMs.toFixed(3));
    result.totalMs = Number((performance.now() - started).toFixed(3));
  } else if (args[0] === "inspect" && args.length === 2) {
    result = runBinary(binary, ["inspect", path.resolve(args[1])]);
  } else if (args[0] === "lookup" && args[2] === "surface" && args.length === 5) {
    result = runBinary(binary, ["surface", path.resolve(args[1]), args[3], args[4]]);
  } else if (args[0] === "lookup" && args[2] === "source" && args.length === 6) {
    result = runBinary(binary, ["source", path.resolve(args[1]), args[3], args[4], args[5]]);
  } else if (args[0] === "read" && args[2] === "key" && args.length === 4) {
    result = runBinary(binary, ["key", path.resolve(args[1]), binaryKey(args[3])]);
    result.sentences = decodePyashProgram(result.codelets.map((codelet) => Uint16Array.from(codelet)));
    result.pyash = result.sentences.map(sentenceToPyash).join("\n");
    delete result.codelets;
  } else if (args[0] === "benchmark" && args[1] && args[2] === "surface" && args[6] === "to" && args.length === 8) {
    const volumePath = path.resolve(args[1]);
    const iterations = args[5];
    benchmarkPath = path.resolve(args[7]);
    const startedAt = new Date().toISOString();
    result = runBinary(binary, ["benchmark", volumePath, iterations, "surface", args[3], args[4]]);
    result.startedAt = startedAt;
    await fs.mkdir(path.dirname(benchmarkPath), { recursive: true });
    await fs.writeFile(benchmarkPath, metricRecord(result), "utf8");
  } else {
    throw usageError("invalid dictionary volume command");
  }
  if (benchmarkPath) result.record = benchmarkPath;
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPyacDictionary().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
