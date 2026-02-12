import path from "node:path";
import fs from "node:fs/promises";
import { resolveWorldAgentDirectoryLicense, collectLicensedRoots } from "./agent_command_policy.mjs";

function resolveRememberedAgentName(rememberFn) {
  if (typeof rememberFn !== "function") return null;
  const fact = rememberFn("agent name");
  const raw = fact?.ob?.text ?? fact?.ob?.name ?? null;
  const value = String(raw ?? "").trim();
  return value || null;
}

function inferAgentNameFromCwd(agentCwd, worldRoot) {
  const resolvedCwd = path.resolve(String(agentCwd ?? ""));
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

export function resolveAgentPath(target, { rememberFn } = {}) {
  const raw = target ?? "";
  const agentCwd = resolveAgentCwd({ rememberFn });
  if (!agentCwd) {
    return { resolved: path.resolve(String(raw)), agentCwd: null, outside: false };
  }
  const resolved = path.isAbsolute(String(raw))
    ? path.resolve(String(raw))
    : path.resolve(agentCwd, String(raw));
  const worldRoot = rememberFn?.("world root")?.ob?.filename
    ? path.resolve(String(rememberFn("world root").ob.filename))
    : path.resolve("world");
  const agentName = resolveRememberedAgentName(rememberFn) ?? inferAgentNameFromCwd(agentCwd, worldRoot);
  if (!agentName) {
    const roots = [agentCwd];
    const outside = !roots.some((root) => {
      const relative = path.relative(root, resolved);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    return { resolved, agentCwd, outside, roots };
  }
  const policy = resolveWorldAgentDirectoryLicense({
    worldRoot,
    agentName
  });
  const writeRoots = collectLicensedRoots(policy, "write");
  const roots = writeRoots.length ? writeRoots : [agentCwd];
  const outside = !roots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return { resolved, agentCwd, outside, roots };
}

export async function ensureAgentPathDir(resolved, { agentCwd, outside } = {}) {
  if (!agentCwd || outside) return;
  await fs.mkdir(path.dirname(resolved), { recursive: true });
}
