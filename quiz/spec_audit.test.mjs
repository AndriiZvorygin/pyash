import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("spec audit passes constraints for specification folder", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..");
  const run = spawnSync("node", ["command/spec_audit.mjs"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /spec audit ok/);
});
