import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runAudit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "command", "audit_examples.mjs"), ...args],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// One example that runs and one that does not, in a folder of their own so
// the audit only sees these two.
async function makeExampleFolder() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-audit-"));
  await fs.copyFile(
    path.join(repoRoot, "examples", "pyash", "add-basic.pya"),
    path.join(dir, "passes.pya")
  );
  await fs.writeFile(
    path.join(dir, "breaks.pya"),
    [
      "exists su name collector ob num 7 be number ya",
      "ob num 2 to name collector be nosuchverb do",
      "su name collector ob what que",
      ""
    ].join("\n"),
    "utf8"
  );
  return dir;
}

test("the audit prints the failures, not one line per example", async () => {
  // The audit runs every example through the real runner, so it takes about
  // twelve minutes. A line per example makes a run that has nothing to report
  // expensive to read, so only the failures are printed.
  const dir = await makeExampleFolder();
  try {
    const { code, stdout, stderr } = await runAudit(["--dir", dir]);
    assert.equal(stderr, "", `the audit should not write to stderr: ${stderr}`);
    assert.match(stdout, /examples audit: \d+ passed, 1 failed/u);
    assert.match(stdout, /breaks\.pya/u, "the failing example should be named");
    assert.doesNotMatch(
      stdout,
      /^\s*ok\s+passes\.pya/mu,
      "an example that passed should not be printed"
    );
    assert.equal(code, 1, "a new failure should fail the run");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("the audit leaves the per-example detail in the report file", async () => {
  // Quiet output must not throw the detail away: the report holds every
  // example, so a reader who wants the whole picture reads one file.
  const dir = await makeExampleFolder();
  try {
    await runAudit(["--dir", dir]);
    const reportPath = path.join(path.dirname(dir), "out", "example-audit.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    assert.equal(report.total, 2);
    assert.equal(report.passed, 1);
    assert.equal(report.failed, 1);
    const names = report.results.map((entry) => entry.file).sort();
    assert.deepEqual(names, ["breaks.pya", "passes.pya"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(path.join(path.dirname(dir), "out"), { recursive: true, force: true });
  }
});
