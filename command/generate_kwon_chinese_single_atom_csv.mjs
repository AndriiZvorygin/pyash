#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  acceptedChineseCharacterAtomRows,
  parseChineseCharacterAtomLinks
} from "../program/library/translation/chinese_character_atom_refinery.mjs";

const execFileAsync = promisify(execFile);
const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(COMMAND_DIR, "..");
const KWON_CHINESE_PATH = path.join(REPOSITORY_ROOT, "caterer", "pyac", "lyac", "kwon_zh.json");
const ACCEPTED_LINKS_PATH = path.join(REPOSITORY_ROOT, "program", "library", "translation", "chinese_character_atom_links.pya");
const UNIHAN_ARCHIVE_PATH = path.join(REPOSITORY_ROOT, "sino-pyash", "sources", "unihan-18.0.0", "Unihan.zip");
const OUTPUT_PATH = path.join(REPOSITORY_ROOT, "program", "library", "translation", "kwon_chinese_single_atoms.csv");

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`;
}

function addReading(readingsByCharacter, character, property, reading) {
  const readings = readingsByCharacter.get(character) ?? { Mandarin: new Set(), Cantonese: new Set() };
  for (const value of reading.trim().split(/\s+/u).filter(Boolean)) readings[property].add(value);
  readingsByCharacter.set(character, readings);
}

const kwonRows = JSON.parse(await fs.readFile(KWON_CHINESE_PATH, "utf8"));
if (!Array.isArray(kwonRows)) throw new Error(`Kwon Chinese vocabulary must be an array: ${KWON_CHINESE_PATH}`);
const acceptedLinks = parseChineseCharacterAtomLinks(await fs.readFile(ACCEPTED_LINKS_PATH, "utf8"));
const singleAtomRows = acceptedChineseCharacterAtomRows(kwonRows, acceptedLinks);

const { stdout: unihanReadings } = await execFileAsync("unzip", [
  "-p",
  UNIHAN_ARCHIVE_PATH,
  "Unihan_Readings.txt"
], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const readingsByCharacter = new Map();
for (const line of unihanReadings.split(/\r?\n/u)) {
  const match = line.match(/^(U\+[0-9A-F]+)\tk(Mandarin|Cantonese)\t(.+)$/u);
  if (!match) continue;
  const character = String.fromCodePoint(Number.parseInt(match[1].slice(2), 16));
  addReading(readingsByCharacter, character, match[2], match[3]);
}

const rows = singleAtomRows.flatMap((row) => {
  const chinese = String(row?.character ?? "").trim().normalize("NFC");
  const characters = [...chinese];
  const pyash = String(row?.pya ?? "").trim();
  const english = String(row?.english ?? "").trim();
  if (characters.length !== 1 || !/\p{Script=Han}/u.test(chinese) || !english || !pyash) return [];
  if (pyash.split(/\s+/u).length !== 1) return [];

  const readings = readingsByCharacter.get(chinese);
  return [{
    chinese,
    english,
    pyash,
    mandarin: [...(readings?.Mandarin ?? [])].sort().join(" | "),
    cantonese: [...(readings?.Cantonese ?? [])].sort().join(" | ")
  }];
}).sort((left, right) => left.chinese.codePointAt(0) - right.chinese.codePointAt(0)
  || left.english.localeCompare(right.english)
  || left.pyash.localeCompare(right.pyash));

const missingReadings = rows.filter((row) => !row.mandarin || !row.cantonese);
if (missingReadings.length > 0) {
  throw new Error(`Unihan readings are missing for ${missingReadings.length} Kwon single-character entries`);
}

const header = ["chinese_character", "english", "pyash_atom", "mandarin_pinyin", "cantonese_jyutping"];
const output = [header, ...rows.map((row) => [row.chinese, row.english, row.pyash, row.mandarin, row.cantonese])]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
await fs.writeFile(OUTPUT_PATH, `${output}\n`, "utf8");

const characterCount = new Set(rows.map((row) => row.chinese)).size;
process.stdout.write(`wrote ${rows.length} one-atom mappings across ${characterCount} Chinese characters to ${OUTPUT_PATH}\n`);
