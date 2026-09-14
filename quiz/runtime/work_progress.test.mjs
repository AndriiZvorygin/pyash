import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyImplementationPass,
  deriveImplementationProgress
} from "../../program/runtime/work/progress.mjs";

function turn(text, at, turnId = "turn") {
  return {
    phase: "implementation",
    state: "completed",
    turnId,
    completedAt: at,
    result: { text, diff: "", fileChanges: [] }
  };
}

test("implementation progress counts commits and ignores repeated verification", () => {
  const first = turn([
    "SUMMARY: implemented the envelope fix",
    "CHANGED FILES: program/runtime/mind.mjs",
    "TESTS: 10 passed, 1 failing acceptance test now passes",
    "COMMIT: abc1234",
    "REVIEW READY: yes",
    "BLOCKERS: none"
  ].join("\n"), "2026-08-17T01:00:00.000Z", "one");
  const initial = classifyImplementationPass({
    pass: 1,
    at: first.completedAt,
    turn: first,
    report: {
      summary: "implemented the envelope fix",
      commit: "abc1234",
      changedFiles: ["program/runtime/mind.mjs"],
      tests: ["10 passed, 1 failing acceptance test now passes"],
      blockers: "",
      reviewReady: true,
      fileChanges: []
    },
    baseRevision: "base"
  });
  assert.equal(initial.material, true);
  assert.match(initial.materialReasons.join(","), /new commit/iu);

  const repeated = turn([
    "SUMMARY: no changes were needed; worktree remains clean",
    "CHANGED FILES: program/runtime/mind.mjs",
    "TESTS: 10 passed, 1 failing acceptance test now passes",
    "COMMIT: abc1234",
    "REVIEW READY: yes",
    "BLOCKERS: none"
  ].join("\n"), "2026-08-17T02:00:00.000Z", "two");
  const next = classifyImplementationPass({
    pass: 2,
    at: repeated.completedAt,
    turn: repeated,
    report: {
      summary: "no changes were needed; worktree remains clean",
      commit: "abc1234",
      changedFiles: ["program/runtime/mind.mjs"],
      tests: ["10 passed, 1 failing acceptance test now passes"],
      blockers: "",
      reviewReady: true,
      fileChanges: []
    },
    previousHistory: [initial],
    baseRevision: "base"
  });
  assert.equal(next.material, false);
  assert.match(next.noDeltaReason, /same commit/iu);
});

test("historical turn records distinguish one abandoned turn from material and no-delta passes", () => {
  const checkpoint = {
    turnHistory: [
      { phase: "implementation", state: "abandoned", completedAt: "2026-08-17T00:00:00.000Z", result: { text: "" } },
      turn("SUMMARY: fixed the failing acceptance test\nTESTS: 1 passed\nCOMMIT: abc1234", "2026-08-17T01:00:00.000Z", "one"),
      turn("SUMMARY: repeats completed work; no changes were needed\nTESTS: 1 passed\nCOMMIT: abc1234", "2026-08-17T02:00:00.000Z", "two")
    ]
  };
  const progress = deriveImplementationProgress(checkpoint);
  assert.equal(progress.implementationPasses, 2);
  assert.equal(progress.materialProgressPasses, 1);
  assert.equal(progress.noProgressPasses, 1);
  assert.equal(progress.consecutiveNoProgressPasses, 1);
  assert.equal(progress.commitsProduced, 1);
  assert.equal(progress.passHistory.filter((entry) => entry.state === "abandoned").length, 1);
});
