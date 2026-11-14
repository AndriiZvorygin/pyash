import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSweepPostRestartReviewIdentity,
  buildSweepRecoveryPrompt,
  buildSweepPostRestartReviewPrompt,
  buildSweepResumeCommand,
  isPostRestartReviewPending,
  mayReviewRestartedSweep,
  mayResumeSweep,
  parseSweepPostRestartReview,
  parseSweepRecoveryDecision,
  readSweepRecoveryConfig
} from "../world/house/refinery-watchdog/program/wordnet-sweep-recovery.mjs";

const inspection = {
  state: "stopped",
  runId: "wordnet-sense-compounds-test",
  active: false,
  conflictingLiveLock: false,
  remainingSenseCount: 54_035,
  artifactDirectory: "/repo/artifacts/wordnet-sense-compounds-test",
  lockPath: "/repo/artifacts/.wordnet-sense-compound-refinery.lock",
  lastActivityFile: "sweep-supervised.log",
  lastActivityAt: "2026-11-13T09:51:18.527Z",
  idleMs: 1_044_000
};

test("recovery prompt carries the Pyash run context, failure evidence, and exact safe resume path", () => {
  const prompt = buildSweepRecoveryPrompt({
    inspection,
    context: {
      purpose: "frequency-ordered WordNet synset coverage sweep",
      invariants: "Keep accepted rows append-only and reuse the same run id.",
      resumeProcedure: "Run the stable resume entry point under tmux."
    },
    housekeeper: { host: "mriczo:18886", healthy: true, queued: 3, running: 2, activeSweepDuties: [{ handleId: "wordnet-sense-test", status: "running" }] },
    recentFailure: "Error: platform defective: kwon lookup index has an invalid header",
    resumeCommand: "node world/house/refinery-watchdog/program/resume-wordnet-sweep.mjs"
  });

  assert.match(prompt, /frequency-ordered WordNet synset coverage sweep/u);
  assert.match(prompt, /wordnet-sense-compounds-test/u);
  assert.match(prompt, /54,035/u);
  assert.match(prompt, /mriczo:18886/u);
  assert.match(prompt, /invalid header/u);
  assert.match(prompt, /resume-wordnet-sweep\.mjs/u);
  assert.match(prompt, /same run id/u);
  assert.match(prompt, /no queued\/running WordNet sweep duty/u);
  assert.match(prompt, /"activeSweepDuties"/u);
  assert.match(prompt, /JSON/u);
});

test("Spark-X recovery output accepts a JSON object surrounded by short model chatter", () => {
  assert.deepEqual(parseSweepRecoveryDecision(
    'Assessment: safe to continue.\n```json\n{"assessment":"stopped","action":"resume","reason":"The stable run is incomplete and has no live lock."}\n```'
  ), {
    assessment: "stopped",
    action: "resume",
    reason: "The stable run is incomplete and has no live lock.",
    rootCauseHypothesis: "",
    fixPlan: "",
    testPlan: ""
  });
});

test("recovery decisions reject malformed JSON and unsupported actions", () => {
  assert.throws(() => parseSweepRecoveryDecision("not json"), /invalid recovery decision/u);
  assert.throws(() => parseSweepRecoveryDecision(
    '{"assessment":"stopped","action":"delete artifacts","reason":"bad"}'
  ), /unsupported recovery action/u);
});

test("post-restart review prompt compares the original failure to fresh batch evidence", () => {
  const prompt = buildSweepPostRestartReviewPrompt({
    inspection,
    context: {
      purpose: "frequency-ordered WordNet coverage",
      invariants: "same run id, append-only evidence",
      postRestartReview: "record root cause, fix, and tests"
    },
    recovery: { decisionAt: "before", restartVerifiedAt: "after", remainingAtRestart: 54_035, batchCountAtRestart: 11 },
    recentFailure: "prior invalid index header",
    recentProgress: "batchCount=12 remaining=53,971"
  });
  assert.match(prompt, /separate post-restart review/u);
  assert.match(prompt, /prior invalid index header/u);
  assert.match(prompt, /batchCount=12/u);
  assert.match(prompt, /focused regression tests/u);
  assert.match(prompt, /Do not edit files/u);
  assert.match(prompt, /"activeProcess": false/u);
  assert.match(prompt, /"lockPath"/u);
  assert.match(prompt, /an active process is not an absent lock/u);
});

test("post-restart review parses noisy JSON and rejects malformed fields", () => {
  assert.deepEqual(parseSweepPostRestartReview(
    'Review:\n```json\n{"root_cause":"stale index header","confidence":"medium","evidence":["fresh batch passed"],"fix_plan":"add header regression","test_plan":["node --test quiz/index.test.mjs"]}\n```'
  ), {
    rootCause: "stale index header",
    confidence: "medium",
    evidence: ["fresh batch passed"],
    fixPlan: "add header regression",
    testPlan: ["node --test quiz/index.test.mjs"]
  });
  assert.throws(() => parseSweepPostRestartReview("{bad json"), /expected a JSON object/u);
  assert.throws(() => parseSweepPostRestartReview(
    '{"root_cause":"x","confidence":"certain","evidence":[],"fix_plan":"x","test_plan":[]}'
  ), /unsupported post-restart review confidence/u);
});

test("post-restart review recovers only a missing outer brace and leaves truncated values rejected", () => {
  const complete = '{"root_cause":"index header","confidence":"high","evidence":["sweep resumed"],"fix_plan":"none","test_plan":["node --test quiz/index.test.mjs"]}';
  assert.deepEqual(parseSweepPostRestartReview(complete.slice(0, -1)), {
    rootCause: "index header",
    confidence: "high",
    evidence: ["sweep resumed"],
    fixPlan: "none",
    testPlan: ["node --test quiz/index.test.mjs"]
  });
  assert.throws(() => parseSweepPostRestartReview(
    '{"root_cause":"truncated value,"confidence":"high","evidence":[],"fix_plan":"none","test_plan":[]'
  ), /expected a JSON object/u);
});

test("a post-restart review parse failure stays eligible for a later retry", () => {
  assert.equal(isPostRestartReviewPending("pending"), true);
  assert.equal(isPostRestartReviewPending("retry-pending"), true);
  assert.equal(isPostRestartReviewPending("review-failed"), true);
  assert.equal(isPostRestartReviewPending("reviewed"), false);
});

test("post-restart Housekeeper retries receive distinct idempotency identities", () => {
  const base = { runId: inspection.runId, restartVerifiedAt: "2026-11-13T05:17:32Z" };
  assert.notEqual(
    buildSweepPostRestartReviewIdentity({ ...base, attemptId: "attempt-one" }),
    buildSweepPostRestartReviewIdentity({ ...base, attemptId: "attempt-two" })
  );
});

test("only a stopped incomplete run with healthy Housekeeper evidence can resume", () => {
  const decision = { assessment: "stopped", action: "resume", reason: "resume the same run" };
  assert.equal(mayResumeSweep({ inspection, decision, housekeeperHealthy: true }), true);
  assert.equal(mayResumeSweep({ inspection: { ...inspection, state: "healthy", active: true }, decision, housekeeperHealthy: true }), false);
  assert.equal(mayResumeSweep({ inspection: { ...inspection, conflictingLiveLock: true }, decision, housekeeperHealthy: true }), false);
  assert.equal(mayResumeSweep({ inspection: { ...inspection, remainingSenseCount: 0 }, decision, housekeeperHealthy: true }), false);
  assert.equal(mayResumeSweep({ inspection, decision, housekeeperHealthy: false }), false);
  assert.equal(mayResumeSweep({ inspection, decision, housekeeperHealthy: true, housekeeperHasActiveSweepDuty: true }), false);
  assert.equal(mayResumeSweep({ inspection, decision: { ...decision, action: "wait" }, housekeeperHealthy: true }), false);
});

test("resume command uses the persistent tmux supervisor, fixture-free environment, and stable run id", () => {
  const command = buildSweepResumeCommand({
    runId: "wordnet-sense-compounds-test",
    repositoryRoot: "/repo",
    resumeEntryPoint: "/repo/world/house/refinery-watchdog/program/resume-wordnet-sweep.mjs",
    artifactDirectory: "/repo/artifacts/wordnet-sense-compounds-test",
    nodeBin: "/usr/bin/node",
    environment: {
      PYA_MIND_RESPONSE: "fixture",
      PYA_OTHER_FIXTURE: "fixture",
      PYA_GPU_HOUSEKEEPER_FIXTURE: "fixture",
      HOME: "/tmp"
    }
  });
  assert.equal(command.sessionName, "wordnet-sense-compounds-test");
  assert.match(command.shellCommand, /--max-old-space-size=3072/u);
  assert.deepEqual(command.tmuxArgs.slice(0, 6), ["new-session", "-d", "-s", "wordnet-sense-compounds-test", "-c", "/repo"]);
  assert.match(command.shellCommand, /resume-wordnet-sweep\.mjs/u);
  assert.match(command.shellCommand, /PYA_MIND_RESPONSE/u);
  assert.match(command.shellCommand, /PYA_GPU_HOUSEKEEPER_FIXTURE/u);
  assert.match(command.shellCommand, /PYA_OTHER_FIXTURE/u);
  assert.match(command.shellCommand, /sweep-supervised\.log/u);
  assert.match(command.shellCommand, /^exec 'env'/u);
});

test("Pyash recovery configuration selects Spark-X and records a bounded recovery policy", () => {
  const config = readSweepRecoveryConfig();
  assert.equal(config.model, "SparkLLM/Spark-X2.6-4B:q4_k_m");
  assert.match(config.context.resumeProcedure, /same run id/u);
  assert.match(config.context.resumeProcedure, /resume-wordnet-sweep\.mjs/u);
});

test("post-restart review waits for a fresh batch on the resumed active run", () => {
  const recovery = { reviewState: "pending", remainingAtRestart: 54_000 };
  const activeInspection = { state: "healthy", active: true };
  assert.equal(mayReviewRestartedSweep({ inspection: activeInspection, recovery, latestBatchEvent: { remainingSenseCount: 53_936 } }), true);
  assert.equal(mayReviewRestartedSweep({ inspection: activeInspection, recovery: { ...recovery, reviewState: "retry-pending" }, latestBatchEvent: { remainingSenseCount: 53_936 } }), true);
  assert.equal(mayReviewRestartedSweep({ inspection: activeInspection, recovery: { ...recovery, reviewState: "review-failed" }, latestBatchEvent: { remainingSenseCount: 53_936 } }), true);
  assert.equal(mayReviewRestartedSweep({ inspection: activeInspection, recovery, latestBatchEvent: { remainingSenseCount: 54_000 } }), false);
  assert.equal(mayReviewRestartedSweep({ inspection: activeInspection, recovery: { ...recovery, reviewState: "reviewed" }, latestBatchEvent: { remainingSenseCount: 53_936 } }), false);
  assert.equal(mayReviewRestartedSweep({ inspection: { state: "stopped", active: false }, recovery, latestBatchEvent: { remainingSenseCount: 53_936 } }), false);
});
