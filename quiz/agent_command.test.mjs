import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseAgentCommandArgs, createAgentCommand } from "../command/pyash/agent_command.mjs";

test("parse agent command args supports codex passthrough after --", () => {
  const parsed = parseAgentCommandArgs([
    "ccrc",
    "--codex",
    "--status",
    "--root", "/workplace",
    "--tools-map", "agent tools",
    "--codex-home", "agent",
    "--",
    "resume",
    "--last"
  ]);
  assert.equal(parsed.agentName, "ccrc");
  assert.equal(parsed.codex, true);
  assert.equal(parsed.status, true);
  assert.equal(parsed.root, "/workplace");
  assert.equal(parsed.toolsMap, "agent tools");
  assert.equal(parsed.codexHome, "agent");
  assert.equal(parsed.noMcp, false);
  assert.deepEqual(parsed.codexArgs, ["resume", "--last"]);
});

test("parse agent command args supports no-mcp and equals forms", () => {
  const parsed = parseAgentCommandArgs([
    "ccrc",
    "--codex",
    "--root=/workplace",
    "--tools-map=ops",
    "--codex-home=/tmp/codex-home",
    "--no-mcp",
    "resume",
    "--last"
  ]);
  assert.equal(parsed.agentName, "ccrc");
  assert.equal(parsed.codex, true);
  assert.equal(parsed.status, false);
  assert.equal(parsed.root, "/workplace");
  assert.equal(parsed.toolsMap, "ops");
  assert.equal(parsed.codexHome, "/tmp/codex-home");
  assert.equal(parsed.noMcp, true);
  assert.deepEqual(parsed.codexArgs, ["resume", "--last"]);
});

test("agent command defaults to global codex home for normal codex runs", async () => {
  const calls = [];
  const projections = [];
  const out = [];
  const priorHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = "";
    const agentCommand = createAgentCommand({
      resolveRootDirFromArgs: async () => "/workplace",
      resolveConfiguredAgentHouse: (worldRoot, agentName) => path.join(worldRoot, "house", agentName),
      pathExists: async () => true,
      codexCommand: async (args, options) => {
        calls.push({ args, options });
        return 0;
      },
      projectCodexRunToPyash: async (payload) => {
        projections.push(payload);
      },
      installRoot: "/workplace",
      textOut: (value) => out.push(String(value ?? ""))
    });

    const code = await agentCommand(["ccrc", "--codex", "--", "resume", "--last"]);
    assert.equal(code, 0);
    assert.equal(out.length, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "--root", "/workplace",
      "--tools-map", "agent tools",
      "resume",
      "--last"
    ]);
    assert.equal(calls[0].options.installRoot, "/workplace");
    assert.equal(calls[0].options.cwd, "/workplace/world/house/ccrc");
    assert.equal(calls[0].options.envOverrides, null);
    assert.equal(projections.length, 1);
    assert.equal(projections[0].codexHome.endsWith("/.codex"), true);
  } finally {
    process.env.CODEX_HOME = priorHome;
  }
});

test("agent command uses agent codex home for --oss runs", async () => {
  const calls = [];
  const projections = [];
  const out = [];
  const priorHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = "";
    const agentCommand = createAgentCommand({
      resolveRootDirFromArgs: async () => "/workplace",
      resolveConfiguredAgentHouse: (worldRoot, agentName) => path.join(worldRoot, "house", agentName),
      pathExists: async () => true,
      codexCommand: async (args, options) => {
        calls.push({ args, options });
        return 0;
      },
      projectCodexRunToPyash: async (payload) => {
        projections.push(payload);
      },
      installRoot: "/workplace",
      textOut: (value) => out.push(String(value ?? ""))
    });

    const code = await agentCommand(["ccrc", "--codex", "--", "--oss", "resume", "--last"]);
    assert.equal(code, 0);
    assert.equal(out.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.envOverrides?.CODEX_HOME, "/workplace/world/house/ccrc/.codex");
    assert.equal(projections[0].codexHome, "/workplace/world/house/ccrc/.codex");
  } finally {
    process.env.CODEX_HOME = priorHome;
  }
});

test("agent command resume uses projected session id when available", async () => {
  const calls = [];
  const out = [];
  const priorHome = process.env.CODEX_HOME;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-codex-resume-"));
  const agentHouse = path.join(root, "world", "house", "ccrc");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.writeFile(
    path.join(agentHouse, "conduct", "codex_projection.pya"),
    [
      "su name codex projection be map def",
      "  su name last session id ob text \"019c6bd2-6d4d-7f23-a21e-42bcca38c2c3\" ya",
      "prah",
      ""
    ].join("\n"),
    "utf8"
  );
  try {
    process.env.CODEX_HOME = "";
    const agentCommand = createAgentCommand({
      resolveRootDirFromArgs: async () => root,
      resolveConfiguredAgentHouse: (worldRoot, agentName) => path.join(worldRoot, "house", agentName),
      pathExists: async () => true,
      codexCommand: async (args, options) => {
        calls.push({ args, options });
        return 0;
      },
      projectCodexRunToPyash: async () => {},
      installRoot: "/workplace",
      textOut: (value) => out.push(String(value ?? ""))
    });
    const code = await agentCommand(["ccrc", "--codex", "--", "resume"]);
    assert.equal(code, 0);
    assert.equal(out.length, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "--root", root,
      "--tools-map", "agent tools",
      "resume",
      "019c6bd2-6d4d-7f23-a21e-42bcca38c2c3"
    ]);
  } finally {
    process.env.CODEX_HOME = priorHome;
  }
});

test("agent command resume falls back to --last when no projection exists", async () => {
  const calls = [];
  const out = [];
  const priorHome = process.env.CODEX_HOME;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-codex-resume-last-"));
  try {
    process.env.CODEX_HOME = "";
    const agentCommand = createAgentCommand({
      resolveRootDirFromArgs: async () => root,
      resolveConfiguredAgentHouse: (worldRoot, agentName) => path.join(worldRoot, "house", agentName),
      pathExists: async () => true,
      codexCommand: async (args, options) => {
        calls.push({ args, options });
        return 0;
      },
      projectCodexRunToPyash: async () => {},
      installRoot: "/workplace",
      textOut: (value) => out.push(String(value ?? ""))
    });
    const code = await agentCommand(["ccrc", "--codex", "--", "resume"]);
    assert.equal(code, 0);
    assert.equal(out.length, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "--root", root,
      "--tools-map", "agent tools",
      "resume",
      "--last"
    ]);
  } finally {
    process.env.CODEX_HOME = priorHome;
  }
});

test("agent command status prints projection summary without launching codex", async () => {
  const calls = [];
  const projections = [];
  const out = [];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-codex-status-"));
  const agentHouse = path.join(root, "world", "house", "ccrc");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  await fs.mkdir(path.join(agentHouse, "session"), { recursive: true });
  await fs.writeFile(
    path.join(agentHouse, "conduct", "codex_projection.pya"),
    [
      "su name codex projection be map def",
      "  su name last session id ob text \"019c6bd2-6d4d-7f23-a21e-42bcca38c2c3\" ya",
      "  su name last session file ob text \"/tmp/fake.jsonl\" ya",
      "  su name last projected count ob text \"2\" ya",
      "prah",
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(agentHouse, "session", "20260217-codex_019c6bd2.pya"),
    "su name test since date 2026-02-17 be series def\n",
    "utf8"
  );

  const agentCommand = createAgentCommand({
    resolveRootDirFromArgs: async () => root,
    resolveConfiguredAgentHouse: (worldRoot, agentName) => path.join(worldRoot, "house", agentName),
    pathExists: async () => true,
    codexCommand: async (args, options) => {
      calls.push({ args, options });
      return 0;
    },
    projectCodexRunToPyash: async (payload) => {
      projections.push(payload);
    },
    installRoot: "/workplace",
    textOut: (value) => out.push(String(value ?? ""))
  });
  const code = await agentCommand(["ccrc", "--codex", "--status"]);
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.equal(projections.length, 0);
  assert.equal(out.some((line) => line.includes("last codex session id: 019c6bd2-6d4d-7f23-a21e-42bcca38c2c3")), true);
  assert.equal(out.some((line) => line.includes("latest pyash codex session:")), true);
});
