import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

test("run uses default sandbox cwd that works on host and container", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-run-command-default-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "ob text \"node --version\" to name text output be command do",
    "ob name output be write do"
  ].join("\n"), "utf8");

  const runPath = path.join(repoRoot, "run");
  const out = spawnSync(runPath, [programPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(out.status, 0, `expected command to run with default sandbox\nstderr:\n${out.stderr || ""}`);
  assert.match(out.stdout || "", /^v\d+/m, "expected node version output");
});
