import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(".");
const fixturePath = path.join(repoRoot, "quiz", "fixtures", "legacy-command-audit.pya");

test("replay accepts the pre-identity command-audit newspaper fixture", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-identity-legacy-"));
  await fs.mkdir(path.join(runRoot, "newspaper"), { recursive: true });
  const fixture = await fs.readFile(fixturePath, "utf8");
  await fs.writeFile(path.join(runRoot, "newspaper", "identity.pya"), fixture, "utf8");
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(repoRoot, "command", "replay_newspaper.mjs"),
    "--run-id", "identity",
    "--run-root", runRoot
  ], { cwd: repoRoot });
  assert.match(stdout, /be replay ya/u);
});
