import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { command } from "../program/verbs/command.mjs";

function assertCommandSucceeded(result) {
  assert.equal(result?.be, "command");
  assert.equal(typeof result?.ob?.text, "string");
}

async function makeTempRunRoot() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-run-root-"));
  const commandDir = path.join(tempRoot, "command");
  await fs.mkdir(commandDir, { recursive: true });
  await fs.writeFile(
    path.join(commandDir, "probe.mjs"),
    'console.log("probe-ok");\n',
    "utf8"
  );
  return tempRoot;
}

test("command executes quoted command text and returns stdout", async () => {
  process.env.PYA_COMMAND_RESPONSE = "hi";
  const sentence = parse(
    "ob wo quoted.command.printf hi.command.quoted be command do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.ob?.text ?? result?.value?.text, "hi");
  delete process.env.PYA_COMMAND_RESPONSE;
});

test("command direct node uses process exec path when PATH is empty", async () => {
  const priorPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const sentence = parse(
      "ob wo quoted.command.node -p 6*7.command.quoted be command do"
    );
    const result = await command(sentence, { remember: () => null });
    assertCommandSucceeded(result);
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
  }
});

test("command rewrites node command/* to run-root relative path from agent cwd", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-agent-"));
  const agentCwd = path.join(tempRoot, "world", "house", "tester");
  await fs.mkdir(agentCwd, { recursive: true });
  const rememberFn = (name) => {
    if (name === "agent sandbox") return { ob: { boolean: true } };
    if (name === "agent cwd") return { ob: { filename: agentCwd } };
    if (name === "run root") return { ob: { filename: process.cwd() } };
    if (name === "world root") return { ob: { filename: path.join(tempRoot, "world") } };
    if (name === "agent name") return { ob: { text: "tester" } };
    return null;
  };
  try {
    const sentence = parse("ob wo quoted.command.node command/pyash.mjs --help.command.quoted be command do");
    const result = await command(sentence, { remember: rememberFn });
    assertCommandSucceeded(result);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("command rewrites node command/* using world root when run root is missing", async () => {
  const tempRoot = await makeTempRunRoot();
  const agentCwd = path.join(tempRoot, "sandpit");
  await fs.mkdir(agentCwd, { recursive: true });
  try {
    const rememberFn = (name) => {
      if (name === "agent sandbox") return { ob: { boolean: true } };
      if (name === "agent cwd") return { ob: { filename: agentCwd } };
      if (name === "world root") return { ob: { filename: path.join(tempRoot, "world") } };
      return null;
    };
    const sentence = parse("ob wo quoted.command.node command/probe.mjs.command.quoted be command do");
    const result = await command(sentence, { remember: rememberFn });
    assertCommandSucceeded(result);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("command rewrites node command/* by discovering run root from agent cwd", async () => {
  const tempRoot = await makeTempRunRoot();
  const agentCwd = path.join(tempRoot, "world", "house", "pyash-agent");
  await fs.mkdir(agentCwd, { recursive: true });
  try {
    const rememberFn = (name) => {
      if (name === "agent sandbox") return { ob: { boolean: true } };
      if (name === "agent cwd") return { ob: { filename: agentCwd } };
      return null;
    };
    const sentence = parse("ob wo quoted.command.node command/probe.mjs.command.quoted be command do");
    const result = await command(sentence, { remember: rememberFn });
    assertCommandSucceeded(result);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
