import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cliPath = path.resolve("command/pyash.mjs");

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    ...opts
  });
}

test("pyash verify passes valid pyash file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-verify-ok-"));
  const filePath = path.join(tmpDir, "ok.pya");
  await fs.writeFile(filePath, "exists su name alpha ob num 1 be number ya\n", "utf8");

  const run = runCli(["verify", filePath]);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /su name verify produce/);
  assert.match(run.stdout, /exactly num 0/);
  assert.match(run.stdout, /from filename/);
  assert.match(run.stdout, /vyah success/);
  assert.match(run.stdout, /be series def/);
  assert.match(run.stdout, /prah/);
});

test("pyash verify fails invalid mood sentence", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-verify-fail-"));
  const filePath = path.join(tmpDir, "bad.pya");
  await fs.writeFile(filePath, "exists su name alpha ob num 1 be number nope\n", "utf8");

  const run = runCli(["verify", filePath]);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /su name verify produce/);
  assert.match(run.stdout, /exactly num 1/);
  assert.match(run.stdout, /from filename/);
  assert.match(run.stdout, /vyah fail/);
  assert.match(run.stdout, /be series def/);
  assert.match(run.stdout, /su name verify defective/);
  assert.match(run.stdout, /be error ya/);
  assert.match(run.stdout, /mood_defective:/);
});

test("pyash verify emits json payload when requested", async () => {
  const run = runCli(["verify", "--text", "su name alpha ob num 1 be number nope", "--json"]);
  assert.equal(run.status, 1);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.route, "verify");
  assert.ok(payload.issueCount > 0);
  assert.equal(payload.series?.be, "series");
  assert.equal(payload.series?.mood, "ya");
});
