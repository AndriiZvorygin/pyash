import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { splitSentences } from "../library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { buildErrorSentence, surfaceErrorSentence } from "../error.mjs";

function readFlagValue(args, name) {
  const prefix = `${name}=`;
  const idx = args.findIndex(arg => arg === name || arg.startsWith(prefix));
  if (idx === -1) return null;
  const arg = args[idx];
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return args[idx + 1] ?? null;
}

function sanitizeRunId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, "-") || "run";
}

function normalizeRunRoot(value) {
  return String(value ?? "").replace(/[\\]+/g, "/");
}

function resultSentenceForLine(line) {
  try {
    const sentence = parse(line);
    return sentenceToPyash(sentence);
  } catch {
    return sentenceToPyash({ mood: "ya", be: "text", ob: { text: line } });
  }
}

async function run() {
  const args = process.argv.slice(2);
  const runIdFlag = readFlagValue(args, "--run-id");
  const runTimeFlag = readFlagValue(args, "--run-time");
  const againFlag = args.includes("--again");
  const noCheckpoint = args.includes("--no-checkpoint");
  const sourcePathFlag = readFlagValue(args, "--source");
  const cmdIndex = args.indexOf("--");
  if (!sourcePathFlag || cmdIndex === -1) {
    console.error("Usage: node program/command/run_with_newspaper.mjs --source <file.pya> [--run-id <id>] [--run-time <iso>] [--no-checkpoint] -- <command...>");
    process.exit(1);
  }
  const command = args.slice(cmdIndex + 1);
  if (!command.length) {
    console.error("run_with_newspaper: missing command after --");
    process.exit(1);
  }

  const resolved = path.resolve(sourcePathFlag);
  const text = await fs.readFile(resolved, "utf8");
  const sentences = splitSentences(text);
  const runId = runIdFlag || `run-${Date.now()}`;
  const runTime = runTimeFlag || new Date().toISOString();
  const runRoot = normalizeRunRoot(path.resolve(process.cwd()));
  const newspaperLines = [];
  const pushLine = (line) => {
    if (line) newspaperLines.push(line);
  };
  const outputs = [];

  pushLine(`su name ${runId} from time ${runTime} be run ya`);
  pushLine(`ob filename "${runRoot}" be run root ya`);
  if (againFlag) {
    pushLine(`su name ${runId} as name again be run ya`);
  }
  let evokeCounter = -1;
  for (const raw of sentences) {
    const line = raw.trim();
    if (!line) continue;
    const sentence = parse(line);
    const embedded = sentenceToPyash(sentence);
    evokeCounter += 1;
    const sentenceId = `evoke-${evokeCounter}`;
    pushLine(`su name ${sentenceId} ob la ${embedded} ko be evoke ya`);
  }

  const prefix = "PYA_NEWSPAPER:";
  let capturing = false;
  let captured = [];
  const flushCaptured = () => {
    if (!captured.length) return;
    pushLine(captured.join("\n"));
    captured = [];
  };
  const handleLine = (line) => {
    if (line === `${prefix}BEGIN`) {
      capturing = true;
      captured = [];
      return;
    }
    if (line === `${prefix}END`) {
      capturing = false;
      flushCaptured();
      return;
    }
    if (capturing) {
      captured.push(line);
      return;
    }
    if (!line) return;
    if (line.startsWith(prefix)) {
      const payload = line.slice(prefix.length);
      if (payload) pushLine(payload);
      return;
    }
    outputs.push(line);
    pushLine(resultSentenceForLine(line));
  };

  const checkpointEnv = await (async () => {
    if (noCheckpoint) return "";
    const existingPath = path.resolve(process.cwd(), "newspaper", `${sanitizeRunId(runId)}.pya`);
    let existing = "";
    try {
      existing = await fs.readFile(existingPath, "utf8");
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      return "";
    }
    const entries = [];
    for (const raw of splitSentences(existing)) {
      const line = raw.trim();
      if (!line) continue;
      let sentence;
      try {
        sentence = parse(line);
      } catch {
        continue;
      }
      if (sentence?.be !== "checkpoint" || sentence?.mood !== "ya") continue;
      const refineryName = sentence?.from?.name;
      const platformName = sentence?.su?.name;
      const hash = sentence?.ob?.text;
      const resultSentence = sentence?.to?.la;
      if (!refineryName || !platformName || !hash || !resultSentence) continue;
      const resultLine = sentenceToPyash(resultSentence);
      const esc = (value) => String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\t/g, "\\t")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
      entries.push([
        esc(refineryName),
        esc(platformName),
        esc(hash),
        esc(resultLine)
      ].join("\t"));
    }
    return entries.join("\n");
  })();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-"));
  const stdoutPath = path.join(tmpDir, "stdout.txt");
  const stderrPath = path.join(tmpDir, "stderr.txt");
  const stdoutFd = fsSync.openSync(stdoutPath, "w");
  const stderrFd = fsSync.openSync(stderrPath, "w");
  let spawnError = null;
  const env = {
    ...process.env,
    PYA_NEWSPAPER: "1",
    PYA_RUN_ID: runId
  };
  if (checkpointEnv) env.PYA_CHECKPOINTS = checkpointEnv;
  if (noCheckpoint) env.PYA_NO_CHECKPOINT = "1";
  const child = spawn(command[0], command.slice(1), {
    stdio: ["ignore", stdoutFd, stderrFd],
    env
  });
  child.on("error", (err) => {
    spawnError = err;
  });
  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  fsSync.closeSync(stdoutFd);
  fsSync.closeSync(stderrFd);

  const stdout = await fs.readFile(stdoutPath, "utf8").catch(() => "");
  const stderr = await fs.readFile(stderrPath, "utf8").catch(() => "");

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed) handleLine(trimmed);
  }
  if (capturing) flushCaptured();
  let stderrText = "";
  capturing = false;
  captured = [];
  for (const line of stderr.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed === `${prefix}BEGIN`) {
      capturing = true;
      captured = [];
      continue;
    }
    if (trimmed === `${prefix}END`) {
      capturing = false;
      flushCaptured();
      continue;
    }
    if (capturing) {
      captured.push(trimmed);
      continue;
    }
    if (!trimmed) continue;
    if (trimmed.startsWith(prefix)) {
      const payload = trimmed.slice(prefix.length);
      if (payload) pushLine(payload);
    } else {
      stderrText += `${trimmed}\n`;
    }
  }
  if (capturing) flushCaptured();

  if (spawnError) {
    const errSentence = buildErrorSentence({
      name: "compiled run failed",
      message: spawnError.message || "compiled run failed",
      from: { name: "run" }
    });
    pushLine(sentenceToPyash(surfaceErrorSentence(errSentence)));
  } else if (exitCode !== 0) {
    const errSentence = buildErrorSentence({
      name: "compiled run failed",
      message: stderrText.trim() || `compiled run failed (${exitCode})`,
      from: { name: "run" }
    });
    pushLine(sentenceToPyash(surfaceErrorSentence(errSentence)));
  }

  pushLine(`su name ${runId} be end ya`);
  const newspaperDir = path.resolve(process.cwd(), "newspaper");
  await fs.mkdir(newspaperDir, { recursive: true });
  const newspaperPath = path.join(newspaperDir, `${sanitizeRunId(runId)}.pya`);
  await fs.writeFile(newspaperPath, `${newspaperLines.join("\n")}\n`, "utf8");

  if (outputs.length) {
    for (const line of outputs) {
      console.log(line);
    }
  }

  if (exitCode !== 0) process.exit(exitCode);
}

run().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
