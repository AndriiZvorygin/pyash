import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

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
    await run('be download from filename "https://example.com/file.txt" as wo web do');
    const expected = path.join(agentDir, "file.txt");
    const content = await fs.readFile(expected, "utf8");
    assert.equal(content, "ok");
  } finally {
    if (original === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = original;
  }
});
