#!/usr/bin/env node
// Checks the house-facing surface of this repository.
//
// The reporter houses are separate repositories that import this repository's
// `program/` and `module/` modules by relative path. That makes those modules
// a published library with no importer inside this repository, which is why a
// naive orphan scan reads them as dead code.
//
// Three things are checked:
//
//   1. every module declared in configure/house_api.pya exists here;
//   2. every module a house imports resolves to a file in this repository and
//      is declared;
//   3. the same for the published house repositories, which are cloned so the
//      contract is checked against what the houses actually contain rather
//      than against whatever checkout happens to be present.
//
// A house that imports a module this repository does not have cannot start,
// and that used to be invisible from here. The published repositories are
// declared in configure/house_api.pya so the check knows where to look.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { SPECIFIER_PATTERNS } from "./check_imports.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOUSE_DIR = "world/house";
const CLONE_DIR = path.join("artifacts", "house-repos");

// A house can reach a module of this repository two ways: a relative
// specifier that climbs out of the house folder, or a path joined onto the
// repository root that a house resolved at run time.
const ROOT_JOIN_PATTERN = /\b(?:PYASH_ROOT|pyashRoot|pyash_root)\b\s*[,)]?\s*["']((?:program|module)\/[^"']+)["']/gu;

// Reads a vector of texts from a Pyash sentence file. The lists live in a
// sentence file rather than a second format, so they are read with the
// interpreter's own parser instead of with a text scan.
function readConfigVector(root, name, file = "configure/house_api.pya") {
  const full = path.resolve(root, file);
  let source;
  try {
    source = fs.readFileSync(full, "utf8");
  } catch {
    return [];
  }
  const noComments = source.split(/\r?\n/u).filter((line) => !/^\s*#/u.test(line)).join("\n");
  const values = [];
  for (const raw of splitSentences(noComments, { includeThen: true })) {
    let sentence;
    try {
      sentence = parse(String(raw || "").trim());
    } catch {
      continue;
    }
    if (String(sentence?.su?.name || "").toLowerCase() !== String(name).toLowerCase()) continue;
    const listed = sentence?.ob?.ve?.values;
    if (Array.isArray(listed)) {
      for (const value of listed) {
        const text = String(value).trim();
        if (text) values.push(text);
      }
      continue;
    }
    const text = String(sentence?.ob?.text || "");
    for (const value of text.split(/[\s,]+/u)) {
      if (value.trim()) values.push(value.trim());
    }
  }
  return values;
}

// The modules a house may import from this repository.
export function declaredHouseModules(root = REPO) {
  return readConfigVector(root, "house_api_modules");
}

// The published house repositories, each with the address it is published at.
export function declaredHouseRepositories(root = REPO) {
  const repositories = [];
  for (const entry of readConfigVector(root, "house_api_repositories")) {
    const separator = entry.search(/\s/u);
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    const url = entry.slice(separator + 1).trim();
    if (name && url) repositories.push({ name, url });
  }
  return repositories;
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

// Every module file of a house repository.
export function repositoryFiles(dir) {
  const files = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs")) files.push(full);
    }
  };
  walk(dir);
  return files;
}

// Clones the published house repositories so their imports can be resolved.
// The clones are cached under artifacts/, which is git-ignored.
export function fetchHouseRepositories(root = REPO, { cloneDir = CLONE_DIR } = {}) {
  const base = path.resolve(root, cloneDir);
  const fetched = [];
  for (const repository of declaredHouseRepositories(root)) {
    const dir = path.join(base, repository.name);
    if (!fs.existsSync(path.join(dir, ".git"))) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      try {
        execFileSync("git", ["clone", "--depth", "1", "--quiet", repository.url, dir], {
          cwd: root,
          stdio: ["ignore", "ignore", "pipe"]
        });
      } catch (error) {
        fetched.push({ ...repository, dir: "", error: String(error?.message ?? error).split("\n")[0] });
        continue;
      }
    }
    fetched.push({ ...repository, dir });
  }
  return fetched;
}

function isHouseFacing(root, resolved) {
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..")) return "";
  if (!relative.startsWith("program/") && !relative.startsWith("module/")) return "";
  return relative;
}

// Finds what a house imports from this repository. Returns one entry per
// import, whether or not it resolves.
//
// A house file is resolved as if it sat under world/house/<name>/, because
// that is where a house repository is checked out and where its relative
// specifiers point from. baseDir is the directory the files really live in,
// virtualRoot is where they live as far as the specifiers are concerned.
export function findHouseImports(files, { root = REPO, baseDir = null, virtualRoot = null, label = "" } = {}) {
  const found = [];
  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const relative = baseDir ? path.relative(baseDir, file) : path.basename(file);
    const virtual = virtualRoot ? path.join(virtualRoot, relative) : file;
    const house = label
      || (baseDir ? path.relative(baseDir, file).split(path.sep).slice(0, 3).join("/") : path.basename(file));
    for (const pattern of SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[2];
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
        if (specifier.includes("${")) continue;
        const resolved = path.resolve(path.dirname(virtual), specifier);
        const target = isHouseFacing(root, resolved);
        if (!target) continue;
        found.push({
          house,
          file: relative,
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
        file: relative,
        specifier: `${joined[0].trim()} -> ${target}`,
        target,
        exists: fs.existsSync(path.resolve(root, target))
      });
    }
  }
  return found;
}

// The whole check: the declared surface exists, and the houses stay inside it.
export function checkHouseApi({ root = REPO, files = null, repositories = null } = {}) {
  const declared = declaredHouseModules(root);
  const declaredSet = new Set(declared);
  const missingDeclared = declared.filter((name) => !fs.existsSync(path.resolve(root, name)));

  const houseBase = path.resolve(root, HOUSE_DIR);
  const houseFilesList = files === null ? houseFiles(root) : files;
  const houseImports = findHouseImports(houseFilesList, {
    root,
    baseDir: houseBase,
    virtualRoot: houseBase,
    label: "world/house"
  });

  const fetched = repositories === null ? fetchHouseRepositories(root) : repositories;
  const repositoryImports = [];
  const unfetched = [];
  for (const repository of fetched) {
    if (!repository.dir) {
      unfetched.push(repository);
      continue;
    }
    repositoryImports.push(...findHouseImports(repositoryFiles(repository.dir), {
      root,
      baseDir: repository.dir,
      virtualRoot: path.join(houseBase, repository.name),
      label: repository.name
    }));
  }

  const allImports = [...houseImports, ...repositoryImports];
  const broken = allImports.filter((entry) => !entry.exists);
  const undeclared = allImports.filter((entry) => entry.exists && !declaredSet.has(entry.target));
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
    repositories: fetched.map((repository) => repository.name),
    unfetched,
    repositoryImports,
    broken,
    undeclared: uniqueUndeclared
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = checkHouseApi();
  console.log(`house api: ${report.declared.length} declared module(s), ${report.houseFiles} house file(s) scanned`);
  if (report.repositories.length > 0) {
    console.log(`  published house repositories: ${report.repositories.join(", ")}`);
  }
  if (report.missingDeclared.length > 0) {
    console.log(`  declared but missing (${report.missingDeclared.length}):`);
    for (const name of report.missingDeclared) console.log(`    ${name}`);
  }
  if (report.unfetched.length > 0) {
    console.log(`  published repository that could not be fetched (${report.unfetched.length}):`);
    for (const repository of report.unfetched) console.log(`    ${repository.name}: ${repository.error}`);
  }
  if (report.broken.length > 0) {
    console.log(`  house import that does not resolve (${report.broken.length}):`);
    for (const entry of report.broken) console.log(`    ${entry.house}: ${entry.file} -> ${entry.target}`);
  }
  if (report.undeclared.length > 0) {
    console.log(`  house import that is not declared (${report.undeclared.length}):`);
    for (const entry of report.undeclared) console.log(`    ${entry.target}  (${entry.house}: ${entry.file})`);
  }
  const clean = report.missingDeclared.length === 0
    && report.unfetched.length === 0
    && report.broken.length === 0
    && report.undeclared.length === 0;
  if (clean) {
    console.log("  ok: declared surface is intact and every house import resolves");
  }
  process.exitCode = clean ? 0 : 1;
}
