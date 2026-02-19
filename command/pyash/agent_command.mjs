import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

function stripPrefix(value, prefix) {
  return String(value ?? "").startsWith(prefix)
    ? String(value ?? "").slice(prefix.length)
    : "";
}

export function parseAgentCommandArgs(args = []) {
  const out = {
    agentName: "",
    codex: false,
    status: false,
    root: "",
    toolsMap: "agent tools",
    codexHome: "auto",
    noMcp: false,
    codexArgs: []
  };
  const rest = Array.isArray(args) ? [...args] : [];
  if (!rest.length) return out;
  out.agentName = String(rest.shift() ?? "").trim();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = String(rest[i] ?? "");
    if (!arg) continue;
    if (arg === "--") {
      out.codexArgs.push(...rest.slice(i + 1));
      break;
    }
    if (arg === "--codex") {
      out.codex = true;
      continue;
    }
    if (arg === "--status") {
      out.status = true;
      continue;
    }
    if (arg === "--no-mcp") {
      out.noMcp = true;
      continue;
    }
    if (arg === "--root") {
      out.root = String(rest[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      out.root = stripPrefix(arg, "--root=").trim();
      continue;
    }
    if (arg === "--tools-map") {
      out.toolsMap = String(rest[i + 1] ?? "").trim() || out.toolsMap;
      i += 1;
      continue;
    }
    if (arg.startsWith("--tools-map=")) {
      out.toolsMap = stripPrefix(arg, "--tools-map=").trim() || out.toolsMap;
      continue;
    }
    if (arg === "--codex-home") {
      out.codexHome = String(rest[i + 1] ?? "").trim() || out.codexHome;
      i += 1;
      continue;
    }
    if (arg.startsWith("--codex-home=")) {
      out.codexHome = stripPrefix(arg, "--codex-home=").trim() || out.codexHome;
      continue;
    }
    out.codexArgs.push(arg);
  }
  return out;
}

function codexArgsPreferAgentHome(args = []) {
  const tokens = Array.isArray(args) ? args.map((v) => String(v ?? "").trim()) : [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token === "--oss") return true;
    if (token === "--local-provider") return true;
    if (token.startsWith("-c") || token === "--config") {
      const next = token === "--config" ? String(tokens[i + 1] ?? "") : token.slice(2).trim();
      if (next.includes("model_provider=oss")) return true;
    }
  }
  return false;
}

function resolveCodexHome({ mode, codexArgs = [], agentHouse, envCodexHome = "" } = {}) {
  const normalizedMode = String(mode ?? "auto").trim().toLowerCase();
  if (normalizedMode && normalizedMode !== "auto" && normalizedMode !== "global" && normalizedMode !== "agent") {
    return path.resolve(normalizedMode);
  }
  if (normalizedMode === "agent") return path.join(agentHouse, ".codex");
  if (normalizedMode === "global") {
    const configured = String(envCodexHome ?? "").trim();
    return configured ? path.resolve(configured) : path.join(os.homedir(), ".codex");
  }
  if (codexArgsPreferAgentHome(codexArgs)) return path.join(agentHouse, ".codex");
  const configured = String(envCodexHome ?? "").trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".codex");
}

function unquoteText(value = "") {
  const text = String(value ?? "").trim();
  if (!(text.startsWith("\"") && text.endsWith("\""))) return text;
  const body = text.slice(1, -1);
  return body.replace(/\\\\/g, "\\").replace(/\\\"/g, "\"");
}

async function readLastProjectedSessionId(agentHouse) {
  const projectionPath = path.join(agentHouse, "conduct", "codex_projection.pya");
  let text = "";
  try {
    text = await fs.readFile(projectionPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
  const blockMatch = text.match(/su name codex projection be map def([\s\S]*?)\n\s*prah\b/i);
  if (!blockMatch) return "";
  const linePattern = /su name last session id\s+ob text\s+("[^"\\]*(?:\\.[^"\\]*)*")\s+ya/i;
  const match = String(blockMatch[1] ?? "").match(linePattern);
  if (!match) return "";
  return unquoteText(match[1]).trim();
}

async function readProjectionState(agentHouse) {
  const projectionPath = path.join(agentHouse, "conduct", "codex_projection.pya");
  let text = "";
  try {
    text = await fs.readFile(projectionPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
  const blockMatch = text.match(/su name codex projection be map def([\s\S]*?)\n\s*prah\b/i);
  if (!blockMatch) return {};
  const out = {};
  const linePattern = /su name (.+?)\s+ob text\s+("[^"\\]*(?:\\.[^"\\]*)*")\s+ya/g;
  for (const match of String(blockMatch[1] ?? "").matchAll(linePattern)) {
    const key = String(match[1] ?? "").trim();
    if (!key) continue;
    out[key] = unquoteText(match[2] ?? "");
  }
  return out;
}

async function readLastSessionIdFromPyashSessionFiles(agentHouse) {
  const sessionDir = path.join(agentHouse, "session");
  let entries = [];
  try {
    entries = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pya"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of files) {
    if (!name.includes("-codex_")) continue;
    const fullPath = path.join(sessionDir, name);
    let text = "";
    try {
      text = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      const match = line.match(/\baccordingto text ("[^"\\]*(?:\\.[^"\\]*)*")\b/i);
      if (!match) continue;
      const value = unquoteText(match[1]).trim();
      if (value) return value;
    }
  }
  return "";
}

async function resolveResumeArgs(agentHouse, codexArgs = []) {
  const args = Array.isArray(codexArgs) ? [...codexArgs] : [];
  if (!args.length) return args;
  if (String(args[0] ?? "").trim().toLowerCase() !== "resume") return args;
  const hasResumeTarget = args.slice(1).some((token) => {
    const text = String(token ?? "").trim();
    if (!text) return false;
    if (text === "--last") return true;
    if (text.startsWith("-")) return false;
    return true;
  });
  if (hasResumeTarget) return args;
  const fromProjection = await readLastProjectedSessionId(agentHouse);
  const fromSession = fromProjection || await readLastSessionIdFromPyashSessionFiles(agentHouse);
  if (fromSession) return ["resume", fromSession, ...args.slice(1)];
  return ["resume", "--last", ...args.slice(1)];
}

async function latestPyashCodexSessionFile(agentHouse) {
  const sessionDir = path.join(agentHouse, "session");
  let entries = [];
  try {
    entries = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
  const codexFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pya") && entry.name.includes("-codex_"))
    .map((entry) => entry.name)
    .sort();
  if (!codexFiles.length) return "";
  return path.join(sessionDir, codexFiles[codexFiles.length - 1]);
}

export function createAgentCommand({
  resolveRootDirFromArgs,
  resolveConfiguredAgentHouse,
  pathExists,
  codexCommand,
  projectCodexRunToPyash,
  installRoot,
  textOut
}) {
  return async function agentCommand(args = []) {
    const parsed = parseAgentCommandArgs(args);
    const agentName = String(parsed.agentName ?? "").trim();
    if (!agentName) {
      textOut("agent name required");
      return 1;
    }
    if (!parsed.codex) {
      textOut("unsupported agent command; use: pyash agent <name> --codex [codex args]");
      return 1;
    }

    const rootDir = parsed.root
      ? path.resolve(parsed.root)
      : await resolveRootDirFromArgs([]);
    const worldRoot = path.join(rootDir, "world");
    const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
    if (!(await pathExists(agentHouse))) {
      textOut(`agent house not found: ${agentHouse}`);
      return 1;
    }
    const codexHome = resolveCodexHome({
      mode: parsed.codexHome,
      codexArgs: parsed.codexArgs,
      agentHouse,
      envCodexHome: process.env.CODEX_HOME
    });
    if (parsed.status) {
      const projection = await readProjectionState(agentHouse);
      const latestSession = await latestPyashCodexSessionFile(agentHouse);
      textOut(`agent: ${agentName}`);
      textOut(`agent house: ${agentHouse}`);
      textOut(`codex home: ${codexHome}`);
      textOut(`tools map: ${parsed.toolsMap || "agent tools"}`);
      textOut(`last codex session id: ${String(projection["last session id"] ?? "").trim() || "(none)"}`);
      textOut(`last codex session file: ${String(projection["last session file"] ?? "").trim() || "(none)"}`);
      textOut(`last projected count: ${String(projection["last projected count"] ?? "").trim() || "(none)"}`);
      textOut(`latest pyash codex session: ${latestSession || "(none)"}`);
      return 0;
    }
    await fs.mkdir(codexHome, { recursive: true });
    const startedAtMs = Date.now();

    const resolvedCodexArgs = await resolveResumeArgs(agentHouse, parsed.codexArgs);
    const codexWrapperArgs = [
      "--root", rootDir,
      "--tools-map", parsed.toolsMap || "agent tools"
    ];
    if (parsed.noMcp) codexWrapperArgs.push("--no-mcp");
    codexWrapperArgs.push(...resolvedCodexArgs);
    const currentHome = String(process.env.CODEX_HOME ?? "").trim();
    const shouldOverrideHome = currentHome
      ? path.resolve(currentHome) !== path.resolve(codexHome)
      : path.resolve(codexHome) !== path.resolve(path.join(os.homedir(), ".codex"));
    const code = await codexCommand(codexWrapperArgs, {
      installRoot,
      cwd: agentHouse,
      envOverrides: shouldOverrideHome ? { CODEX_HOME: codexHome } : null
    });
    await projectCodexRunToPyash({
      rootDir,
      worldRoot,
      agentName,
      agentHouse,
      codexHome,
      startedAtMs
    });
    return Number(code ?? 0);
  };
}
