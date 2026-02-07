import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("run_pya_program prints series result in block form with --result", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-run-series-format-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name result be series def",
    "su name item 1 ob text \"alpha\" be text ya",
    "su name item 2 ob text \"beta\" be text ya",
    "prah",
    ""
  ].join("\n"), "utf8");

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.join(path.dirname(__filename), "..");
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const { stdout } = await execFileAsync("node", [runPath, "--result", programPath], {
    cwd: tmpDir,
    timeout: 120000
  });

  assert.match(stdout, /su name result be series def/);
  assert.match(stdout, /su name item 1 ob text "alpha" be text ya/);
  assert.match(stdout, /su name item 2 ob text "beta" be text ya/);
  assert.match(stdout, /prah/);
});
