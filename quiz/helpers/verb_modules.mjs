import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ROLE_KEYS } from "../../program/library/grammar/keywords.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const verbsRoot = path.join(repoRoot, "program", "verbs");

const roleWords = new Set(ROLE_KEYS);

// The family of a signature is its verb: the words between "be" and the
// first role word. "be cut by num ..." is the cut family, "be draw as ..." is
// the draw family, and "be android verify ..." is the android family,
// because a family is named by its first verb word.
export function familyOf(signatureWords) {
  if (!Array.isArray(signatureWords) || signatureWords[0] !== "be") return "";
  const verb = [];
  for (let index = 1; index < signatureWords.length; index += 1) {
    if (roleWords.has(signatureWords[index])) break;
    verb.push(signatureWords[index]);
  }
  return verb.join(" ").split(" ").filter(Boolean)[0] ?? "";
}

async function verbModuleFiles() {
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.name.endsWith(".mjs")) files.push(full);
    }
  }
  await walk(verbsRoot);
  return files.sort();
}

// Every module under the verb layer, with the verb families its signatures
// declare. A module that cannot be imported reports the reason instead, so a
// caller can tell a broken module from a module without signatures.
export async function verbModules() {
  const modules = [];
  for (const file of await verbModuleFiles()) {
    const relative = path.relative(verbsRoot, file);
    let loaded;
    try {
      loaded = await import(pathToFileURL(file).href);
    } catch (error) {
      modules.push({ file: relative, error: String(error?.message ?? error), families: [] });
      continue;
    }
    const signatures = loaded.signatures;
    if (!Array.isArray(signatures)) {
      modules.push({ file: relative, error: "", families: [] });
      continue;
    }
    const families = new Set();
    for (const entry of signatures) families.add(familyOf(entry?.signatureWords));
    families.delete("");
    modules.push({ file: relative, error: "", families: [...families] });
  }
  return modules;
}

// The module that is the only home for a family is the module that owns it.
// A family that several modules declare belongs to none of them: a general
// verb reaches a domain by way of the module for that domain.
export function familyOwners(modules) {
  const owners = new Map();
  for (const module of modules) {
    for (const family of module.families) {
      if (!owners.has(family)) owners.set(family, []);
      owners.get(family).push(module.file);
    }
  }
  return owners;
}
