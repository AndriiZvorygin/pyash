import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const checkerPath = path.resolve("command/check_local_config_safety.mjs");

function runChecker(rootDir) {
  return spawnSync(process.execPath, [checkerPath, "--root", rootDir], {
    encoding: "utf8"
  });
}

test("config safety checker passes when secret file is missing", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-config-safe-missing-"));
  const out = runChecker(rootDir);
  assert.equal(out.status, 0);
  assert.match(String(out.stdout ?? ""), /config safety: skip/i);
});

test("config safety checker fails when secret file contains container hosts", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-config-safe-fail-"));
  const configDir = path.join(rootDir, "configure");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, "secret.pya"),
    'exists su name ollama host ob text "http://host.docker.internal:11434" be default ya\n',
    "utf8"
  );
  const out = runChecker(rootDir);
  assert.notEqual(out.status, 0);
  assert.match(String(out.stderr ?? ""), /config safety: fail/i);
  assert.match(String(out.stderr ?? ""), /host\.docker\.internal/i);
});

test("config safety checker passes when secret file is host-safe", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-config-safe-pass-"));
  const configDir = path.join(rootDir, "configure");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, "secret.pya"),
    'exists su name ollama host ob text "http://localhost:11434" be default ya\n',
    "utf8"
  );
  const out = runChecker(rootDir);
  assert.equal(out.status, 0);
  assert.match(String(out.stdout ?? ""), /config safety: pass/i);
});
