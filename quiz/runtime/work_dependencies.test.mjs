import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runWorkBackgroundOnce } from "../../program/runtime/work/runner.mjs";
import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import { curateWorkBacklog } from "../../program/runtime/work/curator.mjs";
import {
  roadmapDependencyStatus,
  validateRoadmapDependencies
} from "../../program/runtime/work/roadmap.mjs";

async function world(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  return { worldRoot, repositoryRoot };
}

function capacity() {
  return {
    state: "available",
    usedPercent: 0,
    remainingPercent: 100,
    weekly: {
      identified: true,
      state: "available",
      usedPercent: 0,
      remainingPercent: 100,
      windowStartAt: "2026-08-17T12:00:00.000Z",
      resetAt: "2026-08-24T12:00:00.000Z"
    }
  };
}

function task(taskId, priority = 100) {
  return {
    taskId,
    owner: "background",
    kind: "roadmap",
    title: taskId,
    priority,
    queuedAt: "2026-08-23T11:00:00.000Z",
    promptText: `Implement ${taskId}.`,
    acceptanceText: "Focused acceptance tests pass."
  };
}

async function queueTask(worldRoot, taskId, priority = 100) {
  await enqueueWorkTask(worldRoot, task(taskId, priority));
  return readWorkTaskStatus(worldRoot, taskId);
}

async function markAccepted(worldRoot, taskId, { integrated = false } = {}) {
  const current = await readWorkTaskStatus(worldRoot, taskId);
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    status: "accepted",
    checkpoint: {
      ...current.checkpoint,
      integration: integrated
        ? { status: "integrated", commit: `${taskId}-task`, branchCommit: `${taskId}-baseline` }
        : { status: "revision", commit: `${taskId}-task` }
    }
  });
}

async function blockWithLiveTurn(worldRoot, taskId) {
  const current = await readWorkTaskStatus(worldRoot, taskId);
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    status: "blocked",
    message: "turn timeout",
    checkpoint: {
      ...current.checkpoint,
      blocker: "turn timeout",
      activeTurn: { turnId: `${taskId}-turn`, startedAt: "2026-08-23T11:59:59.500Z" }
    }
  });
}

async function runSelection(worldRoot, repositoryRoot, now = "2026-08-23T12:00:00.000Z") {
  const calls = [];
  const result = await runWorkBackgroundOnce({
    worldRoot,
    repositoryRoot,
    owner: "background",
    policy: { enabled: true, staleOperationalTurnMs: 900000, maxOperationalRecoveries: 2 },
    capacitySource: async () => capacity(),
    supervisor: async ({ taskId }) => {
      calls.push(taskId);
      return { claimed: true, taskId, status: "implementing" };
    },
    now
  });
  return { result, calls };
}

test("an incomplete prerequisite keeps its dependent package from starting", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-deps-incomplete-");
  await queueTask(worldRoot, "hq-organization-and-work-contract", 72);
  await queueTask(worldRoot, "hq-fixture-mail-vertical-slice", 71);
  const organization = await readWorkTaskStatus(worldRoot, "hq-organization-and-work-contract");
  const fixture = await readWorkTaskStatus(worldRoot, "hq-fixture-mail-vertical-slice");
  const dependency = roadmapDependencyStatus(
    { taskId: "hq-fixture-mail-vertical-slice", dependsOnTaskIds: ["hq-organization-and-work-contract"] },
    { tasks: [organization, fixture], packages: [
      { taskId: "hq-organization-and-work-contract", dependsOnTaskIds: [] },
      { taskId: "hq-fixture-mail-vertical-slice", dependsOnTaskIds: ["hq-organization-and-work-contract"] }
    ] }
  );
  assert.equal(dependency.satisfied, false);
  assert.match(dependency.unmet[0].reason, /status is ready/u);
});

test("a temporarily unavailable prerequisite does not starve an independent package", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-deps-fallback-");
  await queueTask(worldRoot, "hq-organization-and-work-contract", 72);
  await blockWithLiveTurn(worldRoot, "hq-organization-and-work-contract");
  await queueTask(worldRoot, "hq-fixture-mail-vertical-slice", 71);
  await queueTask(worldRoot, "roadmap-command-result-identity", 75);
  const { result, calls } = await runSelection(worldRoot, repositoryRoot);
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "roadmap-command-result-identity");
  assert.deepEqual(calls, ["roadmap-command-result-identity"]);
});

test("a dependent active task does not prevent promotion of an independent candidate", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-deps-promotion-");
  await fs.writeFile(
    path.join(repositoryRoot, "documentation", "todo.md"),
    "Introduce result tracking with per-command IDs instead of generic `result`, to support richer history and debugging.\n"
  );
  await queueTask(worldRoot, "hq-organization-and-work-contract", 72);
  await blockWithLiveTurn(worldRoot, "hq-organization-and-work-contract");
  await queueTask(worldRoot, "hq-fixture-mail-vertical-slice", 71);
  const fixture = await readWorkTaskStatus(worldRoot, "hq-fixture-mail-vertical-slice");
  await writeWorkTaskStatus(worldRoot, { ...fixture, status: "implementing" });
  const preview = await curateWorkBacklog({
    worldRoot,
    repositoryRoot,
    owner: "background",
    threshold: 1,
    maxTasks: 1,
    staleTurnMs: 86400000,
    maxRecoveryCount: 2,
    dryRun: true,
    now: "2026-08-23T12:00:00.000Z"
  });
  assert.deepEqual(preview.proposed.map((item) => item.taskId), ["roadmap-command-result-identity"]);
});

test("accepted but unintegrated prerequisites defer dependents without an operational failure", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-deps-unintegrated-");
  await queueTask(worldRoot, "hq-organization-and-work-contract", 72);
  await markAccepted(worldRoot, "hq-organization-and-work-contract");
  await queueTask(worldRoot, "hq-fixture-mail-vertical-slice", 71);
  const { result, calls } = await runSelection(worldRoot, repositoryRoot);
  assert.equal(result.admitted, false);
  assert.equal(result.reason, "roadmap dependency waiting");
  assert.deepEqual(calls, []);
  const fixture = await readWorkTaskStatus(worldRoot, "hq-fixture-mail-vertical-slice");
  assert.equal(fixture.status, "ready");
});

test("an integrated prerequisite releases its dependent package automatically", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-deps-integrated-");
  await queueTask(worldRoot, "hq-organization-and-work-contract", 72);
  await markAccepted(worldRoot, "hq-organization-and-work-contract", { integrated: true });
  await queueTask(worldRoot, "hq-fixture-mail-vertical-slice", 71);
  const { result, calls } = await runSelection(worldRoot, repositoryRoot);
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "hq-fixture-mail-vertical-slice");
  assert.deepEqual(calls, ["hq-fixture-mail-vertical-slice"]);
});

test("dependency cycles are deterministic roadmap defects", () => {
  const packages = [
    { taskId: "package-b", dependsOnTaskIds: ["package-a"] },
    { taskId: "package-a", dependsOnTaskIds: ["package-b"] }
  ];
  const defects = validateRoadmapDependencies(packages);
  assert.deepEqual(defects.cycles, [["package-a", "package-b", "package-a"]]);
  const status = roadmapDependencyStatus(packages[1], {
    tasks: [],
    packages,
    dependencyDefects: defects
  });
  assert.equal(status.satisfied, false);
  assert.equal(status.defect, true);
  assert.match(status.unmet[0].reason, /cycle/u);
});
