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

function findShellSubstitutionEnd(text, start) {
  let depth = 1;
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote === "'") {
      if (character === "'") quote = "";
      continue;
    }
    if (quote === '"') {
      if (character === "\\") index += 1;
      else if (character === '"') quote = "";
      else if (character === "$" && text[index + 1] === "(") {
        depth += 1;
        index += 1;
      }
      continue;
    }
    if (character === "\\") index += 1;
    else if (character === "'") quote = "'";
    else if (character === '"') quote = '"';
    else if (character === "$" && text[index + 1] === "(") {
      depth += 1;
      index += 1;
    } else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function findBacktickSubstitutionEnd(text, start) {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === "`") return index;
  }
  return text.length;
}

function parseShellTokens(commandText = "", nestedCommands = []) {
  const text = String(commandText ?? "");
  const operators = [
    "&>>", "<<<", "<<-", "<<", ">>", "&&", "||", "&>", "<>", ">|", "<", ">", ";", "|", "&", "(", ")"
  ];
  const tokens = [];
  const hereDocs = [];
  let word = "";
  let wordStarted = false;
  let quote = "";
  let hereDocExpectation = null;

  const flushWord = () => {
    if (!wordStarted) return;
    if (hereDocExpectation) {
      hereDocs.push({ delimiter: word, stripTabs: hereDocExpectation.stripTabs });
      hereDocExpectation = null;
    } else {
      tokens.push({ kind: "word", value: word });
    }
    word = "";
    wordStarted = false;
  };

  const skipHereDocBodies = (start) => {
    let cursor = start;
    for (const hereDoc of hereDocs) {
      let foundDelimiter = false;
      while (cursor < text.length) {
        const newline = text.indexOf("\n", cursor);
        const end = newline === -1 ? text.length : newline;
        const line = text.slice(cursor, end);
        const candidate = hereDoc.stripTabs ? line.replace(/^\t+/u, "") : line;
        cursor = newline === -1 ? text.length : newline + 1;
        if (candidate === hereDoc.delimiter) {
          foundDelimiter = true;
          break;
        }
      }
      if (!foundDelimiter) return text.length;
    }
    hereDocs.length = 0;
    return cursor;
  };

  // Keep quoted shell words intact so prose slashes are not mistaken for path arguments.
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (quote === "'") {
      if (character === "'") quote = "";
      else word += character;
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (character === "$" && text[index + 1] === "(") {
        const end = findShellSubstitutionEnd(text, index + 2);
        nestedCommands.push(text.slice(index + 2, end));
        const afterEnd = end < text.length ? end + 1 : end;
        word += text.slice(index, afterEnd);
        index = afterEnd;
      } else if (character === "`") {
        const end = findBacktickSubstitutionEnd(text, index + 1);
        if (end < text.length) nestedCommands.push(text.slice(index + 1, end));
        const afterEnd = end < text.length ? end + 1 : end;
        word += text.slice(index, afterEnd);
        index = afterEnd;
      } else if (character === "\\" && index + 1 < text.length) {
        const next = text[index + 1];
        if (next === "\n") index += 2;
        else if ("$`\"\\".includes(next)) {
          word += next;
          index += 2;
        } else {
          word += `\\${next}`;
          index += 2;
        }
      } else if (character === '"') {
        quote = "";
        index += 1;
      } else {
        word += character;
        index += 1;
      }
      continue;
    }

    if (character === "\\" && index + 1 < text.length) {
      const next = text[index + 1];
      wordStarted = true;
      if (next !== "\n") word += next;
      index += 2;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      wordStarted = true;
      index += 1;
      continue;
    }
    if (character === "#" && !wordStarted) {
      const newline = text.indexOf("\n", index);
      index = newline === -1 ? text.length : newline;
      continue;
    }
    if (character === "\n") {
      flushWord();
      tokens.push({ kind: "operator", value: "\n" });
      index = hereDocs.length ? skipHereDocBodies(index + 1) : index + 1;
      continue;
    }
    if (/\s/u.test(character)) {
      flushWord();
      index += 1;
      continue;
    }

    const operator = operators.find((candidate) => text.startsWith(candidate, index));
    if (operator) {
      flushWord();
      tokens.push({ kind: "operator", value: operator });
      if (operator === "<<" || operator === "<<-") {
        hereDocExpectation = { stripTabs: operator === "<<-" };
      }
      index += operator.length;
      continue;
    }

    word += character;
    wordStarted = true;
    index += 1;
  }
  flushWord();
  return tokens;
}

const SHELL_WRITE_COMMANDS = new Set([
  "chmod", "chown", "cp", "install", "mkdir", "mv", "rm", "rmdir", "tee", "touch", "truncate", "warc2zim", "zimwriterfs"
]);
const SHELL_WRAPPERS = new Set(["builtin", "command", "env", "exec", "nice", "nohup", "sudo", "time"]);
const SHELL_SEPARATORS = new Set(["\n", "&&", "||", ";", "|", "&", "(", ")"]);
const SHELL_OUTPUT_REDIRECTIONS = new Set([">", ">>", ">|", "&>", "&>>"]);

function collectShellWritePaths(tokens = [], paths = [], nestedCommands = []) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.kind === "operator" && SHELL_OUTPUT_REDIRECTIONS.has(token.value)
      && next?.kind === "word" && next.value.startsWith("/")) {
      paths.push(next.value);
    }
  }

  const words = tokens.filter((token) => token.kind === "word").map((token) => token.value);
  let commandIndex = 0;
  while (commandIndex < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[commandIndex])) commandIndex += 1;
  while (commandIndex < words.length && SHELL_WRAPPERS.has(path.basename(words[commandIndex]).toLowerCase())) {
    commandIndex += 1;
    while (commandIndex < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[commandIndex])) commandIndex += 1;
  }
  if (commandIndex >= words.length) return;

  const commandName = path.basename(words[commandIndex]).toLowerCase();
  if (["sh", "bash", "dash", "zsh"].includes(commandName)) {
    const codeFlag = words.indexOf("-c", commandIndex + 1);
    if (codeFlag >= 0 && words[codeFlag + 1]) nestedCommands.push(words[codeFlag + 1]);
  } else if (commandName === "eval") {
    const evaluatedText = words.slice(commandIndex + 1).join(" ");
    if (evaluatedText) nestedCommands.push(evaluatedText);
  } else if (SHELL_WRITE_COMMANDS.has(commandName)) {
    for (const argument of words.slice(commandIndex + 1)) {
      if (argument.startsWith("/")) paths.push(argument);
    }
  }
}

function parseAbsolutePathTokens(commandText = "") {
  const nestedCommands = [];
  const tokens = parseShellTokens(commandText, nestedCommands);
  const paths = [];
  let commandTokens = [];
  const flushCommand = () => {
    if (commandTokens.length) collectShellWritePaths(commandTokens, paths, nestedCommands);
    commandTokens = [];
  };
  for (const token of tokens) {
    if (token.kind === "operator" && SHELL_SEPARATORS.has(token.value)) flushCommand();
    else commandTokens.push(token);
  }
  flushCommand();
  for (const nestedCommand of nestedCommands) {
    paths.push(...parseAbsolutePathTokens(nestedCommand));
  }
  return paths;
}

export function rewriteRunRootCommandPath(commandText, { cwd, rememberFn = remember } = {}) {
  const text = String(commandText ?? "").trim();
  if (!text) return text;
  const match = text.match(/^((?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*)node\s+(?:\.\/)?command\/([^\s]+)([\s\S]*)$/u);
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
  const rejectionContext = (details = {}) => ({
    ...details,
    command: String(commandText ?? ""),
    cwd: String(sandbox?.cwd ?? ""),
    commandRoots: Array.isArray(sandbox?.commandRoots) ? [...sandbox.commandRoots] : [],
    writableRoots: Array.isArray(sandbox?.writableRoots) ? [...sandbox.writableRoots] : [],
    processStarted: false
  });
  if (!Array.isArray(sandbox?.writableRoots) || sandbox.writableRoots.length === 0) {
    throwErrorSentence({
      name: "command sandbox defective",
      message: "command sandbox defective: writable roots missing",
      from: { la: sentence },
      raw: rejectionContext({ sandbox })
    });
  }
  if (!Array.isArray(sandbox?.commandRoots) || sandbox.commandRoots.length === 0) {
    throwErrorSentence({
      name: "command permission defective",
      message: "command permission defective: command license missing",
      from: { la: sentence },
      raw: rejectionContext()
    });
  }
  if (!isPathWithinRoots(sandbox.cwd, sandbox.commandRoots)) {
    throwErrorSentence({
      name: "command sandbox defective",
      message: `command sandbox defective: cwd outside command roots (${sandbox.cwd})`,
      from: { la: sentence },
      raw: rejectionContext()
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
        raw: rejectionContext({ target: sentence.to.filename, resolvedTarget })
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
    raw: rejectionContext({ class: commandClass, outsideRoots })
  });
}

