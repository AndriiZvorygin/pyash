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
  const stderr = String(out.stderr ?? "");
  assert.notEqual(out.status, 0);
  assert.match(stderr, /config safety: fail/i, `expected failure banner in stderr\n${stderr}`);
  assert.match(stderr, /host\.docker\.internal/i, `expected violating host marker in stderr\n${stderr}`);
  assert.match(stderr, /how to fix:/i, `expected remediation section in stderr\n${stderr}`);
  assert.match(
    stderr,
    /Move container routing values from configure\/secret\.pya to configure\/container\.pya/i,
    `expected explicit move instruction in stderr\n${stderr}`
  );
  assert.match(stderr, /Re-run: npm run config:safety/i, `expected explicit re-run instruction in stderr\n${stderr}`);
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
