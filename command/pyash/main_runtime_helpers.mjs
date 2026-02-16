import os from "node:os";
import path from "node:path";

export function createNormalizeChannelAgentName({ sanitizeMatrixLocalpart, matrixLocalpartFromUserId }) {
  return function normalizeChannelAgentName(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return "";
    const localpart = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(text));
    if (localpart) return localpart;
    return text.replace(/^@+/, "").trim();
  };
}

export function isEphemeralRootDir(rootDir) {
  const resolved = path.resolve(String(rootDir ?? ""));
  if (!resolved) return false;
  const tmpRoot = path.resolve(os.tmpdir());
  if (!(resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`))) return false;
  const base = path.basename(resolved);
  return /^pyash-(configure|scheduler-control)-/i.test(base);
}

export function defaultAgentHouse(worldRoot, agentName) {
  return path.join(worldRoot, "house", String(agentName ?? "").trim());
}

export function createResolveConfiguredAgentHouse({ resolveWorldAgentHouseDirectory }) {
  return function resolveConfiguredAgentHouse(worldRoot, agentName) {
    return resolveWorldAgentHouseDirectory({
      worldRoot,
      agentName,
      includeFallback: true
    }) ?? defaultAgentHouse(worldRoot, agentName);
  };
}

export function createResolveConfiguredAgentHouseFromRoot({ resolveConfiguredAgentHouse }) {
  return function resolveConfiguredAgentHouseFromRoot(rootDir, agentName) {
    const worldRoot = path.join(rootDir, "world");
    return resolveConfiguredAgentHouse(worldRoot, agentName);
  };
}

export function sectionPrinter(textOut) {
  return {
    header(title) {
      textOut("");
      textOut(`[${title}]`);
    },
    why(text) {
      textOut(`Why this matters: ${text}`);
    },
    how(text) {
      textOut(`How to get it: ${text}`);
    },
    examples(text) {
      textOut(`Examples: ${text}`);
    },
    gap() {
      textOut("");
    }
  };
}
