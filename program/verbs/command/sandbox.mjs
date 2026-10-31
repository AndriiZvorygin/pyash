import fsSync from "node:fs";
import path from "node:path";
import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { resolveConfigBool, resolveConfigMapBool, resolveConfigMapSeries, resolveConfigMapNum, resolveConfigMapText, resolveConfigSeries } from "../../configure/env.mjs";
import { collectLicensedRoots, listWorldDeclaredAgentHouses, resolveWorldAgentDirectoryLicense } from "../../library/agent_command_policy.mjs";

const DEFAULT_ENV_ALLOWLIST = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "PWD",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER"
];

function normalizeRoots(roots = []) {
  const normalized = [];
  for (const root of roots) {
    const raw = String(root ?? "").trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    if (!normalized.includes(resolved)) normalized.push(resolved);
  }
  return normalized;
}

function resolveWorldRoot({ rememberFn = remember } = {}) {
  const root = rememberFn("world root")?.ob?.filename;
  if (root) return path.resolve(String(root));
  return path.resolve("world");
}

function resolveAgentName({ rememberFn = remember } = {}) {
  const raw = rememberFn("agent name")?.ob?.text
    ?? rememberFn("agent name")?.ob?.name
    ?? null;
  const value = String(raw ?? "").trim();
  return value || null;
}

function inferAgentNameFromCwd(cwd, worldRoot) {
  const resolvedCwd = path.resolve(String(cwd ?? ""));
  const declarations = listWorldDeclaredAgentHouses({ worldRoot });
  for (const declaration of declarations) {
    const housePath = path.resolve(String(declaration?.path ?? ""));
    if (!housePath) continue;
    const relative = path.relative(housePath, resolvedCwd);
    const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (!inside) continue;
    const value = String(declaration?.agentName ?? "").trim();
    if (value) return value;
  }
  const houseRoot = path.join(path.resolve(String(worldRoot ?? "world")), "house");
  const relative = path.relative(houseRoot, resolvedCwd);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [first] = relative.split(path.sep);
  const value = String(first ?? "").trim();
  return value || null;
}

function resolveAgentSandboxRoots({ rememberFn = remember } = {}) {
  const sandboxEnabled = rememberFn("agent sandbox")?.ob?.boolean === true;
  if (!sandboxEnabled) return null;
  const cwdRaw =
    rememberFn("agent cwd")?.ob?.filename
    ?? rememberFn("agent cwd")?.ob?.text
    ?? rememberFn("agent cwd")?.ob?.name
    ?? null;
  if (!cwdRaw) return null;
  const cwd = path.resolve(String(cwdRaw));
  const worldRoot = resolveWorldRoot({ rememberFn });
  const agentName = resolveAgentName({ rememberFn }) ?? inferAgentNameFromCwd(cwd, worldRoot);
  const license = agentName
    ? resolveWorldAgentDirectoryLicense({ worldRoot, agentName })
    : null;
  if (license && Array.isArray(license.entries) && license.entries.length > 0) {
    const commandRoots = collectLicensedRoots(license, "command");
    const writeRoots = collectLicensedRoots(license, "write");
    const readRoots = collectLicensedRoots(license, "read");
    const effectiveCommandRoots = commandRoots.length ? commandRoots : [];
    const effectiveWriteRoots = writeRoots.length ? writeRoots : [];
    const fallbackCwd = effectiveCommandRoots[0] ?? cwd;
    return {
      cwd: fallbackCwd,
      commandRoots: effectiveCommandRoots,
      writeRoots: effectiveWriteRoots,
      readRoots
    };
  }
  const sharedRoots = resolveConfigMapSeries("agent command configure", "shared roots", { rememberFn })
    ?? resolveConfigSeries("agent shared roots", { rememberFn })
    ?? [];
  const projectRoots = resolveConfigMapSeries("agent command configure", "project roots", { rememberFn })
    ?? resolveConfigSeries("agent project roots", { rememberFn })
    ?? [];
  const processedRoot =
    resolveConfigMapText("agent command configure", "library processed root", { rememberFn })
    ?? path.join(worldRoot, "library", "processed");
  const expanded = [cwd, ...sharedRoots, ...projectRoots, processedRoot].map((entry) => {
    const raw = String(entry ?? "").trim();
    if (!raw) return "";
    if (path.isAbsolute(raw)) return raw;
    return path.resolve(raw);
  }).filter(Boolean);
  return { cwd, commandRoots: expanded, writeRoots: expanded, readRoots: expanded };
}

function isPathWithinRoots(targetPath, roots = []) {
  const resolvedTarget = path.resolve(targetPath);
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    if (resolvedTarget === resolvedRoot) return true;
    if (resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) return true;
  }
  return false;
}

function parseAbsolutePathTokens(commandText = "") {
  const text = String(commandText ?? "");
  const tokens = [];
  for (const token of text.split(/\s+/)) {
    const cleaned = token.replace(/[;,]+$/g, "").trim();
    if (!cleaned.startsWith("/")) continue;
    tokens.push(cleaned);
  }
  return tokens;
}

export function rewriteRunRootCommandPath(commandText, { cwd, rememberFn = remember } = {}) {
  const text = String(commandText ?? "").trim();
  if (!text) return text;
  const match = text.match(/^((?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*)node\s+command\/([^\s]+)([\s\S]*)$/u);
  if (!match) return text;
  const prefix = match[1] ?? "";
  const commandFile = match[2] ?? "";
  const suffix = match[3] ?? "";
  const runRootRaw =
    rememberFn("run root")?.ob?.filename
    ?? rememberFn("run root")?.ob?.text
    ?? rememberFn("run root")?.ob?.name
    ?? rememberFn("world root")?.ob?.filename
    ?? rememberFn("world root")?.ob?.text
    ?? rememberFn("world root")?.ob?.name
    ?? "";
  let runRoot = String(runRootRaw ?? "").trim();
  if (runRoot.endsWith(`${path.sep}world`) || runRoot.endsWith("/world")) {
    runRoot = path.dirname(runRoot);
  }
  const baseCwd = path.resolve(String(cwd ?? process.cwd()));
  if (!runRoot) {
    let cursor = baseCwd;
    for (;;) {
      const probe = path.join(cursor, "command", commandFile);
      if (fsSync.existsSync(probe)) {
        runRoot = cursor;
        break;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  if (!runRoot) return text;
  const target = path.resolve(runRoot, "command", commandFile);
  const rel = path.relative(baseCwd, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return `${prefix}node ${path.posix.normalize(rel || target)}${suffix}`;
  }
  return `${prefix}node ./${path.posix.normalize(rel)}${suffix}`;
}

export function resolveSandboxSettings({ sentence, rememberFn = remember } = {}) {
  const agentDerived = resolveAgentSandboxRoots({ rememberFn });
  const configuredWritableRoots =
    resolveConfigMapSeries("sandbox configure", "writable roots", { rememberFn })
    ?? resolveConfigSeries("command sandbox writable roots", { rememberFn });
  const writableRoots = normalizeRoots(agentDerived?.writeRoots ?? configuredWritableRoots ?? [process.cwd()]);
  const commandRoots = normalizeRoots(agentDerived?.commandRoots ?? writableRoots);
  const configuredCwd =
    resolveConfigMapText("sandbox configure", "cwd", { rememberFn })
    ?? resolveConfigMapText("command configure", "sandbox cwd", { rememberFn })
    ?? process.cwd();
  const cwd = path.resolve(String(agentDerived?.cwd ?? configuredCwd ?? process.cwd()));
  const networkAllowed =
    resolveConfigMapBool("sandbox configure", "network", { rememberFn })
    ?? resolveConfigBool("command sandbox network", { rememberFn })
    ?? true;
  const timeoutMs =
    resolveConfigMapNum("sandbox configure", "timeout ms", { rememberFn })
    ?? resolveConfigMapNum("command configure", "sandbox timeout ms", { rememberFn })
    ?? 0;
  const maxOutputBytes =
    resolveConfigMapNum("sandbox configure", "max output bytes", { rememberFn })
    ?? resolveConfigMapNum("command configure", "sandbox max output bytes", { rememberFn })
    ?? 1024 * 1024;
  const envAllowlist = resolveConfigMapSeries("sandbox configure", "command env allowlist", { rememberFn })
    ?? resolveConfigMapSeries("sandbox configure", "env allowlist", { rememberFn })
    ?? resolveConfigSeries("command env allowlist", { rememberFn })
    ?? DEFAULT_ENV_ALLOWLIST;
  const runRootRaw =
    rememberFn("run root")?.ob?.filename
    ?? rememberFn("run root")?.ob?.text
    ?? rememberFn("run root")?.ob?.name
    ?? rememberFn("world root")?.ob?.filename
    ?? rememberFn("world root")?.ob?.text
    ?? rememberFn("world root")?.ob?.name
    ?? "";
  let runRoot = path.resolve(String(runRootRaw || cwd));
  if (runRoot.endsWith(`${path.sep}world`) || runRoot.endsWith("/world")) {
    runRoot = path.dirname(runRoot);
  }
  return {
    cwd,
    runRoot,
    commandRoots,
    writableRoots,
    networkAllowed,
    timeoutMs,
    maxOutputBytes,
    envAllowlist
  };
}

export function buildAllowedEnv({ allowlist = [], cwd, runRoot } = {}) {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith("PYA_")) continue;
    env[key] = process.env[key];
  }
  for (const key of allowlist) {
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      env[key] = process.env[key];
    }
  }
  if (process.env.OLLAMA_HOST) env.OLLAMA_HOST = process.env.OLLAMA_HOST;
  if (process.env.OPENAI_BASE_URL) env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
  if (process.env.AI_HOST) env.AI_HOST = process.env.AI_HOST;
  if (!env.PATH && process.env.PATH) env.PATH = process.env.PATH;
  if (!env.HOME && process.env.HOME) env.HOME = process.env.HOME;
  const resolvedRunRoot = path.resolve(String(runRoot || cwd || process.cwd()));
  if (!env.PYA_DRAW_WORKFLOW_ROOT) env.PYA_DRAW_WORKFLOW_ROOT = path.join(resolvedRunRoot, "draw");
  if (!env.PYA_SAY_WORKFLOW_ROOT) env.PYA_SAY_WORKFLOW_ROOT = path.join(resolvedRunRoot, "say");
  if (!env.PYA_HEAR_WORKFLOW_ROOT) env.PYA_HEAR_WORKFLOW_ROOT = path.join(resolvedRunRoot, "hear");
  if (!env.PYA_MUSIC_WORKFLOW_ROOT) env.PYA_MUSIC_WORKFLOW_ROOT = path.join(resolvedRunRoot, "music");
  env.PWD = cwd;
  return env;
}

export function validateSandboxWritePolicy({ sentence, commandText, commandClass, sandbox } = {}) {
  if (!Array.isArray(sandbox?.writableRoots) || sandbox.writableRoots.length === 0) {
    throwErrorSentence({
      name: "command sandbox defective",
      message: "command sandbox defective: writable roots missing",
      from: { la: sentence },
      raw: { sandbox }
    });
  }
  if (!Array.isArray(sandbox?.commandRoots) || sandbox.commandRoots.length === 0) {
    throwErrorSentence({
      name: "command permission defective",
      message: "command permission defective: command license missing",
      from: { la: sentence },
      raw: { commandRoots: sandbox?.commandRoots }
    });
  }
  if (!isPathWithinRoots(sandbox.cwd, sandbox.commandRoots)) {
    throwErrorSentence({
      name: "command sandbox defective",
      message: `command sandbox defective: cwd outside command roots (${sandbox.cwd})`,
      from: { la: sentence },
      raw: { cwd: sandbox.cwd, commandRoots: sandbox.commandRoots }
    });
  }
  if (sentence?.to?.filename) {
    const rawTarget = String(sentence.to.filename);
    const resolvedTarget = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(sandbox.cwd, rawTarget);
    if (!isPathWithinRoots(resolvedTarget, sandbox.writableRoots)) {
      throwErrorSentence({
        name: "command sandbox defective",
        message: `command sandbox defective: write target outside writable roots (${sentence.to.filename})`,
        from: { la: sentence },
        raw: { target: sentence.to.filename, resolvedTarget, writableRoots: sandbox.writableRoots }
      });
    }
  }
  if (commandClass !== "write_local" && commandClass !== "destructive") return;
  const outsideRoots = parseAbsolutePathTokens(commandText).filter((candidate) => !isPathWithinRoots(candidate, sandbox.writableRoots));
  if (outsideRoots.length === 0) return;
  throwErrorSentence({
    name: "command sandbox defective",
    message: `command sandbox defective: command path outside writable roots (${outsideRoots[0]})`,
    from: { la: sentence },
    raw: { class: commandClass, outsideRoots, writableRoots: sandbox.writableRoots }
  });
}

