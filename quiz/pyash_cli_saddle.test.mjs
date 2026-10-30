import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pyash saddle launches the terminal coding saddle", () => {
  const result = spawnSync(process.execPath, ["command/pyash.mjs", "saddle"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "pyash saddle requires an interactive terminal");
});
