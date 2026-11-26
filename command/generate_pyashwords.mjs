#!/usr/bin/env node
// Generate the atom table from the reference volume.
//
// `pyashWords.json` stores {en, hnuc, pya}. Only `en` is authored: `hnuc` and
// `pya` are inverses of each other through encodePyacWord / decodePyacWord, and
// the volume already records `en` against each canonical key. So the file is
// reconstructable, which is what removes the drift between it and the volume.
//
//   node command/generate_pyashwords.mjs           write to a scratch path and diff
//   node command/generate_pyashwords.mjs --write   replace program/library/pyashWords.json
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encodePyacWord, decodePyacWord } from "../program/library/vliw/word_code.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOLUME = path.join(root, "program/library/dictionary/reference.pyac");
const TARGET = path.join(root, "program/library/pyashWords.json");
const BINARY = path.join(root, "rust/pyac/target/release/pyac-dictionary");

/** Read the volume's atoms as {hnuc, en}. */
async function readAtoms() {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(BINARY, ["atoms", VOLUME], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `pyac-dictionary exited ${result.status}`);
  return JSON.parse(result.stdout).atoms;
}

/** Build the generated rows, asserting the spelling/identity round trip. */
export function buildRows(atoms) {
  const rows = [];
  const byHnuc = new Map();
  const byPya = new Map();
  for (const { hnuc, en } of atoms) {
    const pya = decodePyacWord(hnuc);
    // The encoder must reproduce the identity from the spelling; otherwise the
    // generated row would be a second source of truth rather than a projection.
    if (encodePyacWord(pya) !== hnuc) {
      throw new Error(`atom 0x${hnuc.toString(16)} decodes to ${pya}, which re-encodes differently`);
    }
    if (byHnuc.has(hnuc)) throw new Error(`duplicate HNUC 0x${hnuc.toString(16)}`);
    if (byPya.has(pya)) throw new Error(`duplicate spelling ${pya}`);
    byHnuc.set(hnuc, true);
    byPya.set(pya, true);
    rows.push({ en, hnuc: `0x${hnuc.toString(16).toUpperCase()}`, pya });
  }
  rows.sort((left, right) => left.en.localeCompare(right.en) || left.pya.localeCompare(right.pya));
  return rows;
}

function render(rows) {
  // Match the existing file's shape: one object per line, trailing newline.
  return `[${rows.map((row) => JSON.stringify(row).replace(/":"/gu, `":"`)
    .replace(/,"/gu, ", \"")
    .replace(/\{"/gu, `{"`)
    .replace(/\}/gu, "}")).join(",\n")}\n]\n`;
}

/** Normalise an HNUC string like "0x0908" or "0x908" to its numeric value. */
function hnucValue(value) {
  const text = String(value).trim().replace(/^0x/iu, "");
  const parsed = Number.parseInt(text, 16);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid HNUC ${value}`);
  return parsed;
}

/** Compare two row sets by HNUC and report the differences. */
export function diffRows(previous, generated) {
  const before = new Map(previous.map((row) => [hnucValue(row.hnuc), row]));
  const after = new Map(generated.map((row) => [hnucValue(row.hnuc), row]));
  const onlyBefore = [...before.keys()].filter((key) => !after.has(key))
    .map((key) => ({ hnuc: `0x${key.toString(16).toUpperCase()}`, en: before.get(key).en, pya: before.get(key).pya }));
  const onlyAfter = [...after.keys()].filter((key) => !before.has(key))
    .map((key) => ({ hnuc: `0x${key.toString(16).toUpperCase()}`, en: after.get(key).en, pya: after.get(key).pya }));
  const changed = [...after.keys()]
    .filter((key) => before.has(key) && before.get(key).pya !== after.get(key).pya)
    .map((key) => ({ hnuc: `0x${key.toString(16).toUpperCase()}`, was: before.get(key).pya, now: after.get(key).pya }));
  const renamed = [...after.keys()]
    .filter((key) => before.has(key) && before.get(key).en !== after.get(key).en)
    .map((key) => ({ hnuc: `0x${key.toString(16).toUpperCase()}`, was: before.get(key).en, now: after.get(key).en }));
  return { onlyBefore, onlyAfter, changed, renamed };
}

async function main(args) {
  const write = args.includes("--write");
  const atoms = await readAtoms();
  const rows = buildRows(atoms);
  const text = render(rows);

  let previous = [];
  try {
    previous = JSON.parse(await readFile(TARGET, "utf8"));
  } catch {
    // No existing table: nothing to compare against.
  }
  const diff = diffRows(previous, rows);

  const summary = {
    atoms: atoms.length,
    previousRows: previous.length,
    generatedRows: rows.length,
    onlyInPrevious: diff.onlyBefore.length,
    onlyInGenerated: diff.onlyAfter.length,
    respelled: diff.changed.length,
    renamed: diff.renamed.length,
    diff
  };

  if (!write) {
    const scratch = await mkdtemp(path.join(tmpdir(), "pyashwords-"));
    const target = path.join(scratch, "pyashWords.json");
    await writeFile(target, text, "utf8");
    process.stdout.write(`${JSON.stringify({ ...summary, scratch: target, written: false }, null, 2)}\n`);
    return 0;
  }

  await writeFile(TARGET, text, "utf8");
  process.stdout.write(`${JSON.stringify({ ...summary, target: TARGET, written: true }, null, 2)}\n`);
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
