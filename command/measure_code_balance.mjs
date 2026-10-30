#!/usr/bin/env node

// Measures how the repository's lines are distributed, and how large the verb
// surface has grown. The numbers are recorded in documentation/state.md so
// drift is visible over time.
//
// Three buckets, because they answer different questions:
//
//   interpreter core  the language machinery: parser, bridge, memory, program
//   verb layer        program/verbs: the dispatch surface users write against
//   applications      library, agent, runtime, command, module
//
// The core:applications ratio says whether the language is still the centre of
// the repo. The verb-layer gauge says whether verbs stay thin, which is what
// documentation/pyash.md asks for.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CORE = ["program/bridge", "program/understand", "program/remember"];
const VERBS = ["program/verbs"];
const APPLICATIONS = ["program/library", "program/agent", "program/runtime", "command", "module"];

const VERB_LINE_THRESHOLD = 400;
const SOURCE_EXTENSIONS = new Set([".mjs", ".pya"]);

function countLines(file) {
  const text = fs.readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function collect(target) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return { lines: 0, files: 0, largest: [] };
  if (fs.statSync(full).isFile()) {
    const lines = countLines(full);
    return { lines, files: 1, largest: [{ file: target, lines }] };
  }
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

function bucket(labels) {
  const parts = labels.map((label) => ({ label, ...collect(label) }));
  return {
    parts,
    lines: parts.reduce((total, part) => total + part.lines, 0),
    files: parts.reduce((total, part) => total + part.files, 0)
  };
}

const core = bucket(CORE);
const verbs = bucket(VERBS);
const applications = bucket(APPLICATIONS);
const measured = core.lines + verbs.lines + applications.lines;

console.log("repository line distribution");
console.log("");
for (const part of [...core.parts, ...verbs.parts, ...applications.parts]) {
  console.log(`  ${part.label.padEnd(24)} ${String(part.lines).padStart(7)} lines  ${String(part.files).padStart(4)} files`);
}
console.log("");
console.log(`  interpreter core  ${String(core.lines).padStart(7)} lines  ${core.files} files`);
console.log(`  verb layer        ${String(verbs.lines).padStart(7)} lines  ${verbs.files} files`);
console.log(`  applications      ${String(applications.lines).padStart(7)} lines  ${applications.files} files`);
console.log("");
console.log(`  core:applications = 1:${(applications.lines / core.lines).toFixed(2)}`);
console.log(`  core share of measured = ${((core.lines / measured) * 100).toFixed(1)}%`);

const verbFiles = verbs.parts.flatMap((part) => part.largest);
const overThreshold = verbFiles.filter((entry) => entry.lines > VERB_LINE_THRESHOLD);
console.log("");
console.log(`verb surface: ${verbFiles.length} modules under program/verbs, ${overThreshold.length} over ${VERB_LINE_THRESHOLD} lines`);
for (const entry of verbFiles.slice(0, 10)) {
  console.log(`  ${String(entry.lines).padStart(6)}  ${entry.file}`);
}
