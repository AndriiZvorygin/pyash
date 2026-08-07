import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  enqueueWorkTask,
  ensureWorkQueueDirs,
  queueDepth,
  taskFromText
} from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus } from "../../program/runtime/work/status.mjs";
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

async function runFake(worldRoot, decisions) {
  const clients = new Map();
  return runWorkSupervisorOnce({
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
      changedFiles: ["hello.txt"]
    }),
    now: () => "2026-08-07T12:01:00.000Z"
  });
}

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
  assert.equal(status.checkpoint.review.decision, "ACCEPT");
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

test("supervisor preserves a BLOCK review as a durable terminal decision", async () => {
  const worldRoot = await makeWorldRoot("pyash-supervisor-block-");
  await enqueueWorkTask(worldRoot, task("block-task"));
  const result = await runFake(worldRoot, ["BLOCK"]);
  assert.equal(result.status, "blocked");
  const status = await readWorkTaskStatus(worldRoot, "block-task");
  assert.equal(status.status, "blocked");
  assert.equal(status.checkpoint.review.decision, "BLOCK");
  assert.equal((await queueDepth(worldRoot)).total, 0);
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
