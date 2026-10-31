import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decideAuditDue, DEFAULT_COMMIT_THRESHOLD } from "../command/example_audit_due.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the audit runs on the monthly schedule and on demand", () => {
  for (const event of ["schedule", "workflow_dispatch"]) {
    const verdict = decideAuditDue({ event, last: "abc123", commitsSince: 0 });
    assert.equal(verdict.run, true, `${event} should run the audit`);
  }
});

test("a push that is not due yet does not run the audit", () => {
  const verdict = decideAuditDue({ event: "push", last: "abc123", commitsSince: 99 });
  assert.equal(verdict.run, false);
  assert.match(verdict.reason, /not due yet/u);
});

test("one commit reads as one commit", () => {
  const verdict = decideAuditDue({ event: "push", last: "abc123", commitsSince: 1 });
  assert.match(verdict.reason, /1 commit has landed/u);
  assert.doesNotMatch(verdict.reason, /1 commits/u);
});

test("a push that has landed a hundred commits runs the audit", () => {
  const verdict = decideAuditDue({ event: "push", last: "abc123", commitsSince: 100 });
  assert.equal(verdict.run, true);
  assert.match(verdict.reason, /100 commits/u);
});

test("the threshold is a hundred commits", () => {
  assert.equal(DEFAULT_COMMIT_THRESHOLD, 100);
});

test("an unknown last audit runs the audit rather than skipping it", () => {
  // A skip that cannot be justified is a silent gap in the coverage.
  const verdict = decideAuditDue({ event: "push", last: "", commitsSince: null });
  assert.equal(verdict.run, true);
});

test("a count that could not be measured runs the audit", () => {
  const verdict = decideAuditDue({ event: "push", last: "abc123", commitsSince: null });
  assert.equal(verdict.run, true);
});

test("the command prints the decision on its first line", async () => {
  const out = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "command", "example_audit_due.mjs"), "--event", "schedule"],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout.split("\n")[0], "run=true");
});
