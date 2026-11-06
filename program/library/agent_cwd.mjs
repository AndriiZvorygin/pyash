import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
  collectLicensedRoots,
  listWorldDeclaredAgentHouses,
  resolveWorldAgentDirectoryLicense
} from "./agent_command_policy.mjs";

function resolveRememberedAgentName(rememberFn) {
  if (typeof rememberFn !== "function") return null;
  const fact = rememberFn("agent name");
  const raw = fact?.ob?.text ?? fact?.ob?.name ?? null;
  const value = String(raw ?? "").trim();
  return value || null;
}

function inferAgentNameFromCwd(agentCwd, worldRoot) {
  const resolvedCwd = path.resolve(String(agentCwd ?? ""));
  const declarations = listWorldDeclaredAgentHouses({ worldRoot });
  for (const declaration of declarations) {
    const housePath = path.resolve(String(declaration?.path ?? ""));
    if (!housePath) continue;
    const relativeDeclared = path.relative(housePath, resolvedCwd);
    const insideDeclared = relativeDeclared === ""
      || (!relativeDeclared.startsWith("..") && !path.isAbsolute(relativeDeclared));
    if (!insideDeclared) continue;
    const valueDeclared = String(declaration?.agentName ?? "").trim();
    if (valueDeclared) return valueDeclared;
  }
  const houseRoot = path.join(path.resolve(String(worldRoot ?? "world")), "house");
  const relative = path.relative(houseRoot, resolvedCwd);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [first] = relative.split(path.sep);
  const value = String(first ?? "").trim();
  return value || null;
}

export function resolveAgentCwd({ rememberFn } = {}) {
  if (typeof rememberFn !== "function") return null;
  const sandbox = rememberFn("agent sandbox");
  if (sandbox?.ob?.boolean !== true) return null;
  const fact = rememberFn("agent cwd");
  const raw = fact?.ob?.filename ?? fact?.ob?.text ?? fact?.ob?.name ?? null;
  if (!raw) return null;
  return path.resolve(String(raw));
}

function isContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveAgentPath(target, { rememberFn, access = "workspace" } = {}) {
  const raw = String(target ?? "");
  const isHomeRelative = raw === "~" || raw.startsWith(`~${path.sep}`) || raw.startsWith("~/");
  const expanded = isHomeRelative
    ? (raw === "~" ? os.homedir() : path.join(os.homedir(), raw.slice(2)))
    : raw;
  const agentCwd = resolveAgentCwd({ rememberFn });
  if (!agentCwd) {
    return { resolved: path.resolve(expanded), agentCwd: null, outside: false, roots: [] };
  }

  const homeAccessFact = rememberFn?.("agent home file access")?.ob?.boolean === true;
  const homeAccessOperations = new Set(["read", "write", "list", "repair"]);
  const allowHome = homeAccessFact && homeAccessOperations.has(String(access));
  const invalidTilde = raw.startsWith("~") && !isHomeRelative;
  const explicitHomePath = isHomeRelative || (path.isAbsolute(raw) && isContained(os.homedir(), raw));
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(agentCwd, expanded);

  const worldRoot = rememberFn?.("world root")?.ob?.filename
    ? path.resolve(String(rememberFn("world root").ob.filename))
    : path.resolve("world");
  const agentName = resolveRememberedAgentName(rememberFn) ?? inferAgentNameFromCwd(agentCwd, worldRoot);
  const strictRelativePaths = rememberFn?.("agent cwd strict relative paths")?.ob?.boolean === true;
  let roots;
  if (!agentName) {
    roots = [agentCwd];
  } else {
    const policy = resolveWorldAgentDirectoryLicense({ worldRoot, agentName });
    const capability = access === "read" || access === "list" ? "read" : "write";
    const licensedRoots = collectLicensedRoots(policy, capability);
    roots = licensedRoots.length ? licensedRoots : [agentCwd];
  }
  if (strictRelativePaths && !roots.some((root) => path.resolve(root) === path.resolve(agentCwd))) {
    roots.push(agentCwd);
  }
  if (allowHome && !roots.some((root) => path.resolve(root) === path.resolve(os.homedir()))) {
    roots.push(os.homedir());
  }

  const relativeEscapesCwd = strictRelativePaths
    && !path.isAbsolute(raw)
    && !isHomeRelative
    && !isContained(agentCwd, resolved);
  const restrictedHomePath = strictRelativePaths && explicitHomePath && !allowHome && !isContained(agentCwd, resolved);
  const outside = invalidTilde
    || restrictedHomePath
    || relativeEscapesCwd
    || !roots.some((root) => isContained(root, resolved));
  return { resolved, agentCwd, outside, roots, explicitHomePath, access };
}

export async function ensureAgentPathDir(resolved, { agentCwd, outside } = {}) {
  if (!agentCwd || outside) return;
  await fs.mkdir(path.dirname(resolved), { recursive: true });
}
