import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { parseTokens } from "../program/understand/parse_tokens.mjs";
import { QUOTED_TEXT_PREFIX } from "../program/understand/constants.mjs";
import { MOODS } from "../program/library/grammar/keywords.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";

const commandDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(commandDir, "..");
const runnerPath = path.join(commandDir, "run_pya_program.mjs");
const mainPath = path.join(repoRoot, "program", "main.mjs");
const valueAfter = new Set(["filename"]);
const runnerValueFlags = new Set(["--run-id", "--run-time", "--refinery"]);

function usage(command, detail = null) {
  const contracts = {
    compile: "usage: ./compile from filename <source> [fromstate <state>] to filename <destination> [tostate|become <state>] [be compile do]",
    run: "usage: ./run from filename <program> [runtime input binding words]",
    interpret: "usage: ./interpret <complete Pyash sentence>"
  };
  console.error(detail ? `${contracts[command]}\n${command} error: ${detail}` : contracts[command]);
  return 1;
}

function parserTokens(args) {
  let expectsValue = false;
  return args.map((arg) => {
    if (expectsValue) {
      expectsValue = false;
      return `${QUOTED_TEXT_PREFIX}${arg}`;
    }
    if (valueAfter.has(arg)) expectsValue = true;
    return arg;
  });
}

function parseCase(args, options = {}) {
  try {
    return parseTokens(parserTokens(args), { allowMoodless: true, ...options });
  } catch {
    return null;
  }
}

function validFilenameCase(sentence) {
  const fromKeys = Object.keys(sentence?.from ?? {});
  const toKeys = Object.keys(sentence?.to ?? {});
  return fromKeys.length === 1
    && fromKeys[0] === "filename"
    && typeof sentence.from.filename === "string"
    && sentence.from.filename.length > 0
    && toKeys.length === 1
    && toKeys[0] === "filename"
    && typeof sentence.to.filename === "string"
    && sentence.to.filename.length > 0;
}

function stateName(value) {
  if (typeof value === "string") return value;
  return value?.name ?? value?.wo ?? value?.text ?? null;
}

function compileSentence(args) {
  const parsed = parseCase(args, {
    strict: true,
    singletonCases: ["from", "to", "fromstate", "become", "be"]
  });
  if (!parsed || !validFilenameCase(parsed)) return null;
  if (parsed.be !== undefined && parsed.be !== "compile") return null;
  if (parsed.mood !== undefined && parsed.mood !== "do") return null;
  if (parsed.fromstate !== undefined && !stateName(parsed.fromstate)) return null;
  if (parsed.become !== undefined && !stateName(parsed.become)) return null;
  if (Object.keys(parsed).some((key) => !["from", "to", "fromstate", "become", "be", "mood"].includes(key))) return null;

  return {
    ...parsed,
    fromstate: parsed.fromstate ?? { name: "pyash" },
    become: parsed.become ?? { name: "javascript" },
    be: "compile",
    mood: "do"
  };
}

function quoteFilenameValues(sentence) {
  return {
    ...sentence,
    from: { ...sentence.from, filename: JSON.stringify(sentence.from.filename) },
    to: { ...sentence.to, filename: JSON.stringify(sentence.to.filename) }
  };
}

function compileArgs(args) {
  if (args.length >= 2 && !args[0].startsWith("-") && !["from", "to", "be", "fromstate", "tostate", "become"].includes(args[0])) {
    const target = args[2] ?? "javascript";
    if (args.length > 3 || target.startsWith("-")) return null;
    return compileSentence([
      "from", "filename", args[0],
      "fromstate", "pyash",
      "to", "filename", args[1],
      "become", target,
      "be", "compile", "do"
    ]);
  }
  return compileSentence(args);
}

function splitRunnerArgs(args) {
  const options = [];
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    options.push(arg);
    if (runnerValueFlags.has(arg) && args[i + 1] !== undefined) options.push(args[++i]);
  }
  return { options, positional };
}

function normalizeBindingTail(tail) {
  if (tail[0] !== "ob") return tail;
  const normalized = [];
  for (let index = 0; index < tail.length; index += 1) {
    const token = tail[index];
    normalized.push(token);
    if (token === "ob" && tail[index + 2] !== undefined) {
      normalized.push(tail[++index]);
      normalized.push(JSON.stringify(tail[++index]));
    }
  }
  return normalized;
}

function forwardChild(entryPath, args, { input = undefined, interactive = false } = {}) {
  const options = { cwd: process.cwd(), env: process.env, encoding: "utf8" };
  if (interactive) options.stdio = "inherit";
  else if (input !== undefined) options.input = input;
  const child = spawnSync(process.execPath, [entryPath, ...args], options);
  if (!interactive) {
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
  }
  if (child.error) {
    console.error(child.error.message);
    return 1;
  }
  return child.status ?? 1;
}

async function ensureProgram(program) {
  try {
    const stats = await fs.stat(path.resolve(process.cwd(), program));
    return stats.isFile();
  } catch {
    return false;
  }
}

async function runCommand(args) {
  const { options, positional } = splitRunnerArgs(args);
  if (positional[0] === "from") {
    if (positional[1] !== "filename" || !positional[2] || positional.length < 3) {
      return usage("run", "expected from filename <program>");
    }
    const sentence = parseCase(positional.slice(0, 3));
    if (!sentence || sentence.from?.filename === undefined || Object.keys(sentence).length !== 1) {
      return usage("run", "expected one from filename case");
    }
    const program = sentence.from.filename;
    if (!(await ensureProgram(program))) return usage("run", `program unavailable: ${program}`);
    return forwardChild(runnerPath, [...options, program, ...normalizeBindingTail(positional.slice(3))]);
  }

  const program = positional[0];
  if (!program) return usage("run", "program filename is required");
  if (!(await ensureProgram(program))) return usage("run", `program unavailable: ${program}`);
  return forwardChild(runnerPath, args);
}

async function compileCommand(args) {
  const sentence = compileArgs(args);
  if (!sentence) return usage("compile", "expected a filename-to-filename compile case");
  return forwardChild(runnerPath, [sentenceToPyash(quoteFilenameValues(sentence))]);
}

async function interpretCommand(args) {
  if (args.length === 0) return forwardChild(mainPath, [], { interactive: true });
  const source = args.length === 1 ? args[0] : args.join(" ");
  let sentence;
  try {
    sentence = parse(source);
  } catch {
    return usage("interpret", "sentence could not be parsed");
  }
  if (!sentence || !MOODS.includes(sentence.mood) || !sentence.be) {
    return usage("interpret", "a complete sentence with a mood and verb is required");
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [mainPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let sentQuit = false;
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (!sentQuit && text.includes("→")) {
        sentQuit = true;
        child.stdin.write("quit\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
      if (!sentQuit && text.includes("Error:")) {
        sentQuit = true;
        child.stdin.write("quit\n");
      }
    });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("close", (status) => {
      if (status !== 0) resolve(status ?? 1);
      else resolve(/(?:^|\n)Error:/u.test(stderr) ? 1 : 0);
    });
    child.stdin.write(`${sentenceToPyash(sentence)}\n`);
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "compile") return compileCommand(args);
  if (command === "run") return runCommand(args);
  if (command === "interpret") return interpretCommand(args);
  console.error("usage: <compile|run|interpret> ...");
  return 1;
}

process.exitCode = await main();
