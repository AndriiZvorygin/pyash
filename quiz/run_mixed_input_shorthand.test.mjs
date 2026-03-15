import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

test("run_pya_program.mjs binds mixed shorthand positional inputs in declaration order", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mixed-inputs-"));
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const programPath = path.join(tmpDir, "program.pya");
  const inputDir = path.join(tmpDir, "know", "input");
  const inputPath = path.join(inputDir, "topic.txt");
  const artifactDir = path.join(tmpDir, "artifacts", "mixed-inputs-test");
  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.writeFile(inputPath, "topic fixture\n", "utf8");
    await fs.writeFile(programPath, [
      "ob ve filename text source text text hook_hint be input ya",
      'ob text "hook=" to name text result be text do ya',
      "ob name text hook_hint to name result be plus do ya"
    ].join("\n"), "utf8");
    const out = spawnSync(process.execPath, [runPath, "--run-id", "mixed-inputs-test", programPath, inputPath, "armor of light"], {
      cwd: tmpDir,
      encoding: "utf8"
    });
    assert.equal(out.status, 0, `expected mixed shorthand input run to pass\nstderr:\n${out.stderr || ""}`);
    const artifactText = await fs.readFile(path.join(artifactDir, "produce.txt"), "utf8");
    assert.equal(artifactText.trim(), "hook=armor of light");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
