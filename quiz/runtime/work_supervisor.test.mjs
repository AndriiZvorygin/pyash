import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  enqueueWorkTask,
  claimOldestWorkTask,
  ensureWorkQueueDirs,
  queueDepth,
  taskFromText
} from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus, transitionWorkTaskStatus, updateWorkTaskCheckpoint } from "../../program/runtime/work/status.mjs";
import { failWorkTask, resumeWorkTask } from "../../program/runtime/work/operator.mjs";
import {
  DEFAULT_WORK_ROLE_CONFIG,
  parseEscalationReview,
  parseRoutineReview,
  probeWorkTaskAvailability,
  resolveWorkRoleConfig,
  runWorkSupervisorOnce
} from "../../program/runtime/work/supervisor.mjs";

test("default Luna launches use xhigh reasoning", () => {
  const roles = resolveWorkRoleConfig({}, {});
  assert.equal(DEFAULT_WORK_ROLE_CONFIG.worker.model, "gpt-5.6-luna");
  assert.equal(roles.worker.reasoningEffort, "xhigh");
  assert.equal(roles.planner.model, "gpt-5.6-sol");
  assert.equal(roles.implementer.model, "gpt-5.6-luna");
  assert.equal(roles.reviewer.model, "gpt-5.6-luna");
  assert.equal(roles.escalationReviewer.model, "gpt-5.6-sol");
  const overridden = resolveWorkRoleConfig({}, {
    PYA_CODEX_REVIEWER_MODEL: "reviewer-override",
    PYA_CODEX_REVIEWER_REASONING: "medium",
    PYA_CODEX_ESCALATION_REVIEWER_MODEL: "escalation-override",
    PYA_CODEX_ESCALATION_REVIEWER_REASONING: "low"
  });
  assert.deepEqual(overridden.reviewer, { model: "reviewer-override", reasoningEffort: "medium" });
  assert.deepEqual(overridden.escalationReviewer, { model: "escalation-override", reasoningEffort: "low" });
});

test("routine and escalation review parsers keep their decision contracts", () => {
  assert.deepEqual(parseRoutineReview("DECISION: REVISE\nRATIONALE: a concrete bug\nCORRECTION: fix the guard"), {
    decision: "REVISE",
    explanation: "a concrete bug",
    revisionInstructions: "fix the guard",
    escalationReason: ""
  });
  assert.deepEqual(parseRoutineReview("DECISION: BLOCK\nRATIONALE: semantic choice required"), {
    decision: "ESCALATE",
    explanation: "semantic choice required",
    revisionInstructions: "",
    escalationReason: ""
  });
  assert.equal(parseRoutineReview("The review is MAYBE; ACCEPT only when the criteria are satisfied.").decision, "ESCALATE");
  assert.deepEqual(parseEscalationReview("DECISION: REPLAN\nRATIONALE: work order is incomplete\nWORK ORDER: narrow the boundary"), {
    decision: "REPLAN",
    explanation: "work order is incomplete",
    revisionInstructions: "",
    workOrder: "narrow the boundary",
    escalationReason: ""
  });
});

test("availability probe classifies an existing active writer without starting a turn", async () => {
  let runTurnCalls = 0;
  let closeCalls = 0;
  const result = await probeWorkTaskAvailability({
    task: {
      status: "reviewing",
      checkpoint: {
        manager: { threadId: "sol-thread" },
        activeTurn: { role: "manager", phase: "review", threadId: "sol-thread" },
        workspace: { worktreePath: "/worktree/task" }
      }
    },
    appServerFactory: async () => ({
      async resumeThread() {
        throw new Error("thread sol-thread already has an active writer");
      },
      async runTurn() {
        runTurnCalls += 1;
      },
      async close() {
        closeCalls += 1;
      }
    })
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "active-writer");
  assert.equal(runTurnCalls, 0);
  assert.equal(closeCalls, 1);
});

test("an in-flight legacy Sol review remains resumable during reviewer migration", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-legacy-review-");
  await enqueueWorkTask(worldRoot, task("legacy-review-task"));
  await claimOldestWorkTask(worldRoot, { workerTag: "supervisor" });
  await transitionWorkTaskStatus(worldRoot, "legacy-review-task", "planning");
  await transitionWorkTaskStatus(worldRoot, "legacy-review-task", "implementing");
  await transitionWorkTaskStatus(worldRoot, "legacy-review-task", "reviewing");
  await updateWorkTaskCheckpoint(worldRoot, "legacy-review-task", {
    workspace: {
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/legacy-review",
      mode: "git-worktree"
    },
    manager: { threadId: "legacy-sol-thread" },
    plan: { workOrder: "review the preserved implementation" },
    implementation: { commit: "legacy-task-commit", reviewReady: true },
    review: { decision: "REVISE", explanation: "legacy review requested a correction", revisionInstructions: "verify the preserved result" }
  });
  const calls = [];
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    appServerFactory: async ({ role }) => ({
      async resumeThread() {},
      async runTurn(options) {
        calls.push({ role, options });
        return { turnId: "legacy-review-result", text: "DECISION: ACCEPT\nRATIONALE: preserved implementation is acceptable" };
      },
      async close() {}
    }),
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/legacy-review",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => ({ revision: "legacy-task-commit", diff: "+preserved", changedFiles: ["hello.txt"] }),
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(calls.map((call) => call.role), ["planner"]);
  const status = await readWorkTaskStatus(worldRoot, "legacy-review-task");
  assert.equal(status.checkpoint.review.role, "manager");
  assert.equal(status.checkpoint.reviewer.threadId, "");
});

async function makeWorldRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

function task(taskId) {
  return {
    taskId,
    owner: "background",
    kind: "roadmap",
    title: "Make one bounded change",
    queuedAt: "2026-08-07T12:00:00.000Z",
    acceptanceText: "The changed file exists and the targeted test passes.",
    promptText: "Make the precise small change described by the acceptance criteria.",
    contextText: "This is a fake App Server supervisor test.",
    workSpec: { source: "quiz", bounded: true },
    retryMax: 1
  };
}

class FakeClient {
  constructor(role, decisions = []) {
    this.role = role;
    this.decisions = decisions;
    this.turns = 0;
    this.calls = [];
  }

  async startThread(options) {
    this.calls.push({ method: "startThread", options });
    return { thread: { id: `${this.role}-thread` } };
  }

  async resumeThread(options) {
    this.calls.push({ method: "resumeThread", options });
    return { thread: { id: options.threadId } };
  }

  async runTurn(options) {
    this.calls.push({ method: "runTurn", options });
    this.turns += 1;
    if (["manager", "planner"].includes(this.role) && this.turns === 1) {
      return { turnId: "manager-plan", text: "SUMMARY: small plan\nWORK ORDER: edit hello.txt and run node test.mjs\nRISKS: none" };
    }
    if (["manager", "planner", "reviewer", "escalationReviewer"].includes(this.role)) {
      const decision = this.decisions.shift() || "ACCEPT";
      return {
        turnId: `${this.role}-review-${this.turns}`,
        text: `DECISION: ${decision}\nRATIONALE: review rationale\nCORRECTION: add the missing assertion`
      };
    }
    return {
      turnId: `worker-${this.turns}`,
      text: "SUMMARY: implemented the change\nCHANGED FILES: hello.txt\nTESTS: node test.mjs passes\nBLOCKERS: \nUNCERTAINTY: none",
      fileChanges: [{ path: "hello.txt", kind: "update", diff: "+hello" }]
    };
  }

  async close() {}
}

async function runFake(worldRoot, decisions, { onEvent = null, onClients = null, turnTimeoutMs, maxNoProgressPasses, roleDecisions = {} } = {}) {
  const clients = new Map();
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    roleConfig: {
      planner: { model: "manager-test", reasoningEffort: "low" },
      implementer: { model: "worker-test", reasoningEffort: "medium" },
      reviewer: { model: "reviewer-test", reasoningEffort: "medium" },
      escalationReviewer: { model: "escalation-test", reasoningEffort: "low" }
    },
    appServerFactory: async ({ role }) => {
      if (!clients.has(role)) clients.set(role, new FakeClient(role, [...(roleDecisions[role] || decisions)]));
      return clients.get(role);
    },
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => ({
      diff: "diff --git a/hello.txt b/hello.txt\n+hello",
      changedFiles: ["hello.txt"],
      revision: "task-revision"
    }),
    ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
    ...(maxNoProgressPasses ? { maxNoProgressPasses } : {}),
    onEvent,
    now: () => "2026-08-07T12:01:00.000Z"
  });
  onClients?.(clients);
  return result;
}

test("supervisor observer reports the useful lifecycle without token noise", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-events-");
  await enqueueWorkTask(worldRoot, task("event-task"));
  const events = [];
  const result = await runFake(worldRoot, ["ACCEPT"], {
    onEvent: async (event) => events.push(event)
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(events.map((event) => event.type), [
    "selected",
    "planning-started",
    "plan-completed",
    "implementation-started",
    "implementation-completed",
    "implementation-progress",
    "tests-reported",
    "diff-collected",
    "review-started",
    "review-completed",
    "accepted"
  ]);
  assert.equal(events.find((event) => event.type === "plan-completed").summary, "small plan");
  assert.deepEqual(events.find((event) => event.type === "tests-reported").tests, ["node test.mjs passes"]);
  assert.equal(events.find((event) => event.type === "review-completed").decision, "ACCEPT");
});

test("routine review uses an independent Luna thread and accepts without Sol escalation", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-independent-review-");
  await enqueueWorkTask(worldRoot, task("independent-review-task"));
  const events = [];
  const clients = new Map();
  const result = await runFake(worldRoot, ["ACCEPT"], {
    onEvent: async (event) => events.push(event),
    onClients: (value) => {
      for (const [role, client] of value) clients.set(role, client);
    }
  });
  assert.equal(result.status, "accepted");
  const status = await readWorkTaskStatus(worldRoot, "independent-review-task");
  assert.equal(status.checkpoint.manager.model, "manager-test");
  assert.equal(status.checkpoint.manager.reasoningEffort, "low");
  assert.equal(status.checkpoint.worker.model, "worker-test");
  assert.equal(status.checkpoint.worker.reasoningEffort, "medium");
  assert.equal(status.checkpoint.reviewer.model, "reviewer-test");
  assert.equal(status.checkpoint.reviewer.reasoningEffort, "medium");
  assert.equal(status.checkpoint.escalationReviewer.model, "escalation-test");
  assert.equal(status.checkpoint.review.role, "reviewer");
  assert.notEqual(status.checkpoint.reviewer.threadId, status.checkpoint.worker.threadId);
  assert.equal(status.checkpoint.escalationReviewer.threadId, "");
  assert.deepEqual(events.filter((event) => event.type === "review-completed").map((event) => event.role), ["reviewer"]);
  assert.equal(clients.has("escalationReviewer"), false);
});

test("routine Luna REVISE reuses independent reviewer and implementer without invoking Sol escalation", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-luna-revise-");
  await enqueueWorkTask(worldRoot, task("luna-revise-task"));
  const clients = new Map();
  const first = await runFake(worldRoot, ["REVISE", "ACCEPT"], {
    onClients: (value) => {
      for (const [role, client] of value) clients.set(role, client);
    }
  });
  assert.equal(first.status, "accepted");
  const status = await readWorkTaskStatus(worldRoot, "luna-revise-task");
  assert.equal(status.checkpoint.revisionCount, 1);
  assert.equal(clients.get("reviewer").turns, 2);
  assert.equal(clients.get("implementer").turns, 2);
  assert.equal(clients.has("escalationReviewer"), false);
  assert.equal(status.checkpoint.reviewer.threadId, "reviewer-thread");
  assert.equal(status.checkpoint.worker.threadId, "implementer-thread");
  assert.notEqual(status.checkpoint.reviewer.threadId, status.checkpoint.worker.threadId);
});

test("routine Luna ESCALATE invokes a distinct Sol escalation reviewer", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-escalation-");
  await enqueueWorkTask(worldRoot, task("escalation-task"));
  const events = [];
  const result = await runFake(worldRoot, ["ESCALATE"], {
    roleDecisions: { escalationReviewer: ["ACCEPT"] },
    onEvent: async (event) => events.push(event)
  });
  assert.equal(result.status, "accepted");
  const status = await readWorkTaskStatus(worldRoot, "escalation-task");
  assert.equal(status.checkpoint.routineReview.decision, "ESCALATE");
  assert.equal(status.checkpoint.escalationReview.decision, "ACCEPT");
  assert.equal(status.checkpoint.review.role, "escalationReviewer");
  assert.equal(status.checkpoint.reviewer.threadId, "reviewer-thread");
  assert.equal(status.checkpoint.escalationReviewer.threadId, "escalationReviewer-thread");
  assert.notEqual(status.checkpoint.reviewer.threadId, status.checkpoint.escalationReviewer.threadId);
  assert.deepEqual(events
    .filter((event) => ["review-completed", "escalation-review-completed"].includes(event.type))
    .map((event) => [event.role, event.decision]), [
      ["reviewer", "ESCALATE"],
      ["escalationReviewer", "ACCEPT"]
    ]);
});

test("reviewer ACCEPT is rejected when implementation evidence changes during review", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-stale-review-");
  await enqueueWorkTask(worldRoot, task("stale-review-task"));
  let evidenceCalls = 0;
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    roleConfig: {
      planner: { model: "manager-test", reasoningEffort: "low" },
      implementer: { model: "worker-test", reasoningEffort: "medium" },
      reviewer: { model: "reviewer-test", reasoningEffort: "medium" },
      escalationReviewer: { model: "escalation-test", reasoningEffort: "low" }
    },
    appServerFactory: async ({ role }) => new FakeClient(role, ["ACCEPT"]),
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/stale-review",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => {
      evidenceCalls += 1;
      return {
        diff: "diff --git a/hello.txt b/hello.txt\n+hello",
        changedFiles: ["hello.txt"],
        revision: evidenceCalls >= 3 ? "task-revision-after-review" : "task-revision"
      };
    },
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(result.status, "blocked");
  const status = await readWorkTaskStatus(worldRoot, "stale-review-task");
  assert.equal(status.checkpoint.review.decision, "");
  assert.equal(status.checkpoint.activeTurn.state, "completed");
  assert.equal(status.checkpoint.activeTurn.resultCaptured, false);
  assert.match(status.checkpoint.activeTurn.ambiguity, /stale because implementation evidence changed/iu);
});

test("supervisor passes the configured Codex turn timeout to every role", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-timeout-");
  await enqueueWorkTask(worldRoot, task("timeout-task"));
  const timeouts = [];
  const result = await runFake(worldRoot, ["ACCEPT"], {
    turnTimeoutMs: 900000,
    onClients: (clients) => {
      for (const client of clients.values()) {
        timeouts.push(...client.calls
          .filter((call) => call.method === "runTurn")
          .map((call) => call.options.timeoutMs));
      }
    }
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(timeouts, [900000, 900000, 900000]);
});

test("a timed-out worker preserves turn activity and worktree evidence", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-timeout-evidence-");
  await enqueueWorkTask(worldRoot, task("timeout-evidence-task"));
  const clients = new Map();
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    appServerFactory: async ({ role }) => {
      if (clients.has(role)) return clients.get(role);
      const client = {
        async startThread() { return { thread: { id: `${role}-thread` } }; },
        async runTurn(options) {
          if (role === "planner") return { turnId: "manager-plan", text: "SUMMARY: plan\nWORK ORDER: edit hello.txt\nRISKS: none" };
          const error = new Error("turn timeout (hard)");
          error.kind = "timeout";
          error.details = {
            timeoutType: "hard",
            timeoutMs: 1800000,
            hardTimeoutMs: 1800000,
            inactivityTimeoutMs: 900000,
            turnId: "worker-turn-1",
            lastActivityAt: "2026-08-07T12:15:00.000Z",
            eventCount: 7,
            meaningfulEventCount: 6,
            partialResult: {
              status: "in-progress",
              text: "SUMMARY: editing hello.txt",
              diff: "+hello",
              fileChanges: [{ path: "hello.txt", kind: "update" }]
            }
          };
          throw error;
        },
        async close() {}
      };
      clients.set(role, client);
      return client;
    },
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/timeout-evidence",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => ({
      status: " M hello.txt",
      diff: "diff --git a/hello.txt b/hello.txt\n+hello",
      changedFiles: ["hello.txt"],
      revision: "task-commit"
    }),
    turnTimeoutMs: 900000,
    turnInactivityTimeoutMs: 900000,
    turnHardTimeoutMs: 1800000,
    now: () => "2026-08-07T12:16:00.000Z"
  });
  assert.equal(result.status, "blocked");
  const stored = await readWorkTaskStatus(worldRoot, "timeout-evidence-task");
  assert.equal(stored.checkpoint.activeTurn.turnId, "worker-turn-1");
  assert.equal(stored.checkpoint.activeTurn.timeoutType, "hard");
  assert.equal(stored.checkpoint.activeTurn.hardTimeoutMs, 1800000);
  assert.equal(stored.checkpoint.activeTurn.meaningfulActivityCount, 6);
  assert.equal(stored.checkpoint.activeTurn.result.fileChanges[0].path, "hello.txt");
  assert.equal(stored.checkpoint.interruption.workspaceEvidence.revision, "task-commit");
  assert.deepEqual(stored.checkpoint.interruption.workspaceEvidence.changedFiles, ["hello.txt"]);
});

test("background supervisor checkpoints Luna and reuses the same thread before review", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-multiwake-");
  await enqueueWorkTask(worldRoot, task("multiwake-task"));
  const clients = new Map();
  const common = {
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    pauseAfterImplementation: true,
    reviewAfterImplementationPasses: 2,
    appServerFactory: async ({ role }) => {
      if (!clients.has(role)) clients.set(role, new FakeClient(role, ["ACCEPT"]));
      return clients.get(role);
    },
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => ({
      diff: "diff --git a/hello.txt b/hello.txt\n+hello",
      changedFiles: ["hello.txt"]
    }),
    now: () => "2026-08-07T12:01:00.000Z"
  };
  const first = await runWorkSupervisorOnce(common);
  assert.equal(first.status, "implementing");
  assert.equal((await readWorkTaskStatus(worldRoot, "multiwake-task")).checkpoint.implementation.passes, 1);
  const second = await runWorkSupervisorOnce(common);
  assert.equal(second.status, "accepted");
  const status = await readWorkTaskStatus(worldRoot, "multiwake-task");
  assert.equal(status.checkpoint.implementation.passes, 2);
  assert.equal(status.checkpoint.manager.threadId, "planner-thread");
  assert.equal(status.checkpoint.worker.threadId, "implementer-thread");
  assert.equal(clients.get("planner").turns, 1, "Sol plans once");
  assert.equal(clients.get("reviewer").turns, 1, "independent Luna reviews after implementation is ready");
  assert.equal(clients.get("implementer").turns, 2, "Luna continues across wakes");
});

test("supervisor persists Sol plan, Luna evidence, and ACCEPT review", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-accept-");
  await enqueueWorkTask(worldRoot, task("accept-task"));
  const result = await runFake(worldRoot, ["ACCEPT"]);
  assert.equal(result.status, "accepted");
  const status = await readWorkTaskStatus(worldRoot, "accept-task");
  assert.equal(status.status, "accepted");
  assert.equal(status.workSpec.source, "quiz");
  assert.equal(status.checkpoint.manager.model, "manager-test");
  assert.equal(status.checkpoint.worker.model, "worker-test");
  assert.equal(status.checkpoint.plan.workOrder, "edit hello.txt and run node test.mjs");
  assert.deepEqual(status.checkpoint.implementation.changedFiles, ["hello.txt"]);
  assert.equal(status.checkpoint.implementation.commit, "task-revision");
  assert.equal(status.checkpoint.review.decision, "ACCEPT");
  assert.equal(status.checkpoint.activeTurn.state, "");
  assert.equal(status.checkpoint.turnHistory.length, 3);
  assert.match(status.checkpoint.turnHistory[0].requestIdentity, /accept-task-planning-0/);
  assert.equal(status.checkpoint.turnHistory[0].resultCaptured, true);
  assert.equal((await queueDepth(worldRoot)).total, 0);
  const paths = await ensureWorkQueueDirs(worldRoot);
  const successFiles = await fs.readdir(paths.produceSuccessDir);
  const success = taskFromText(await fs.readFile(path.join(paths.produceSuccessDir, successFiles[0]), "utf8"));
  assert.equal(success.checkpoint.manager.threadId, "planner-thread");
  assert.equal(success.checkpoint.reviewer.threadId, "reviewer-thread");
  assert.equal(success.checkpoint.review.decision, "ACCEPT");
});

test("supervisor permits one REVISE loop before accepting", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-revise-");
  await enqueueWorkTask(worldRoot, task("revise-task"));
  const result = await runFake(worldRoot, ["REVISE", "ACCEPT"]);
  assert.equal(result.status, "accepted");
  const status = await readWorkTaskStatus(worldRoot, "revise-task");
  assert.equal(status.checkpoint.revisionCount, 1);
  assert.equal(status.checkpoint.review.decision, "ACCEPT");
  assert.equal((await queueDepth(worldRoot)).total, 0);
});

test("the default revision bound checkpoints concrete work instead of creating a human block", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-revision-continuation-");
  await enqueueWorkTask(worldRoot, task("revision-continuation-task"));
  const result = await runFake(worldRoot, ["REVISE", "REVISE", "REVISE", "REVISE"], {
    maxNoProgressPasses: 100
  });
  assert.equal(result.status, "revision");
  const status = await readWorkTaskStatus(worldRoot, "revision-continuation-task");
  assert.equal(status.status, "revision");
  assert.equal(status.checkpoint.revisionCount, 3);
  assert.equal(status.checkpoint.continuationCount, 1);
  assert.match(status.checkpoint.lastAction, /technical revision checkpoint/iu);
  assert.match(status.checkpoint.review.revisionInstructions, /missing assertion/iu);
});

test("two no-progress passes trigger focused Sol convergence before another Luna pass", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-convergence-");
  await enqueueWorkTask(worldRoot, task("convergence-task"));
  await claimOldestWorkTask(worldRoot, { workerTag: "test" });
  await transitionWorkTaskStatus(worldRoot, "convergence-task", "planning");
  await transitionWorkTaskStatus(worldRoot, "convergence-task", "implementing");
  await transitionWorkTaskStatus(worldRoot, "convergence-task", "revision");
  const stored = await readWorkTaskStatus(worldRoot, "convergence-task");
  await updateWorkTaskCheckpoint(worldRoot, "convergence-task", {
    workspace: {
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    },
    manager: { threadId: "manager-thread" },
    worker: { threadId: "worker-thread" },
    plan: { workOrder: "make the correction" },
    review: { decision: "REVISE", revisionInstructions: "make the correction" },
    implementation: {
      passes: 2,
      passHistory: [
        { pass: 1, state: "completed", at: "2026-08-07T12:00:00.000Z", material: false, materialReasons: [], noDeltaReason: "same evidence" },
        { pass: 2, state: "completed", at: "2026-08-07T12:01:00.000Z", material: false, materialReasons: [], noDeltaReason: "same evidence" },
        ],
      consecutiveNoProgressPasses: 2,
      noProgressPasses: 2
    }
  });
  const calls = [];
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    maxNoProgressPasses: 2,
    appServerFactory: async ({ role }) => ({
      async startThread({ role }) { return { thread: { id: `${role}-thread` } }; },
      async resumeThread() {},
      async runTurn(options) {
        const input = options.input?.[0]?.text || "";
        calls.push({ role, input });
        if (role === "escalationReviewer" && /focused convergence review/iu.test(input)) {
          return { turnId: "convergence-review", text: "DECISION: CONTINUE\nRATIONALE: narrow correction is executable\nCORRECTION: fix the one remaining assertion" };
        }
        if (role === "planner") return { turnId: "legacy-final-review", text: "DECISION: ACCEPT\nRATIONALE: focused correction is verified" };
        if (role === "reviewer") return { turnId: "final-review", text: "DECISION: ACCEPT\nRATIONALE: focused correction is verified" };
        return { turnId: "worker-correction", text: "SUMMARY: fixed the remaining assertion\nCHANGED FILES: hello.txt\nTESTS: targeted assertion passes\nBLOCKERS: \nUNCERTAINTY: none\nCOMMIT: def5678", fileChanges: [{ path: "hello.txt" }] };
      },
      async close() {}
    }),
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => ({ diff: "diff --git a/hello.txt b/hello.txt\n+fixed", changedFiles: ["hello.txt"], revision: "def5678" }),
    now: () => "2026-08-07T12:02:00.000Z"
  });
  assert.equal(result.status, "accepted");
  assert.equal(calls.filter((call) => call.role === "escalationReviewer" && /focused convergence review/iu.test(call.input)).length, 1);
  assert.equal(calls.filter((call) => call.role === "implementer").length, 1);
  const final = await readWorkTaskStatus(worldRoot, "convergence-task");
  assert.equal(final.checkpoint.convergence.decision, "CONTINUE");
  assert.equal(final.checkpoint.convergence.reviewCount, 1);
  assert.equal(final.checkpoint.implementation.materialProgressPasses, 1);
  assert.equal(final.checkpoint.turnHistory.filter((turn) => turn.phase === "convergence-review").length, 1);
});

test("supervisor preserves a BLOCK review as a durable terminal decision", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-block-");
  await enqueueWorkTask(worldRoot, task("block-task"));
  const result = await runFake(worldRoot, ["BLOCK"]);
  assert.equal(result.status, "blocked");
  const status = await readWorkTaskStatus(worldRoot, "block-task");
  assert.equal(status.status, "blocked");
  assert.equal(status.checkpoint.review.decision, "BLOCK");
  assert.equal((await queueDepth(worldRoot)).runtime, 1);
  await resumeWorkTask(worldRoot, "block-task", "Human confirmed the external dependency is now available.");
  assert.equal((await readWorkTaskStatus(worldRoot, "block-task")).status, "ready");
});

test("supervisor does not replay an ambiguous in-flight turn until a human resumes it", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-ambiguous-");
  await enqueueWorkTask(worldRoot, task("ambiguous-task"));
  let turnCalls = 0;
  const first = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    appServerFactory: async () => ({
      async startThread() { return { thread: { id: "manager-thread" } }; },
      async runTurn() {
        turnCalls += 1;
        const error = new Error("app-server process exited after turn start");
        error.kind = "process-exit";
        throw error;
      },
      async close() {}
    }),
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    }),
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(first.status, "blocked");
  assert.equal(turnCalls, 1);
  const repeated = await runWorkSupervisorOnce({ worldRoot, repositoryRoot: "/repo", owner: "background" });
  assert.equal(repeated.status, "blocked");
  assert.equal(turnCalls, 1);
  const resumed = await resumeWorkTask(worldRoot, "ambiguous-task", "Retry this turn after checking the worktree.");
  assert.equal(resumed.status, "ready");
  assert.equal(resumed.checkpoint.turnHistory[0].state, "abandoned");
});

test("supervisor consumes a durable completed turn result after a checkpoint boundary", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-captured-");
  await enqueueWorkTask(worldRoot, task("captured-task"));
  await claimOldestWorkTask(worldRoot, { workerTag: "supervisor" });
  await transitionWorkTaskStatus(worldRoot, "captured-task", "planning");
  await transitionWorkTaskStatus(worldRoot, "captured-task", "implementing");
  await updateWorkTaskCheckpoint(worldRoot, "captured-task", {
    workspace: {
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    },
    manager: { threadId: "manager-thread" },
    worker: { threadId: "worker-thread" },
    plan: { workOrder: "make the change" },
    activeTurn: {
      phase: "implementation",
      role: "worker",
      threadId: "worker-thread",
      turnId: "worker-turn-1",
      requestIdentity: "pyash-captured-task-implementation-0-0-0",
      state: "completed",
      startedAt: "2026-08-07T12:00:00.000Z",
      completedAt: "2026-08-07T12:00:30.000Z",
      resultCaptured: false,
      result: {
        status: "completed",
        text: "SUMMARY: recovered implementation\nCHANGED FILES: hello.txt\nTESTS: node test.mjs passes\nBLOCKERS: \nUNCERTAINTY: none",
        fileChanges: [{ path: "hello.txt", kind: "update", diff: "+hello" }]
      }
    }
  });
  const calls = { planner: 0, implementer: 0, reviewer: 0 };
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    appServerFactory: async ({ role }) => ({
      async startThread() { return { thread: { id: `${role}-thread` } }; },
      async resumeThread() {},
      async runTurn() {
        calls[role] += 1;
        if (role === "implementer") throw new Error("implementer turn must not be replayed");
        return { turnId: "review-turn-1", text: "DECISION: ACCEPT\nRATIONALE: recovered result is sufficient" };
      },
      async close() {}
    }),
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => ({ diff: "+hello", changedFiles: ["hello.txt"] }),
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(result.status, "accepted");
  assert.equal(calls.implementer, 0);
  assert.equal(calls.planner, 0);
  assert.equal(calls.reviewer, 1);
  const status = await readWorkTaskStatus(worldRoot, "captured-task");
  assert.equal(status.checkpoint.activeTurn.state, "");
  assert.equal(status.checkpoint.turnHistory.find((turn) => turn.turnId === "worker-turn-1").resultCaptured, true);
});

test("operator failure cancels an unclaimed task into the fail spool", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-cancel-");
  await enqueueWorkTask(worldRoot, task("cancel-task"));
  const failed = await failWorkTask(worldRoot, "cancel-task", "operator cancelled this task");
  assert.equal(failed.status, "failed");
  assert.equal((await queueDepth(worldRoot)).total, 0);
  assert.equal((await readWorkTaskStatus(worldRoot, "cancel-task")).error, "operator cancelled this task");
});

test("usage-limited work remains in runtime with a resumable checkpoint", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-limit-");
  await enqueueWorkTask(worldRoot, task("limited-task"));
  let limited = true;
  const clients = new Map();
  const appServerFactory = async ({ role }) => {
    if (!clients.has(role)) {
      const client = new FakeClient(role, ["ACCEPT"]);
      const runTurn = client.runTurn.bind(client);
      client.runTurn = async (options) => {
        if (limited) {
          const err = new Error("quota reset required");
          err.kind = "usage-limited";
          throw err;
        }
        return runTurn(options);
      };
      clients.set(role, client);
    }
    return clients.get(role);
  };
  const common = {
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    appServerFactory,
    workspaceFactory: async () => ({
      repository: "/repo",
      baseRevision: "base-1",
      branch: "detached",
      worktreePath: "/worktree/task",
      mode: "git-worktree"
    }),
    evidenceFactory: async () => ({ diff: "+hello", changedFiles: ["hello.txt"] }),
    now: () => "2026-08-07T12:01:00.000Z"
  };
  const first = await runWorkSupervisorOnce(common);
  assert.equal(first.status, "usage-limited");
  assert.equal((await queueDepth(worldRoot)).runtime, 1);
  assert.equal((await readWorkTaskStatus(worldRoot, "limited-task")).status, "usage-limited");

  limited = false;
  clients.clear();
  const resumed = await runWorkSupervisorOnce(common);
  assert.equal(resumed.status, "accepted");
  assert.equal((await queueDepth(worldRoot)).total, 0);
});
