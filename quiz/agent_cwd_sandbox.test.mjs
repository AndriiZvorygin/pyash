import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { resolveAgentPath } from "../program/library/agent_cwd.mjs";
import { resolveSandboxSettings } from "../program/verbs/command/sandbox.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("agent cwd scopes write output", async () => {
  forget();
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-cwd-"));
  await run(`exists su name agent sandbox ob boolean truth be default ya`);
  await run(`exists su name agent cwd ob filename "${agentDir}" be default ya`);
  await run('ob text "ok" to filename "note.txt" be write do');
  const expected = path.join(agentDir, "note.txt");
  const content = await fs.readFile(expected, "utf8");
  assert.equal(content, "ok");
});

test("agent cwd rejects outside paths", async () => {
  forget();
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-cwd-"));
  await run(`exists su name agent sandbox ob boolean truth be default ya`);
  await run(`exists su name agent cwd ob filename "${agentDir}" be default ya`);
  await assert.rejects(() => run('ob text "nope" to filename "../outside.txt" be write do'));
});

test("agent cwd sets download default output directory", async () => {
  forget();
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-cwd-"));
  const original = process.env.PYA_DOWNLOAD_RESPONSE;
  process.env.PYA_DOWNLOAD_RESPONSE = "ok";
  try {
    await run(`exists su name agent sandbox ob boolean truth be default ya`);
    await run(`exists su name agent cwd ob filename "${agentDir}" be default ya`);
    const result = await run('be download from filename "https://example.com/file.txt" as wo web do');
    const day = new Date();
    const dayStamp = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
    const expected = path.join(agentDir, "artifacts", dayStamp, "file.txt");
    const content = await fs.readFile(expected, "utf8");
    assert.equal(content, "ok");
    assert.equal(result?.value?.filename, expected);
  } finally {
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});

test("saddle file paths use project cwd and allow explicit home paths without widening shell roots", async () => {
  forget();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-path-project-"));
  const homeDir = await fs.mkdtemp(path.join(os.homedir(), ".pyash-saddle-file-access-"));
  await fs.writeFile(path.join(projectDir, "relative.md"), "project-relative\n", "utf8");
  await fs.writeFile(path.join(homeDir, "private.md"), "explicit-home\n", "utf8");
  const homeRelative = path.relative(os.homedir(), homeDir).split(path.sep).join("/");

  try {
    await run(`exists su name agent sandbox ob boolean truth be default ya`);
    await run(`exists su name agent cwd ob filename ${JSON.stringify(projectDir)} be default ya`);
    await run(`exists su name agent home file access ob boolean truth be default ya`);
    await run(`exists su name agent cwd strict relative paths ob boolean truth be default ya`);

    const projectRead = await run('be read from filename "relative.md" do');
    assert.equal(projectRead?.value?.text, "project-relative\n");
    const homeRead = await run(`be read from filename "~/${homeRelative}/private.md" do`);
    assert.equal(homeRead?.value?.text, "explicit-home\n");
    const absoluteHomeRead = await run(`be read from filename ${JSON.stringify(path.join(homeDir, "private.md"))} do`);
    assert.equal(absoluteHomeRead?.value?.text, "explicit-home\n");

    await run(`ob text "home-write" to filename "~/${homeRelative}/written.md" be write do`);
    assert.equal(await fs.readFile(path.join(homeDir, "written.md"), "utf8"), "home-write");
    const homeListing = await run(`be list from filename "~/${homeRelative}" do`);
    assert.ok(homeListing?.value?.ve?.values.includes("private.md"));
    assert.ok(homeListing?.value?.ve?.values.includes("written.md"));

    await assert.rejects(() => run('be read from filename "../outside.md" do'));
    await assert.rejects(() => run('ob text "blocked" to filename "../outside.md" be write do'));
    const workspaceOnly = resolveAgentPath(path.join(homeDir, "private.md"), { rememberFn: remember });
    assert.equal(workspaceOnly.outside, true, "other filesystem verbs must not inherit saddle home-file access");

    const sandbox = resolveSandboxSettings({ sentence: { be: "command", ob: { text: "pwd" } } });
    assert.equal(sandbox.cwd, projectDir);
    assert.ok(!sandbox.commandRoots.some((root) => path.resolve(root) === path.resolve(os.homedir())));
  } finally {
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
    forget();
  }
});
