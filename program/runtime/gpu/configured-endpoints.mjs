import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPyaTextValues } from "../../../command/pya_lookup.mjs";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function text(value) {
  return String(value ?? "").trim();
}

function addCandidate(candidates, seen, filePath) {
  const normalized = text(filePath);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push(normalized);
}

function ancestorDirectories(startPath) {
  const out = [];
  let cursor = path.resolve(text(startPath) || process.cwd());
  while (true) {
    out.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return out;
}

/**
 * Return configuration files from the most specific house outward. A house
 * secret overrides its defaults, which in turn override the Pyash defaults.
 * Explicit paths are accepted for tests and callers with a known config root.
 */
export function configuredPyaPaths({ cwd = process.cwd(), configPaths = [], includeSecret = true } = {}) {
  const candidates = [];
  const seen = new Set();
  for (const filePath of Array.isArray(configPaths) ? configPaths : []) {
    addCandidate(candidates, seen, filePath);
  }
  for (const directory of ancestorDirectories(cwd)) {
    if (includeSecret) addCandidate(candidates, seen, path.join(directory, "configure", "secret.pya"));
    addCandidate(candidates, seen, path.join(directory, "configure", "default.pya"));
  }
  const rootConfigure = path.join(MODULE_ROOT, "configure");
  if (includeSecret) addCandidate(candidates, seen, path.join(rootConfigure, "secret.pya"));
  addCandidate(candidates, seen, path.join(rootConfigure, "default.pya"));
  return candidates.filter((filePath) => fs.existsSync(filePath));
}

export function resolveConfiguredText(name, options = {}) {
  const wanted = text(name);
  if (!wanted) return "";
  for (const filePath of configuredPyaPaths(options)) {
    const values = readPyaTextValues(filePath, [wanted]);
    const value = text(values[wanted]);
    if (value) return value;
  }
  return "";
}

export function resolveConfiguredGpuHousekeeperUrl(options = {}) {
  return resolveConfiguredText("gpu housekeeper url", options).replace(/\/+$/u, "");
}

export function resolveDefaultGpuHousekeeperUrl(options = {}) {
  return resolveConfiguredGpuHousekeeperUrl({ ...options, includeSecret: false });
}
