import path from "node:path";

export function resolveAgentCwd({ rememberFn } = {}) {
  if (typeof rememberFn !== "function") return null;
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
  const relative = path.relative(agentCwd, resolved);
  const outside = relative.startsWith("..") || path.isAbsolute(relative);
  return { resolved, agentCwd, outside };
}
