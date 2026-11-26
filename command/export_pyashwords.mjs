#!/usr/bin/env node
// Export the whole reference dictionary into the flat table lowering reads.
//
// `reference.pyac` is the canonical vocabulary. This projects it into
// `pyashWords.json`, which is a derived artifact: every entry, atoms and
// compounds alike, with the spellings and English forms the volume records.
// Lowering then consults one table instead of juggling several.
//
//   node command/export_pyashwords.mjs            report what would change
//   node command/export_pyashwords.mjs --write    write pyashWords.json
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encodePyacWord, decodePyacWord } from "../program/library/vliw/word_code.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOLUME = path.join(root, "program/library/dictionary/reference.pyac");
const TARGET = path.join(root, "program/library/pyashWords.json");
const BINARY = path.join(root, "rust/pyac/target/release/pyac-dictionary");

/** Every key in the volume with its English forms. */
function readExport() {
  const result = spawnSync(BINARY, ["export", VOLUME], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `pyac-dictionary exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

/** Turn one exported entry into table rows: one per (spelling, english) pair. */
export function rowsForEntry(key, words) {
  const spelling = key.map((word) => decodePyacWord(word)).join(" ");
  // Verify the identity round trip before trusting the projection.
  const reencoded = key.length === 1
    ? encodePyacWord(decodePyacWord(key[0]))
    : null;
  if (key.length === 1 && reencoded !== key[0]) {
    throw new Error(`atom ${spelling} does not round-trip: 0x${key[0].toString(16)}`);
  }
  const hnuc = key.map((word) => `0x${word.toString(16).toUpperCase()}`);
  const forms = words.length ? words : [""];
  return forms.map((en) => ({
    en,
    hnuc: key.length === 1 ? hnuc[0] : hnuc[0],
    pya: spelling
  }));
}

/** Build the whole table, deduplicated on (en, pya). */
export function buildTable(entries) {
  const seen = new Set();
  const rows = [];
  for (const entry of entries) {
    for (const row of rowsForEntry(entry.key, entry.words)) {
      const identity = `${row.en}\u0000${row.pya}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push(row);
    }
  }
  rows.sort((left, right) => left.en.localeCompare(right.en) || left.pya.localeCompare(right.pya));
  return rows;
}

async function main(args) {
  const write = args.includes("--write");
  const exported = readExport();
  const rows = buildTable(exported.entries);

  let previous = [];
  try {
    previous = JSON.parse(await readFile(TARGET, "utf8"));
  } catch {
    // No existing table to compare against.
  }

  const summary = {
    volumeEntries: exported.count,
    volumeAtoms: exported.atoms,
    rows: rows.length,
    previousRows: previous.length,
    written: write
  };

  if (write) {
    const text = `[${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
    await writeFile(TARGET, text, "utf8");
    summary.target = TARGET;
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
