import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const examplePath = path.join(repoRoot, "examples", "pyash", "agent-command-workflow.pya");
const runnerPath = path.join(repoRoot, "command", "run_pya_program.mjs");

const fixtureNames = [
  "PYA_COMMAND_RESPONSE",
  "PYA_HEAR_FIXTURE",
  "PYA_MIND_TOOL",
  "PYA_PIPER_FIXTURE",
  "PYA_SEE_VL_FIXTURE",
  "PYA_WEB_SEARCH_FIXTURE"
];

function fixtureEnv(response) {
  const env = { ...process.env, PYA_MIND_RESPONSE: JSON.stringify(response) };
  for (const name of fixtureNames) delete env[name];
  return env;
}

function parsedFile(text) {
  return splitSentences(text, { includeThen: true })
    .map(line => parse(line.trim()))
    .filter(Boolean);
}

async function runExample({ cwd, runId, response }) {
  const programPath = path.join(cwd, "agent-command-workflow.pya");
  await fs.copyFile(examplePath, programPath);
  return execFileAsync("node", [
    runnerPath,
    "--newspaper",
    "--run-id", runId,
    "--run-time", "2026-08-11T12:00:00Z",
    programPath
  ], {
    cwd,
    timeout: 120000,
    env: fixtureEnv(response)
  });
}

function toolName() {
  return "be_command_ob_text_to_name_text";
}

function toolResponse({ command = "node --version", final = "Node version checked successfully." } = {}) {
  return [
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "command-1",
          type: "function",
          function: { name: toolName(), arguments: { ob: command, to: "answer" } }
        }]
      }
    },
    { message: { role: "assistant", content: final } }
  ];
}

test("agent command workflow records nested command evidence and session turns", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-command-workflow-"));
  const runId = "agent-command-workflow";
  await runExample({ cwd, runId, response: toolResponse() });

  const newspaperPath = path.join(cwd, "newspaper", `${runId}.pya`);
  const newspaperText = await fs.readFile(newspaperPath, "utf8");
  const newspaper = parsedFile(newspaperText);
  const runStart = newspaper.findIndex(sentence => sentence?.be === "run" && sentence?.mood === "ya");
  const runEnd = newspaper.findIndex(sentence => sentence?.be === "end" && sentence?.mood === "ya");
  assert.notEqual(runStart, -1);
  assert.notEqual(runEnd, -1);
  assert.ok(runStart < runEnd);

  const toolEvents = newspaper.filter(sentence => sentence?.be === "tool");
  assert.equal(toolEvents.length, 1);
  const toolEvent = toolEvents[0];
  assert.match(sentenceToPyash(toolEvent?.ob?.la), /be command/);
  assert.match(sentenceToPyash(toolEvent?.to?.la), /be command ya/);
  const commandAudit = newspaper.findIndex(sentence => sentence?.be === "command audit");
  const toolEventIndex = newspaper.indexOf(toolEvent);
  assert.notEqual(commandAudit, -1);
  assert.ok(commandAudit < toolEventIndex);

  const sessionFiles = await fs.readdir(path.join(cwd, "world", "house", "agent", "session"));
  assert.equal(sessionFiles.length, 1);
  const sessionPath = path.join(cwd, "world", "house", "agent", "session", sessionFiles[0]);
  const session = parsedFile(await fs.readFile(sessionPath, "utf8"));
  assert.ok(session.some(sentence => sentence?.su?.name === "system"));
  assert.ok(session.some(sentence => sentence?.su?.name === "user"));
  assert.ok(session.some(sentence => sentence?.su?.name === "agent"));

  const resultPath = path.join(cwd, "artifacts", runId, "result.pya");
  const resultStat = await fs.stat(resultPath);
  assert.ok(resultStat.isFile());
  assert.ok(parsedFile(await fs.readFile(resultPath, "utf8")).length > 0);
});

test("empty nested command records an error tool event without losing run evidence", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-command-workflow-error-"));
  const runId = "agent-command-workflow-error";
  await runExample({ cwd, runId, response: toolResponse({ command: "", final: "The command failed." }) });

  const newspaperPath = path.join(cwd, "newspaper", `${runId}.pya`);
  const newspaper = parsedFile(await fs.readFile(newspaperPath, "utf8"));
  const toolEvent = newspaper.find(sentence => sentence?.be === "tool");
  assert.ok(toolEvent);
  assert.match(sentenceToPyash(toolEvent?.to?.la), /be error ya/);
  assert.ok(newspaper.some(sentence => sentence?.be === "end"));

  const resultPath = path.join(cwd, "artifacts", runId, "result.pya");
  assert.ok((await fs.stat(resultPath)).isFile());
  assert.ok(parsedFile(await fs.readFile(resultPath, "utf8")).length > 0);
});
