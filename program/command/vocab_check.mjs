import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { buildProgram } from "../program.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node program/command/vocab_check.mjs <file.pya>...");
  process.exit(1);
}

const checked = new Map();

function tokenizeName(name) {
  return String(name)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function collectNames(sentence, out) {
  const roles = ["su", "ob", "to", "from", "with", "via", "by"];
  for (const role of roles) {
    const value = sentence?.[role];
    if (value?.name) {
      for (const token of tokenizeName(value.name)) out.add(token);
    }
  }
  if (sentence?.consequence) {
    collectNames(sentence.consequence, out);
  }
}

function queryRyan(token) {
  if (checked.has(token)) return checked.get(token);
  const output = execFileSync(
    "node",
    ["program/command/ryan.mjs", token],
    { encoding: "utf8" }
  );
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  checked.set(token, lines);
  return lines;
}

let missing = 0;
for (const file of files) {
  const text = await fs.readFile(file, "utf8");
  const program = buildProgram(text);
  const names = new Set();
  for (const sentence of program.sentences) {
    collectNames(sentence, names);
  }
  for (const token of names) {
    const lines = queryRyan(token);
    if (lines.length === 0) {
      missing += 1;
      console.log(`${file}: ${token} (no suggestions)`);
      continue;
    }
    if (lines.length === 1 && lines[0] === "file") {
      missing += 1;
      console.log(`${file}: ${token} (no dictionary match)`);
      continue;
    }
  }
}

if (missing > 0) {
  process.exitCode = 1;
}
