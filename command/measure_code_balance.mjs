#!/usr/bin/env node

// Measures how the repository's lines are distributed between the interpreter
// core and the applications built on top of it, and how large the verb surface
// has grown. The numbers are recorded in documentation/state.md so drift is
// visible over time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CORE = [
  { label: "program/bridge", kind: "dir" },
  { label: "program/understand", kind: "dir" },
  { label: "program/remember", kind: "dir" },
  { label: "program/program.mjs", kind: "file" },
  { label: "program/verbs", kind: "dir" }
];

const PERIPHERY = [
  { label: "program/library", kind: "dir" },
  { label: "program/agent", kind: "dir" },
  { label: "program/runtime", kind: "dir" },
  { label: "command", kind: "dir" },
  { label: "module", kind: "dir" }
];

const SOURCE_EXTENSIONS = new Set([".mjs", ".pya"]);

function collectLines(target, kind) {
  const full = path.join(root, target);
  if (kind === "file") {
    if (!fs.existsSync(full)) return { lines: 0, files: 0, largest: [] };
    return { lines: countLines(full), files: 1, largest: [{ file: target, lines: countLines(full) }] };
  }
  if (!fs.existsSync(full)) return { lines: 0, files: 0, largest: [] };
  const largest = [];
  let lines = 0;
  let files = 0;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const size = countLines(child);
      lines += size;
      files += 1;
      largest.push({ file: path.relative(root, child), lines: size });
    }
  };
  visit(full);
  largest.sort((a, b) => b.lines - a.lines);
  return { lines, files, largest };
}

function countLines(file) {
  const text = fs.readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function summarize(group) {
  const lines = group.reduce((total, entry) => total + entry.lines, 0);
  const files = group.reduce((total, entry) => total + entry.files, 0);
  return { lines, files };
}

const coreParts = CORE.map((entry) => ({ ...entry, ...collectLines(entry.label, entry.kind) }));
const peripheryParts = PERIPHERY.map((entry) => ({ ...entry, ...collectLines(entry.label, entry.kind) }));
const core = summarize(coreParts);
const periphery = summarize(peripheryParts);
const total = core.lines + periphery.lines;

console.log("interpreter core vs applications");
console.log("");
for (const part of [...coreParts, ...peripheryParts]) {
  console.log(`  ${part.label.padEnd(24)} ${String(part.lines).padStart(7)} lines  ${String(part.files).padStart(4)} files`);
}
console.log("");
console.log(`  core        ${String(core.lines).padStart(7)} lines (${((core.lines / total) * 100).toFixed(1)}% of measured)`);
console.log(`  periphery   ${String(periphery.lines).padStart(7)} lines (${((periphery.lines / total) * 100).toFixed(1)}% of measured)`);
console.log(`  core:periphery = 1:${(periphery.lines / core.lines).toFixed(2)}`);

const verbSurface = coreParts.find((part) => part.label === "program/verbs");
const threshold = 400;
const overThreshold = verbSurface.largest.filter((entry) => entry.lines > threshold);
console.log("");
console.log(`verb surface: ${verbSurface.files} files under program/verbs, ${overThreshold.length} over ${threshold} lines`);
for (const entry of verbSurface.largest.slice(0, 10)) {
  console.log(`  ${String(entry.lines).padStart(6)}  ${entry.file}`);
}
