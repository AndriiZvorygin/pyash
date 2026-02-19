import fsSync from "node:fs";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { splitSentences } from "./sentenceSplitter.mjs";

const MAP_SUFFIX = " directory license";
const HOUSE_SUFFIX = " house directory";
const CAPABILITY_WORDS = new Set(["read", "write", "command"]);
const cache = new Map();

function normalizeAgentName(text = "") {
  return String(text ?? "").trim().toLowerCase();
}

function normalizeCapabilityList(values = []) {
  const out = [];
  for (const raw of values) {
    const word = String(raw ?? "").trim().toLowerCase();
    if (!word || !CAPABILITY_WORDS.has(word)) continue;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

function parseCapabilityEntry(entry = {}) {
  const values = entry?.ob?.ve?.values;
  if (!Array.isArray(values)) return [];
  return normalizeCapabilityList(values);
}

function resolvePathRaw(name = "") {
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  return raw;
}

function parsePolicyText(text = "") {
  const maps = new Map();
  const houses = new Map();
  const lines = splitSentences(String(text ?? ""), { includeThen: true });
  let activeAgent = null;
  for (const rawLine of lines) {
    const trimmed = String(rawLine ?? "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "prah") {
      activeAgent = null;
      continue;
    }
    if (trimmed.startsWith("su name ") && trimmed.includes(" be map def") && trimmed.endsWith("be map def")) {
      const subject = trimmed.slice("su name ".length, trimmed.length - " be map def".length).trim();
      if (!subject.endsWith(MAP_SUFFIX)) {
        activeAgent = null;
        continue;
      }
      const agentName = normalizeAgentName(subject.slice(0, -MAP_SUFFIX.length));
      if (!agentName) {
        activeAgent = null;
        continue;
      }
      if (!maps.has(agentName)) maps.set(agentName, new Map());
      activeAgent = agentName;
      continue;
    }
    if (activeAgent) {
      let sentence;
      try {
        sentence = parse(trimmed);
      } catch {
        continue;
      }
      const dirRaw = resolvePathRaw(sentence?.su?.name);
      if (!dirRaw) continue;
      const caps = parseCapabilityEntry(sentence);
      if (!caps.length) continue;
      const entryMap = maps.get(activeAgent) ?? new Map();
      const prior = entryMap.get(dirRaw) ?? [];
      const merged = [...prior];
      for (const capability of caps) {
        if (!merged.includes(capability)) merged.push(capability);
      }
      entryMap.set(dirRaw, merged);
      maps.set(activeAgent, entryMap);
      continue;
    }

    let sentence;
    try {
      sentence = parse(trimmed);
    } catch {
      continue;
    }
    const subject = String(sentence?.su?.name ?? "").trim();
    if (!subject.endsWith(HOUSE_SUFFIX)) continue;
    const agentName = normalizeAgentName(subject.slice(0, -HOUSE_SUFFIX.length));
    const declaredPath = resolvePathRaw(sentence?.ob?.filename);
    if (!agentName || !declaredPath) continue;
    houses.set(agentName, declaredPath);
  }
  return { maps, houses };
}

function resolvePolicyMap(policyPath) {
  try {
    const stat = fsSync.statSync(policyPath);
    const cached = cache.get(policyPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.parsed;
    const text = fsSync.readFileSync(policyPath, "utf8");
    const parsed = parsePolicyText(text);
    cache.set(policyPath, { mtimeMs: stat.mtimeMs, parsed });
    return parsed;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    return null;
  }
}

function normalizePolicyPath(raw = "", { worldRoot } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (path.isAbsolute(text)) return path.resolve(text);
  const resolvedWorld = path.resolve(String(worldRoot ?? "world"));
  const repoRoot = path.dirname(resolvedWorld);
  if (text.startsWith("world/") || text.startsWith(`world${path.sep}`)) {
    return path.resolve(repoRoot, text);
  }
  return path.resolve(resolvedWorld, text);
}

function scoreHouseCandidate({ resolvedPath, agentName }) {
  const normalizedPath = String(resolvedPath ?? "").toLowerCase();
  const normalizedAgent = String(agentName ?? "").trim().toLowerCase();
  const base = path.basename(String(resolvedPath ?? "")).toLowerCase();
  if (normalizedAgent && base === normalizedAgent) return 0;
  if (normalizedPath.includes(`${path.sep}house${path.sep}`) || normalizedPath.includes("/house/")) return 1;
  return 2;
}

function deriveHousePathFromLicenseMap(scopedMap, { worldRoot, agentName } = {}) {
  if (!scopedMap || scopedMap.size === 0) return null;
  const candidates = [];
  for (const [rawPath, capabilities] of scopedMap.entries()) {
    const resolvedPath = normalizePolicyPath(rawPath, { worldRoot });
    if (!resolvedPath) continue;
    const caps = normalizeCapabilityList(capabilities);
    if (!caps.length) continue;
    candidates.push({
      path: resolvedPath,
      score: scoreHouseCandidate({ resolvedPath, agentName })
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.path.localeCompare(b.path, "en");
  });
  return candidates[0].path;
}

export function resolveWorldAgentDirectoryLicense({ worldRoot, agentName } = {}) {
  const root = String(worldRoot ?? "").trim();
  const resolvedAgent = normalizeAgentName(agentName);
  if (!root || !resolvedAgent) return null;
  const resolvedWorldRoot = path.resolve(root);
  const policyPath = path.join(resolvedWorldRoot, "conduct", "agent.pya");
  const parsed = resolvePolicyMap(policyPath);
  if (!parsed) return null;
  const maps = parsed.maps;
  const scopedMap = maps.get(resolvedAgent) ?? maps.get("default") ?? null;
  if (!scopedMap || scopedMap.size === 0) {
    return {
      sourcePath: policyPath,
      entries: []
    };
  }
  const entries = [];
  for (const [rawPath, capabilities] of scopedMap.entries()) {
    const resolvedPath = normalizePolicyPath(rawPath, { worldRoot: resolvedWorldRoot });
    if (!resolvedPath) continue;
    const caps = normalizeCapabilityList(capabilities);
    if (!caps.length) continue;
    entries.push({
      path: resolvedPath,
      capabilities: caps
    });
  }
  return {
    sourcePath: policyPath,
    entries
  };
}

export function resolveWorldAgentHouseDirectory({
  worldRoot,
  agentName,
  includeFallback = true
} = {}) {
  const root = String(worldRoot ?? "").trim();
  const resolvedAgent = normalizeAgentName(agentName);
  if (!root || !resolvedAgent) return null;
  const resolvedWorldRoot = path.resolve(root);
  const policyPath = path.join(resolvedWorldRoot, "conduct", "agent.pya");
  const parsed = resolvePolicyMap(policyPath);
  const declaredPath = parsed?.houses?.get(resolvedAgent);
  if (declaredPath) {
    return normalizePolicyPath(declaredPath, { worldRoot: resolvedWorldRoot });
  }
  const scopedMap = parsed?.maps?.get(resolvedAgent) ?? null;
  const derivedFromLicense = deriveHousePathFromLicenseMap(scopedMap, {
    worldRoot: resolvedWorldRoot,
    agentName: resolvedAgent
  });
  if (derivedFromLicense) return derivedFromLicense;
  if (!includeFallback) return null;
  return path.join(resolvedWorldRoot, "house", String(agentName ?? "").trim());
}

export function listWorldDeclaredAgentHouses({ worldRoot } = {}) {
  const root = String(worldRoot ?? "").trim();
  if (!root) return [];
  const resolvedWorldRoot = path.resolve(root);
  const policyPath = path.join(resolvedWorldRoot, "conduct", "agent.pya");
  const parsed = resolvePolicyMap(policyPath);
  const out = [];
  const names = new Set([
    ...Array.from(parsed?.houses?.keys?.() ?? []),
    ...Array.from(parsed?.maps?.keys?.() ?? [])
  ]);
  for (const agentName of names) {
    const rawPath = parsed?.houses?.get(agentName) ?? null;
    const resolvedPath = rawPath
      ? normalizePolicyPath(rawPath, { worldRoot: resolvedWorldRoot })
      : deriveHousePathFromLicenseMap(parsed?.maps?.get(agentName), {
        worldRoot: resolvedWorldRoot,
        agentName
      });
    if (!resolvedPath) continue;
    out.push({
      agentName,
      path: resolvedPath,
      sourcePath: policyPath
    });
  }
  return out.sort((a, b) => a.agentName.localeCompare(b.agentName, "en"));
}

export function collectLicensedRoots(license = null, capability = "write") {
  if (!license || !Array.isArray(license.entries)) return [];
  const needed = String(capability ?? "").trim().toLowerCase();
  if (!needed) return [];
  const out = [];
  for (const entry of license.entries) {
    if (!entry || !Array.isArray(entry.capabilities)) continue;
    if (!entry.capabilities.includes(needed)) continue;
    const resolved = path.resolve(String(entry.path ?? ""));
    if (!resolved) continue;
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}
