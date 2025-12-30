import { spawn } from "node:child_process";
import fs from "node:fs/promises";
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
  const sourcePathFlag = readFlagValue(args, "--source");
  const cmdIndex = args.indexOf("--");
  if (!sourcePathFlag || cmdIndex === -1) {
    console.error("Usage: node program/command/run_with_newspaper.mjs --source <file.pya> [--run-id <id>] [--run-time <iso>] -- <command...>");
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
  const newspaperLines = [];
  const pushLine = (line) => {
    if (line) newspaperLines.push(line);
  };

  pushLine(`su name ${runId} from time ${runTime} be run ya`);
  for (const raw of sentences) {
    const line = raw.trim();
    if (!line) continue;
    const sentence = parse(line);
    const embedded = sentenceToPyash(sentence);
    pushLine(`ob la ${embedded} ko be evoke ya`);
  }

  let stdout = "";
  let stderr = "";
  const child = spawn(command[0], command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", chunk => {
    stderr += chunk.toString("utf8");
  });
  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  const outLines = stdout.split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
  for (const line of outLines) {
    pushLine(resultSentenceForLine(line));
  }

  if (exitCode !== 0) {
    const errSentence = buildErrorSentence({
      name: "compiled run failed",
      message: stderr.trim() || `compiled run failed (${exitCode})`,
      from: { name: "run" }
    });
    pushLine(sentenceToPyash(surfaceErrorSentence(errSentence)));
  }

  pushLine(`su name ${runId} be end ya`);
  const newspaperDir = path.resolve(process.cwd(), "newspaper");
  await fs.mkdir(newspaperDir, { recursive: true });
  const newspaperPath = path.join(newspaperDir, `${sanitizeRunId(runId)}.pya`);
  await fs.writeFile(newspaperPath, `${newspaperLines.join("\n")}\n`, "utf8");

  if (exitCode !== 0) process.exit(exitCode);
}

run().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
