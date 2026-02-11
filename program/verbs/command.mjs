import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import {
  resolveConfigBool,
  resolveConfigMapBool,
  resolveConfigMapSeries,
  resolveConfigMapNum,
  resolveConfigMapText,
  resolveConfigSeries,
  resolveConfigText
} from "../configure/env.mjs";
import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { makeStream } from "../library/runtimePrimitives.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";

function resolveCommandText(ob = {}, { rememberFn } = {}) {
  if (typeof ob.wo === "string") return ob.wo;
  return renderSayValue(ob, { rememberFn });
}

function canRunDirect(cmd) {
  if (typeof cmd !== "string") return false;
  return !/[|&;<>()$`\\]/.test(cmd) && !/["']/.test(cmd);
}

function splitCommand(cmd) {
  return String(cmd).trim().split(/\s+/).filter(Boolean);
}

function resolveDirectProgram(programName) {
  const name = String(programName ?? "").trim();
  if (!name) return name;
  if (name === "node" && process.execPath) return process.execPath;
  return name;
}

function isExecutablePath(filename) {
  try {
    return fsSync.existsSync(filename) && fsSync.statSync(filename).isFile();
  } catch {
    return false;
  }
}

function resolveExecutableFromPath(name) {
  const envPath = String(process.env.PATH ?? "");
  const dirs = envPath.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (isExecutablePath(candidate)) return candidate;
  }
  return null;
}

function resolveShellCommand() {
  const configured = String(process.env.SHELL ?? "").trim();
  const candidates = [];
  if (configured) candidates.push(configured);
  if (configured && configured.includes(path.sep)) {
    const base = path.basename(configured);
    if (base) candidates.push(base);
  }
  candidates.push("sh", "bash", "/bin/sh", "/bin/bash", "/usr/bin/sh", "/usr/bin/bash");

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(path.sep)) {
      if (isExecutablePath(candidate)) return candidate;
      continue;
    }
    const resolved = resolveExecutableFromPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

const POLICY_MODES = new Set(["deny", "ask", "allow"]);
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brm\s+-fr\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /\b:\(\)\s*\{\s*:\|:\s*&\s*\};:/,
  /\bformat\b/i
];
const NETWORK_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bhttp(s)?:\/\//i,
  /\bssh\b/i,
  /\bnc\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\bping\b/i
];
const PROCESS_CONTROL_PATTERNS = [
  /\bkill(all)?\b/i,
  /\bpkill\b/i,
  /\bsystemctl\b/i,
  /\bservice\b/i,
  /\bnohup\b/i,
  /\bdocker\b/i,
  /\bkubectl\b/i
];
const WRITE_LOCAL_PATTERNS = [
  /\btee\b/i,
  /\btouch\b/i,
  /\bmkdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\btruncate\b/i,
  /\binstall\b/i,
  />>?/,
  /\bcat\b.*?>/
];
const READ_ONLY_PATTERNS = [
  /\bcat\b/i,
  /\bls\b/i,
  /\bfind\b/i,
  /\bhead\b/i,
  /\btail\b/i,
  /\bgrep\b/i,
  /\brg\b/i,
  /\bwc\b/i,
  /\bsed\b/i,
  /\bawk\b/i,
  /\becho\b/i,
  /\bprintf\b/i,
  /\bnode\s+--version\b/i,
  /\buname\b/i,
  /\bpwd\b/i,
  /\bwhoami\b/i
];

function normalizePolicyMode(value, fallback = "ask") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (POLICY_MODES.has(raw)) return raw;
  return fallback;
}

function hasPattern(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyCommandText(commandText) {
  const cmd = String(commandText ?? "").trim();
  if (!cmd) return "unknown";
  if (hasPattern(DESTRUCTIVE_PATTERNS, cmd)) return "destructive";
  if (hasPattern(NETWORK_PATTERNS, cmd)) return "network";
  if (hasPattern(PROCESS_CONTROL_PATTERNS, cmd)) return "process_control";
  if (hasPattern(WRITE_LOCAL_PATTERNS, cmd)) return "write_local";
  if (hasPattern(READ_ONLY_PATTERNS, cmd)) return "read_only";
  return "unknown";
}

export function resolveCommandPolicy({ sentence, cmdClass, rememberFn = remember } = {}) {
  const sessionMode = resolveConfigMapText("session command configure", "policy mode", { rememberFn })
    ?? resolveConfigText("session command policy mode", { rememberFn });
  const agentMode = resolveConfigMapText("agent command configure", "policy mode", { rememberFn })
    ?? resolveConfigText("agent command policy mode", { rememberFn });
  const globalMode = resolveConfigMapText("command configure", "policy mode", { rememberFn })
    ?? resolveConfigText("command policy mode", { rememberFn });
  const baseMode = normalizePolicyMode(sessionMode ?? agentMode ?? globalMode, "ask");

  const sessionClassifier = resolveConfigMapBool("session command configure", "classifier enabled", { rememberFn });
  const agentClassifier = resolveConfigMapBool("agent command configure", "classifier enabled", { rememberFn });
  const globalClassifier =
    resolveConfigMapBool("command configure", "classifier enabled", { rememberFn })
    ?? resolveConfigBool("command classifier enabled", { rememberFn });
  const classifierEnabled = sessionClassifier ?? agentClassifier ?? globalClassifier ?? true;
  const source = sessionMode !== undefined ? "session command configure"
    : agentMode !== undefined ? "agent command configure"
      : "command configure";

  let mode = baseMode;
  if (sentence?.mood === "propose") mode = "ask";
  if (sentence?.mood === "can" && mode !== "deny") mode = "allow";
  if (!classifierEnabled) {
    return {
      mode,
      classifierEnabled: false,
      class: "unknown",
      source
    };
  }
  return {
    mode,
    classifierEnabled: true,
    class: cmdClass ?? "unknown",
    source
  };
}

const commandStreamProcesses = new Map();
const STREAM_END_TOKEN = "[PYA_STREAM_END]";
let commandAuditCounter = 0;
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

function nextAuditId() {
  commandAuditCounter += 1;
  return String(commandAuditCounter).padStart(6, "0");
}

function buildCommandAudit({
  requestId,
  stage,
  commandClass,
  policy,
  decision,
  sentence,
  resultSentence,
  rememberFn = remember
} = {}) {
  const lane = resolveConfigMapText("command configure", "audit security lane", { rememberFn });
  const id = requestId ?? nextAuditId();
  const audit = {
    mood: "ya",
    exists: true,
    be: "command audit",
    su: { name: `command audit ${id}` },
    to: { name: `command request ${id}` },
    as: { name: stage || "policy" },
    from: { name: policy?.source ?? "command configure" },
    accordingto: { name: decision ?? policy?.mode ?? "allow" },
    by: { name: commandClass ?? "unknown" },
    ob: { text: sentenceToPyash(sentence ?? {}) },
    fromtext: { text: new Date().toISOString() }
  };
  if (resultSentence) audit.totext = { text: sentenceToPyash(resultSentence) };
  if (lane) audit.at = { filename: lane };
  return audit;
}

function emitCommandAudit(payload) {
  emitExchangeSentence(buildCommandAudit(payload));
}

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
  return { cwd, roots: expanded };
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

function resolveSandboxSettings({ sentence, rememberFn = remember } = {}) {
  const agentDerived = resolveAgentSandboxRoots({ rememberFn });
  const configuredWritableRoots =
    resolveConfigMapSeries("sandbox configure", "writable roots", { rememberFn })
    ?? resolveConfigSeries("command sandbox writable roots", { rememberFn });
  const writableRoots = normalizeRoots(configuredWritableRoots ?? agentDerived?.roots ?? [process.cwd()]);
  const configuredCwd =
    resolveConfigMapText("sandbox configure", "cwd", { rememberFn })
    ?? resolveConfigMapText("command configure", "sandbox cwd", { rememberFn })
    ?? agentDerived?.cwd
    ?? process.cwd();
  const cwd = path.resolve(String(configuredCwd ?? process.cwd()));
  const networkAllowed =
    resolveConfigMapBool("sandbox configure", "network", { rememberFn })
    ?? resolveConfigBool("command sandbox network", { rememberFn })
    ?? true;
  const timeoutMs =
    resolveConfigMapNum("sandbox configure", "timeout ms", { rememberFn })
    ?? resolveConfigMapNum("command configure", "sandbox timeout ms", { rememberFn })
    ?? 30000;
  const maxOutputBytes =
    resolveConfigMapNum("sandbox configure", "max output bytes", { rememberFn })
    ?? resolveConfigMapNum("command configure", "sandbox max output bytes", { rememberFn })
    ?? 1024 * 1024;
  const envAllowlist = resolveConfigMapSeries("sandbox configure", "command env allowlist", { rememberFn })
    ?? resolveConfigMapSeries("sandbox configure", "env allowlist", { rememberFn })
    ?? resolveConfigSeries("command env allowlist", { rememberFn })
    ?? DEFAULT_ENV_ALLOWLIST;
  return {
    cwd,
    writableRoots,
    networkAllowed,
    timeoutMs,
    maxOutputBytes,
    envAllowlist
  };
}

function buildAllowedEnv({ allowlist = [], cwd } = {}) {
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
  env.PWD = cwd;
  return env;
}

function validateSandboxWritePolicy({ sentence, commandText, commandClass, sandbox } = {}) {
  if (!Array.isArray(sandbox?.writableRoots) || sandbox.writableRoots.length === 0) {
    throwErrorSentence({
      name: "command sandbox defective",
      message: "command sandbox defective: writable roots missing",
      from: { la: sentence },
      raw: { sandbox }
    });
  }
  if (!isPathWithinRoots(sandbox.cwd, sandbox.writableRoots)) {
    throwErrorSentence({
      name: "command sandbox defective",
      message: `command sandbox defective: cwd outside writable roots (${sandbox.cwd})`,
      from: { la: sentence },
      raw: { cwd: sandbox.cwd, writableRoots: sandbox.writableRoots }
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

function shouldRequireRatify({ sentence, policy, commandClass } = {}) {
  if (sentence?.accordingto?.name === "ratify decision" && sentence?.totext?.text === "truth") return false;
  if (policy?.mode !== "ask") return false;
  if (sentence?.mood === "propose") return true;
  return commandClass === "destructive";
}

function shouldDeny({ sentence, policy, commandClass } = {}) {
  if (policy?.mode !== "deny") return false;
  if (sentence?.mood === "propose") return true;
  return commandClass === "destructive";
}

function isNetworkDenied({ commandClass, sandbox } = {}) {
  return commandClass === "network" && sandbox?.networkAllowed === false;
}

function buildCommandResumeToken({ sentence, commandClass, commandText }) {
  return JSON.stringify({
    kind: "command",
    issuedAt: new Date().toISOString(),
    class: commandClass ?? "unknown",
    text: String(commandText ?? ""),
    sentence: sentence && typeof sentence === "object" ? sentence : {}
  });
}

function resolveStreamOutputPath(sentence) {
  const base = sentence?.su?.name ?? `command-${Date.now()}`;
  return path.join("artifacts", "command", `${base}.stream.txt`);
}

function startFileTail({ filename, onLine }) {
  let offset = 0;
  let pending = "";
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fsSync.statSync(filename);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fsSync.openSync(filename, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fsSync.readSync(fd, buffer, 0, buffer.length, offset);
    fsSync.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length) onLine(line);
    }
  }, 200);
  return () => clearInterval(interval);
}

async function runCommandText(cmd, { input, timeoutMs, cwd, env, maxOutputBytes } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    const spawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env
    };
    if (canRunDirect(cmd)) {
      const parts = splitCommand(cmd);
      proc = spawn(resolveDirectProgram(parts[0]), parts.slice(1), spawnOptions);
    } else {
      const shell = resolveShellCommand();
      if (!shell) {
        reject(new Error("command shell defective: no shell executable found"));
        return;
      }
      proc = spawn(shell, ["-lc", String(cmd)], spawnOptions);
    }
    let stdout = "";
    let stderr = "";
    let exceededOutputLimit = false;
    let timeoutHandle = null;
    const checkOutputLimit = () => {
      if (!(typeof maxOutputBytes === "number" && maxOutputBytes > 0)) return;
      if ((Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8")) <= maxOutputBytes) return;
      exceededOutputLimit = true;
      proc.kill("SIGKILL");
    };
    proc.stdout.on("data", data => {
      stdout += data.toString("utf8");
      checkOutputLimit();
    });
    proc.stderr.on("data", data => {
      stderr += data.toString("utf8");
      checkOutputLimit();
    });
    proc.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });
    proc.on("close", status => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (exceededOutputLimit) {
        stderr += `output exceeded ${maxOutputBytes} bytes`;
      }
      resolve({ status, stdout, stderr });
    });
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        proc.kill("SIGKILL");
        stderr += `timeout after ${timeoutMs}ms`;
      }, timeoutMs);
    }
    if (input !== null && input !== undefined) {
      proc.stdin.end(Buffer.from(String(input), "utf8"));
    } else {
      proc.stdin.end();
    }
  });
}

export async function command(sentence, { remember: rememberFn = remember } = {}) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: "command", caseKey: "vyah" });
  const debug = resolveConfigBool("command debug", { rememberFn }) === true;
  if (aspect === "cancel") {
    const targetName = sentence?.su?.name;
    if (!targetName) {
      throwErrorSentence({
        name: "command cancel invalid",
        message: "command cancel requires su name",
        from: { name: "command" },
        raw: { sentence }
      });
    }
    const entry = commandStreamProcesses.get(targetName);
    if (entry?.proc) {
      entry.proc.kill("SIGINT");
      if (entry.stop) entry.stop();
      commandStreamProcesses.delete(targetName);
    }
    return { su: { name: targetName }, vyah: { ve: { type: "name", values: ["cancel", "sloh"] } }, be: "command", mood: "ya" };
  }
  if (aspect && aspect !== "stream" && aspect !== "eval") {
    throwErrorSentence({
      name: "command aspect invalid",
      message: `command does not support vyah ${aspect}`,
      from: { name: "command" },
      raw: { aspect }
    });
  }

  const commandResponse = resolveConfigText("command response", { rememberFn });
  if (commandResponse !== undefined) {
    const output = String(commandResponse);
    if (aspect === "stream") {
      const streamName = sentence?.su?.name;
      if (!streamName) {
        throwErrorSentence({
          name: "command stream invalid",
          message: "command vyah stream requires su name",
          from: { name: "command" },
          raw: { sentence }
        });
      }
      const values = output.split(/\r?\n/).filter(Boolean);
      return makeStream({
        name: streamName,
        state: "open",
        ob: { ve: { values }, kind: "command", final: true }
      });
    }
    if (sentence?.to?.name) {
      const fact = { mood: "ya", be: "text", su: { name: sentence.to.name }, ob: { text: output } };
      doRemember(fact);
    }
    return { ob: { text: output }, be: "command" };
  }
  const cmd = resolveCommandText(sentence.ob ?? {}, { rememberFn });
  if (!cmd) {
    throwErrorSentence({
      name: "command defective",
      message: "command defective: empty command",
      from: { la: sentence },
      raw: { cmd }
    });
  }
  const commandClass = classifyCommandText(cmd);
  const policy = resolveCommandPolicy({ sentence, cmdClass: commandClass, rememberFn });
  const sandbox = resolveSandboxSettings({ sentence, rememberFn });
  const commandEnv = buildAllowedEnv({ allowlist: sandbox.envAllowlist, cwd: sandbox.cwd });
  const requestId = nextAuditId();
  if (shouldDeny({ sentence, policy, commandClass })) {
    emitCommandAudit({ requestId, stage: "policy", commandClass, policy, decision: "deny", sentence, rememberFn });
    throwErrorSentence({
      name: "command policy defective",
      message: `command policy defective: denied class=${commandClass}`,
      from: { la: sentence },
      raw: { class: commandClass, mode: policy.mode }
    });
  }
  if (shouldRequireRatify({ sentence, policy, commandClass })) {
    const resumeToken = buildCommandResumeToken({ sentence, commandClass, commandText: cmd });
    const ratifySentence = {
      mood: "do",
      be: "ratify",
      su: { name: sentence?.su?.name ?? "command approval" },
      ob: { text: `approve command (${commandClass}): ${cmd}` },
      from: { name: "command" },
      accordingto: { name: "resume token" },
      fromtext: { text: resumeToken }
    };
    emitCommandAudit({
      requestId,
      stage: "policy",
      commandClass,
      policy,
      decision: "ask",
      sentence,
      resultSentence: ratifySentence,
      rememberFn
    });
    return ratifySentence;
  }
  if (isNetworkDenied({ commandClass, sandbox })) {
    emitCommandAudit({ requestId, stage: "sandbox", commandClass, policy, decision: "deny", sentence, rememberFn });
    throwErrorSentence({
      name: "command sandbox defective",
      message: "command sandbox defective: network disabled",
      from: { la: sentence },
      raw: { class: commandClass, network: false }
    });
  }
  validateSandboxWritePolicy({ sentence, commandText: cmd, commandClass, sandbox });
  emitCommandAudit({ requestId, stage: "policy", commandClass, policy, decision: "allow", sentence, rememberFn });

  let input = null;
  if (sentence.from?.filename) {
    input = await fs.readFile(sentence.from.filename, "utf8");
  } else if (sentence.from) {
    const resolved = renderSayValue(sentence.from, { rememberFn });
    if (resolved !== undefined && resolved !== null) {
      input = String(resolved);
    }
  } else if (sentence.fromtext) {
    const resolved = renderSayValue(sentence.fromtext, { rememberFn });
    if (resolved !== undefined && resolved !== null) {
      input = String(resolved);
    }
  }
  if (aspect === "stream") {
    const streamName = sentence?.su?.name;
    if (!streamName) {
      throwErrorSentence({
        name: "command stream invalid",
        message: "command vyah stream requires su name",
        from: { name: "command" },
        raw: { sentence }
      });
    }
    const streamPath = resolveStreamOutputPath(sentence);
    await fs.mkdir(path.dirname(streamPath), { recursive: true });
    fsSync.writeFileSync(streamPath, "");
    const outStream = fsSync.createWriteStream(streamPath, { flags: "a" });
    let proc;
    const spawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: sandbox.cwd,
      env: commandEnv
    };
    if (canRunDirect(cmd)) {
      const parts = splitCommand(cmd);
      proc = spawn(resolveDirectProgram(parts[0]), parts.slice(1), spawnOptions);
    } else {
      const shell = resolveShellCommand();
      if (!shell) {
        throwErrorSentence({
          name: "command defective",
          message: "command defective: no shell executable found",
          from: { la: sentence },
          raw: { cmd }
        });
      }
      proc = spawn(shell, ["-lc", String(cmd)], spawnOptions);
    }
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.stdout.on("data", data => { outStream.write(data); });
    proc.on("close", (status) => {
      if (status && status !== 0) {
        // eslint-disable-next-line no-console
        console.error(`command stream exited ${status}: ${stderr.trim()}`);
      }
      outStream.write(`\n${STREAM_END_TOKEN}\n`);
      outStream.end();
      commandStreamProcesses.delete(streamName);
    });
    proc.on("error", () => {
      outStream.write(`\n${STREAM_END_TOKEN}\n`);
      outStream.end();
      commandStreamProcesses.delete(streamName);
    });
    const streamInput = sentence?.from?.name ? rememberFn?.(sentence.from.name) : null;
    if (streamInput?.be === "stream" && streamInput.ob?.filename) {
      const stopTail = startFileTail({
        filename: streamInput.ob.filename,
        onLine: (line) => {
          const trimmed = String(line ?? "").trim();
          if (!trimmed) return;
          if (trimmed.includes(STREAM_END_TOKEN) || trimmed.includes("[BLANK_AUDIO]")) {
            proc.stdin.end();
            stopTail();
            return;
          }
          proc.stdin.write(`${trimmed}\n`);
        }
      });
    } else if (streamInput?.be === "stream" && Array.isArray(streamInput.ob?.ve?.values)) {
      for (const value of streamInput.ob.ve.values) {
        proc.stdin.write(String(value ?? ""));
        proc.stdin.write("\n");
      }
      proc.stdin.end();
    } else if (input !== null && input !== undefined) {
      proc.stdin.write(input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
    commandStreamProcesses.set(streamName, { proc });
    return makeStream({
      name: streamName,
      state: "open",
      ob: { filename: streamPath, kind: "command" }
    });
  }

  const piperFixture = process.env.PYA_PIPER_FIXTURE;
  if (piperFixture !== undefined && String(cmd).includes("command/piper_say_runner.mjs")) {
    const outputText = String(piperFixture);
    const match = String(cmd).match(/--output\s+([^\s]+)/);
    if (match?.[1]) {
      const outPath = match[1];
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, outputText, "utf8");
    }
    if (sentence?.to?.filename) {
      await fs.writeFile(sentence.to.filename, outputText, "utf8");
    }
    if (sentence?.to?.name) {
      const fact = { mood: "ya", be: "text", su: { name: sentence.to.name }, ob: { text: outputText } };
      doRemember(fact);
    }
    return { ob: { text: outputText }, be: "command" };
  }

  const res = await runCommandText(cmd, {
    input,
    timeoutMs: sandbox.timeoutMs,
    cwd: sandbox.cwd,
    env: commandEnv,
    maxOutputBytes: sandbox.maxOutputBytes
  });
  if (debug) {
    const stdout = String(res.stdout ?? "");
    const stderr = String(res.stderr ?? "");
    // eslint-disable-next-line no-console
    console.error(`[command debug] ${JSON.stringify({
      cmd,
      class: commandClass,
      policyMode: policy.mode,
      policySource: policy.source,
      status: res.status ?? 0,
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
      stderr: stderr.slice(0, 200)
    })}`);
  }
  if (res.status) {
    emitCommandAudit({
      requestId,
      stage: "result",
      commandClass,
      policy,
      decision: "error",
      sentence,
      resultSentence: { mood: "do", be: "error", su: { name: "command defective" }, ob: { text: `status=${res.status ?? 0}` } },
      rememberFn
    });
    throwErrorSentence({
      name: "command defective",
      message: `command defective: status=${res.status ?? 0} stderr=${JSON.stringify(res.stderr ?? "")}`,
      from: { la: sentence },
      raw: { status: res.status ?? 0, stderr: res.stderr ?? "", stdout: res.stdout ?? "" }
    });
  }
  const output = String(res.stdout ?? "");
  if (sentence?.to?.filename) {
    await fs.writeFile(sentence.to.filename, output, "utf8");
  }
  if (sentence?.to?.name) {
    const fact = { mood: "ya", be: "text", su: { name: sentence.to.name }, ob: { text: output } };
    doRemember(fact);
  }
  emitCommandAudit({
    requestId,
    stage: "result",
    commandClass,
    policy,
    decision: "allow",
    sentence,
    resultSentence: { mood: "ya", be: "command", ob: { text: output } },
    rememberFn
  });
  return { ob: { text: output }, be: "command" };
}

export default command;

export const signatures = [
  { signatureWords: ["be", "command", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "ob", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "name", "wo"], handler: command },
  { signatureWords: ["be", "command", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "name", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "name", "wo"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "from", "text", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo", "to", "name", "text"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo", "to", "filename"], handler: command },
  { signatureWords: ["be", "command", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "filename", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "name", "stream", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "from", "name", "stream", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "text", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "text", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "fromtext", "name", "text", "ob", "wo", "vyah", "stream"], handler: command },
  { signatureWords: ["be", "command", "vyah", "cancel"], handler: command }
];
