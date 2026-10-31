#!/usr/bin/env node
// Checks the house-facing surface of this repository.
//
// The reporter houses are separate repositories that import this repository's
// `program/` and `module/` modules by relative path. That makes those modules
// a published library with no importer inside this repository, which is why a
// naive orphan scan reads them as dead code.
//
// Two things are checked:
//
//   1. every module declared in configure/house_api.pya exists here;
//   2. when a house checkout is present under world/house/, every module such
//      a house imports resolves to a file in this repository and is declared.
//
// The second check needs a house checkout, which this repository does not
// track, so it only runs where one is present. The first runs everywhere.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { SPECIFIER_PATTERNS } from "./check_imports.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOUSE_DIR = "world/house";

// A house can reach a module of this repository two ways: a relative
// specifier that climbs out of the house folder, or a path joined onto the
// repository root that a house resolved at run time.
const ROOT_JOIN_PATTERN = /\b(?:PYASH_ROOT|pyashRoot|pyash_root)\b\s*[,)]?\s*["']((?:program|module)\/[^"']+)["']/gu;

// Reads the declared surface. The list lives in a Pyash sentence file, so it
// is read with the interpreter's own parser rather than with a text scan.
export function declaredHouseModules(root = REPO, file = "configure/house_api.pya") {
  const full = path.resolve(root, file);
  let source;
  try {
    source = fs.readFileSync(full, "utf8");
  } catch {
    return [];
  }
  const noComments = source.split(/\r?\n/u).filter((line) => !/^\s*#/u.test(line)).join("\n");
  const names = [];
  for (const raw of splitSentences(noComments, { includeThen: true })) {
    let sentence;
    try {
      sentence = parse(String(raw || "").trim());
    } catch {
      continue;
    }
    if (String(sentence?.su?.name || "").toLowerCase() !== "house_api_modules") continue;
    const values = sentence?.ob?.ve?.values;
    if (Array.isArray(values)) {
      for (const value of values) {
        const name = String(value).trim();
        if (name) names.push(name);
      }
      continue;
    }
    const text = String(sentence?.ob?.text || "");
    for (const value of text.split(/[\s,]+/u)) {
      if (value.trim()) names.push(value.trim());
    }
  }
  return names;
}

// Every module file under the house folder, if the folder is present.
export function houseFiles(root = REPO) {
  const base = path.resolve(root, HOUSE_DIR);
  if (!fs.existsSync(base)) return [];
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs")) files.push(full);
    }
  };
  walk(base);
  return files;
}

function isHouseFacing(root, resolved) {
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..")) return "";
  if (!relative.startsWith("program/") && !relative.startsWith("module/")) return "";
  return relative;
}

// Finds what a house imports from this repository. Returns one entry per
// import, whether or not it resolves.
export function findHouseImports(files, { root = REPO } = {}) {
  const found = [];
  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const house = path.relative(root, file).split(path.sep).slice(0, 3).join("/");
    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[2];
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
        if (specifier.includes("${")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        const target = isHouseFacing(root, resolved);
        if (!target) continue;
        found.push({
          house,
          file: path.relative(root, file),
          specifier,
          target,
          exists: fs.existsSync(resolved)
        });
      }
    }
    ROOT_JOIN_PATTERN.lastIndex = 0;
    let joined;
    while ((joined = ROOT_JOIN_PATTERN.exec(source)) !== null) {
      const target = joined[1];
      if (!target) continue;
      found.push({
        house,
        file: path.relative(root, file),
        specifier: `${joined[0].trim()} -> ${target}`,
        target,
        exists: fs.existsSync(path.resolve(root, target))
      });
    }
  }
  return found;
}

// The whole check: the declared surface exists, and the houses stay inside it.
export function checkHouseApi({ root = REPO, files = null } = {}) {
  const declared = declaredHouseModules(root);
  const declaredSet = new Set(declared);
  const missingDeclared = declared.filter((name) => !fs.existsSync(path.resolve(root, name)));
  const houseFilesList = files === null ? houseFiles(root) : files;
  const houseImports = findHouseImports(houseFilesList, { root });
  const broken = houseImports.filter((entry) => !entry.exists);
  const undeclared = houseImports.filter((entry) => entry.exists && !declaredSet.has(entry.target));
  const seen = new Set();
  const uniqueUndeclared = undeclared.filter((entry) => {
    const key = `${entry.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    declared,
    missingDeclared,
    houseFiles: houseFilesList.length,
    houseImports,
    broken,
    undeclared: uniqueUndeclared
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = checkHouseApi();
  console.log(`house api: ${report.declared.length} declared module(s), ${report.houseFiles} house file(s) scanned`);
  if (report.missingDeclared.length > 0) {
    console.log(`  declared but missing (${report.missingDeclared.length}):`);
    for (const name of report.missingDeclared) console.log(`    ${name}`);
  }
  if (report.broken.length > 0) {
    console.log(`  house import that does not resolve (${report.broken.length}):`);
    for (const entry of report.broken) console.log(`    ${entry.house}: ${entry.file} -> ${entry.target}`);
  }
  if (report.undeclared.length > 0) {
    console.log(`  house import that is not declared (${report.undeclared.length}):`);
    for (const entry of report.undeclared) console.log(`    ${entry.target}  (${entry.house}: ${entry.file})`);
  }
  if (report.missingDeclared.length === 0 && report.broken.length === 0 && report.undeclared.length === 0) {
    console.log("  ok: declared surface is intact and every house import resolves");
  }
  process.exitCode = report.missingDeclared.length > 0 || report.broken.length > 0 || report.undeclared.length > 0 ? 1 : 0;
}
