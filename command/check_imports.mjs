#!/usr/bin/env node
// Verifies that every relative import specifier in every tracked module
// resolves to a file that exists. Run after any tree move.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A specifier is only an import when the `from` clause belongs to an
// `import`/`export` statement in code. Requiring the statement to start a
// line (or follow a statement separator) keeps a string that merely contains
// `from "./x"` — a test fixture, a message — from being read as an import.
const SPECIFIER_PATTERNS = [
  /(?:^|[;{}\n])[ \t]*(?:import|export)\b[^'";]*?\bfrom\s*(["'])([^"']+)\1/gmu,
  /(?:^|[;{}\n])[ \t]*import\s*(["'])([^"']+)\1/gmu,
  /(?:^|[=(:,\s])import\s*\(\s*(["'])([^"']+)\1\s*\)/gu
];

// The patterns are shared with the house-API check, which has to find the same
// imports in the house checkouts that import this repository's modules.
export { SPECIFIER_PATTERNS };

export function trackedModules(root = REPO) {
  return execFileSync("git", ["ls-files", "*.mjs"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

// Returns one entry per relative specifier that does not resolve.
export function findMissingImports(files, { root = REPO } = {}) {
  const missing = [];
  let checked = 0;
  for (const relative of files) {
    const full = path.isAbsolute(relative) ? relative : path.join(root, relative);
    const source = fs.readFileSync(full, "utf8");
    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[2];
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
        if (specifier.includes("${")) continue;
        checked += 1;
        const resolved = path.resolve(path.dirname(full), specifier);
        if (!fs.existsSync(resolved)) {
          missing.push(`${relative}: ${specifier} -> ${path.relative(root, resolved)}`);
        }
      }
    }
  }
  return { checked, missing };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { checked, missing } = findMissingImports(trackedModules());
  console.log(`import check: ${checked} relative specifier(s) across ${trackedModules().length} modules`);
  if (missing.length > 0) {
    console.log(`  missing (${missing.length}):`);
    for (const item of missing) console.log(`    ${item}`);
  }
  process.exitCode = missing.length > 0 ? 1 : 0;
}
