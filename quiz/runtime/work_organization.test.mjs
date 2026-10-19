import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  WORK_STATUS_NAMES,
  buildWorkTask,
  appendWorkTaskDelegationEvent
} from "../../program/runtime/work/contract.mjs";
import {
  ackWorkTaskFail,
  claimOldestWorkTask,
  enqueueWorkTask,
  ensureWorkQueueDirs
} from "../../program/runtime/work/queue.mjs";
import {
  readWorkTaskStatus,
  updateWorkTaskCheckpoint
} from "../../program/runtime/work/status.mjs";
import { recordWorkTaskDelegationEvent } from "../../program/runtime/work/operator.mjs";
import { appendWorkOutcome } from "../../program/runtime/work/outcome.mjs";

async function makeWorldRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-work-organization-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

function delegatedTask() {
  return {
    taskId: "correspondence-domain-task",
    owner: "correspondence worker",
    kind: "correspondence",
    title: "Prepare the fixture correspondence response",
    priority: 72,
    queuedAt: "2026-08-23T13:00:00.000Z",
    acceptanceText: "The correspondence response is checkpointed and reviewable.",
    promptText: "Prepare the response and preserve the source evidence.",
    retryMax: 2,
    source: {
      identity: "fixture-mail:message-001",
      kind: "fixture-mail",
      locator: "fixture://mail/message-001"
    },
    domain: "correspondence",
    deadline: "2026-08-24T17:00:00.000Z",
    dependencies: ["intake-task", "intake-task", "classification-task"],
    delegatedBy: "chief of staff",
    escalation: {
      state: "watching",
      target: "chief of staff",
      reason: "deadline requires review",
      timestamp: "2026-08-23T13:01:00.000Z",
      sourceIdentity: "fixture-mail:message-001"
    },
    delegationEvents: [
      {
        type: "assigned",
        timestamp: "2026-08-23T13:02:00.000Z",
        actor: "chief of staff",
        recipient: "correspondence worker",
        note: "Please prepare a response.",
        sourceIdentity: "fixture-mail:message-001"
      },
      {
        type: "accepted",
        timestamp: "2026-08-23T13:03:00.000Z",
        actor: "correspondence worker",
        recipient: "chief of staff",
        note: "Work accepted for handling.",
        sourceIdentity: "fixture-mail:message-001"
      }
    ],
    checkpoint: {
      workspace: { repository: "/repo", baseRevision: "abc123", mode: "git-worktree" },
      plan: { summary: "Prepare the correspondence response." },
      implementation: { summary: "Checkpointed before first attempt.", tests: ["node --test"] },
      lastAction: "delegated task checkpoint"
    }
  };
}

test("domain-aware delegated task survives claim, retry, checkpoint and newspaper paths", async () => {
  const worldRoot = await makeWorldRoot();
  const input = delegatedTask();
  await enqueueWorkTask(worldRoot, input);

  const claimed = await claimOldestWorkTask(worldRoot, { workerTag: "correspondence" });
  assert.equal(claimed.task.taskId, input.taskId);
  assert.equal(claimed.task.owner, "correspondence worker");
  assert.equal(claimed.task.priority, 72);

  await updateWorkTaskCheckpoint(worldRoot, input.taskId, {
    implementation: { summary: "Checkpoint updated before the first retry." },
    lastAction: "operator checkpoint"
  });
  const progressed = await recordWorkTaskDelegationEvent(worldRoot, input.taskId, {
    type: "progress-reported",
    timestamp: "2026-08-23T13:04:00.000Z",
    actor: "correspondence worker",
    recipient: "chief of staff",
    note: "Source checked; response draft is in progress."
  });
  assert.equal(progressed.status, "ready");
  assert.equal(progressed.delegationEvents.at(-1).sourceIdentity, input.source.identity);

  await ackWorkTaskFail(worldRoot, {
    runtimePath: claimed.path,
    retryCount: progressed.retryCount,
    retryMax: progressed.retryMax
  });
  const retryClaim = await claimOldestWorkTask(worldRoot, { workerTag: "correspondence-retry" });
  assert.equal(retryClaim.task.retryCount, 1);
  assert.equal(retryClaim.task.status, "ready");
  assert.equal(retryClaim.task.owner, "correspondence worker");
  assert.equal(retryClaim.task.priority, 72);
  assert.deepEqual(retryClaim.task.dependencies, ["intake-task", "classification-task"]);
  assert.deepEqual(retryClaim.task.source, input.source);
  assert.equal(retryClaim.task.domain, "correspondence");
  assert.equal(retryClaim.task.deadline, input.deadline);
  assert.equal(retryClaim.task.delegatedBy, "chief of staff");
  assert.equal(retryClaim.task.escalation.reason, "deadline requires review");
  assert.deepEqual(retryClaim.task.delegationEvents.map((event) => event.type), [
    "assigned", "accepted", "progress-reported"
  ]);
  assert.equal(retryClaim.task.checkpoint.workspace.baseRevision, "abc123");
  assert.equal(retryClaim.task.checkpoint.implementation.summary, "Checkpoint updated before the first retry.");
  assert.equal(retryClaim.task.checkpoint.lastAction, "operator checkpoint");

  const completed = await recordWorkTaskDelegationEvent(worldRoot, input.taskId, {
    type: "completed",
    timestamp: "2026-08-23T13:05:00.000Z",
    actor: "correspondence worker",
    recipient: "chief of staff",
    note: "Response draft is ready."
  });
  assert.equal(completed.status, "ready");
  assert.notEqual(completed.status, "accepted");
  assert.deepEqual(completed.delegationEvents.map((event) => event.type), [
    "assigned", "accepted", "progress-reported", "completed"
  ]);

  const current = await readWorkTaskStatus(worldRoot, input.taskId);
  const paths = await ensureWorkQueueDirs(worldRoot);
  const runtimeText = await fs.readFile(retryClaim.path, "utf8");
  const statusText = await fs.readFile(path.join(paths.artifactsDir, "task", `${input.taskId}.pya`), "utf8");
  assert.match(runtimeText, /work task organization/);
  assert.match(statusText, /work task organization/);
  assert.equal(current.retryCount, 1);
  assert.equal(current.status, "ready");

  const newspaper = await appendWorkOutcome(worldRoot, current, {
    action: "completed",
    reason: "ordinary work outcome"
  });
  const newspaperText = await fs.readFile(newspaper, "utf8");
  assert.match(newspaperText, /source identity/);
  assert.match(newspaperText, /fixture-mail:message-001/);
  assert.match(newspaperText, /correspondence/);
  assert.match(newspaperText, /chief of staff/);
  assert.match(newspaperText, /deadline requires review/);
  assert.match(newspaperText, /progress-reported/);
  assert.match(newspaperText, /completed/);
});

test("work organization rejects invalid deadlines and delegation event types without adding statuses", () => {
  const statuses = ["ready", "planning", "implementing", "reviewing", "revision", "blocked", "usage-limited", "accepted", "failed"];
  assert.deepEqual(WORK_STATUS_NAMES, statuses);
  assert.throws(
    () => buildWorkTask({ ...delegatedTask(), deadline: "not-an-iso-timestamp" }),
    /invalid deadline/
  );
  assert.throws(
    () => buildWorkTask({ ...delegatedTask(), delegationEvents: [{ type: "invented" }] }),
    /invalid delegation event type/
  );
  const original = buildWorkTask(delegatedTask());
  const appended = appendWorkTaskDelegationEvent(original, {
    type: "accepted",
    timestamp: "2026-08-23T13:06:00.000Z",
    actor: "correspondence worker",
    recipient: "chief of staff"
  });
  assert.equal(appended.status, original.status);
  assert.equal(appended.delegationEvents.length, original.delegationEvents.length + 1);
});
