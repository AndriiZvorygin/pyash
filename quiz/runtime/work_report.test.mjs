import test from "node:test";
import assert from "node:assert/strict";

import {
  diffStat,
  renderWorkDeferredReport,
  renderWorkIdleReport,
  renderWorkTaskReport
} from "../../program/runtime/work/report.mjs";

function task(status = "accepted") {
  return {
    taskId: "report-task",
    title: "Close a small parity gap",
    priority: 120,
    status,
    startedAt: "2026-08-08T12:00:00.000Z",
    finishedAt: status === "accepted" ? "2026-08-08T12:10:00.000Z" : "",
    checkpoint: {
      manager: { model: "gpt-5.6-sol" },
      worker: { model: "gpt-5.6-luna" },
      plan: {
        summary: "Add the missing parity assertion.",
        workOrder: "Update the test and run the focused quiz."
      },
      implementation: {
        summary: "Added the assertion and ran the focused quiz.",
        changedFiles: ["quiz/parity.test.mjs"],
        tests: ["node --test quiz/parity.test.mjs: PASS"],
        diff: "diff --git a/quiz/parity.test.mjs b/quiz/parity.test.mjs\n-old\n+new"
      },
      review: { decision: "ACCEPT", explanation: "The acceptance criterion is satisfied." },
      workspace: { worktreePath: "/tmp/worktrees/report-task" }
    }
  };
}

test("work report renders durable plan, evidence, review, and diff stat", () => {
  const report = renderWorkTaskReport(task());
  assert.match(report, /Result: ACCEPTED/);
  assert.match(report, /Sol plan:\n  Add the missing parity assertion\./);
  assert.match(report, /Sol work order:\n  Update the test and run the focused quiz\./);
  assert.match(report, /quiz\/parity\.test\.mjs/);
  assert.match(report, /node --test quiz\/parity\.test\.mjs: PASS/);
  assert.match(report, /Sol review:\n  ACCEPT/);
  assert.match(report, /Diff: 1 file changed, \+1 -1/);
  assert.match(report, /Worktree: \/tmp\/worktrees\/report-task/);
});

test("work report clips long explicit output at a readable boundary", () => {
  const long = `${"first line\n".repeat(200)}WORK ORDER:\nshould not be mixed into the summary`;
  const report = renderWorkTaskReport({
    ...task(),
    checkpoint: {
      ...task().checkpoint,
      plan: { summary: long, workOrder: "Run the focused quiz." }
    }
  });
  assert.doesNotMatch(report, /WORK ORDER:\n  should not be mixed/);
  assert.match(report, /Sol work order:\n  Run the focused quiz\./);
  assert.match(report, /\.\.\. \[truncated\]/);
});

test("work report represents deferred capacity without a task checkpoint", () => {
  const report = renderWorkDeferredReport({
    result: { reason: "foreground reserve", eligible: 2 },
    capacity: { state: "available", remainingPercent: 12 }
  });
  assert.match(report, /Result: DEFERRED/);
  assert.match(report, /Reason: foreground reserve/);
  assert.match(report, /Remaining capacity: 12%/);
});

test("work report represents an empty backlog as idle", () => {
  const report = renderWorkIdleReport({
    result: { reason: "no eligible work", eligible: 0 },
    capacity: { usedPercent: 37, resetAt: "2026-08-09T03:00:00.000Z" }
  });
  assert.match(report, /Result: IDLE/);
  assert.match(report, /Reason: no eligible work/);
  assert.match(report, /Codex usage: 37% used/);
});

test("accepted work report does not present a prior blocker as a current operator note", () => {
  const accepted = task();
  accepted.message = "The acceptance rationale.";
  accepted.checkpoint.blocker = "a prior timeout";
  const report = renderWorkTaskReport(accepted);
  assert.doesNotMatch(report, /Operator note/);
});

test("diff stat counts files and excludes diff headers", () => {
  assert.equal(diffStat("diff --git a/a b/a\n--- a/a\n+++ b/a\n-old\n+new", []), "1 file changed, +1 -1");
});
