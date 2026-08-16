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
import { runWorkSupervisorOnce } from "../../program/runtime/work/supervisor.mjs";

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
    if (this.role === "manager" && this.turns === 1) {
      return { turnId: "manager-plan", text: "SUMMARY: small plan\nWORK ORDER: edit hello.txt and run node test.mjs\nRISKS: none" };
    }
    if (this.role === "manager") {
      const decision = this.decisions.shift() || "ACCEPT";
      return {
        turnId: `manager-review-${this.turns}`,
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

async function runFake(worldRoot, decisions, { onEvent = null, onClients = null, turnTimeoutMs } = {}) {
  const clients = new Map();
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    roleConfig: {
      manager: { model: "manager-test", reasoningEffort: "low" },
      worker: { model: "worker-test", reasoningEffort: "medium" }
    },
    appServerFactory: async ({ role }) => {
      if (!clients.has(role)) clients.set(role, new FakeClient(role, [...decisions]));
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
  assert.equal(status.checkpoint.manager.threadId, "manager-thread");
  assert.equal(status.checkpoint.worker.threadId, "worker-thread");
  assert.equal(clients.get("manager").turns, 2, "Sol plans once and reviews after implementation is ready");
  assert.equal(clients.get("worker").turns, 2, "Luna continues across wakes");
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
  assert.equal(success.checkpoint.manager.threadId, "manager-thread");
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
  const result = await runFake(worldRoot, ["REVISE", "REVISE", "REVISE", "REVISE"]);
  assert.equal(result.status, "revision");
  const status = await readWorkTaskStatus(worldRoot, "revision-continuation-task");
  assert.equal(status.status, "revision");
  assert.equal(status.checkpoint.revisionCount, 3);
  assert.equal(status.checkpoint.continuationCount, 1);
  assert.match(status.checkpoint.lastAction, /technical revision checkpoint/iu);
  assert.match(status.checkpoint.review.revisionInstructions, /missing assertion/iu);
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
  const calls = { manager: 0, worker: 0 };
  const result = await runWorkSupervisorOnce({
    worldRoot,
    repositoryRoot: "/repo",
    owner: "background",
    appServerFactory: async ({ role }) => ({
      async resumeThread() {},
      async runTurn() {
        calls[role] += 1;
        if (role === "worker") throw new Error("worker turn must not be replayed");
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
  assert.equal(calls.worker, 0);
  assert.equal(calls.manager, 1);
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
