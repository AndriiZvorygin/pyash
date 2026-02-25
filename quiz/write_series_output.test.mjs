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

test("write on series name prints full series sentence", async () => {
  forget();

  await run("su name session be series def");
  await run('su name one ob text "alpha" be text ya');
  await run('su name two ob text "beta" be text ya');
  await run("prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob name session be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.match(logs[0], /^su name session be series def/);
  assert.match(logs[0], /su name one ob text "alpha" be text ya/);
  assert.match(logs[0], /su name two ob text "beta" be text ya/);
  assert.match(logs[0], /prah$/);
});

test("write on series name to filename persists .series.pya text", async () => {
  forget();

  await run("su name session be series def");
  await run('su name one ob text "alpha" be text ya');
  await run('su name two ob text "beta" be text ya');
  await run("prah");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-series-write-"));
  const outPath = path.join(tmpDir, "session.series.pya");
  await run(`ob name session to filename "${outPath}" be write do`);

  const text = await fs.readFile(outPath, "utf8");
  assert.match(text, /^su name session be series def/m);
  assert.match(text, /su name one ob text "alpha" be text ya/m);
  assert.match(text, /su name two ob text "beta" be text ya/m);
  assert.match(text, /prah\s*$/m);
});
