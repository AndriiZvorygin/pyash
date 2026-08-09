import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeCodexCapacity, admitBackgroundWork } from "../../program/runtime/work/capacity.mjs";
import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { readWorkSchedulerHealth } from "../../program/runtime/work/health.mjs";
import { runWorkBackgroundContinuous, runWorkBackgroundOnce } from "../../program/runtime/work/runner.mjs";

async function makeWorldRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

function task(taskId, priority = 100) {
  return {
    taskId,
    owner: "background",
    kind: "roadmap",
    title: taskId,
    priority,
    queuedAt: `2026-08-07T12:0${priority === 200 ? "0" : "1"}:00.000Z`,
    promptText: "Do the bounded task.",
    acceptanceText: "The targeted test passes."
  };
}

test("capacity normalization is conservative and preserves provider diagnostics", () => {
  const capacity = normalizeCodexCapacity({
    primary: {
      usedPercent: 35,
      resetAt: "2026-08-07T13:00:00.000Z",
      windowDurationMins: 60
    },
    providerField: "kept"
  }, { now: "2026-08-07T12:30:00.000Z" });
  assert.equal(capacity.state, "available");
  assert.equal(capacity.remainingPercent, 65);
  assert.equal(capacity.windowMinutes, 60);
  assert.equal(capacity.raw.providerField, "kept");
  const accountShape = normalizeCodexCapacity({
    rateLimits: { primary: { usedPercent: 7, resetsAt: 1786579507, windowDurationMins: 10080 } }
  }, { now: "2026-08-07T12:30:00.000Z" });
  assert.equal(accountShape.state, "available");
  assert.equal(accountShape.remainingPercent, 93);
  assert.equal(accountShape.windowMinutes, 10080);
  assert.equal(normalizeCodexCapacity({}, { now: "2026-08-07T12:30:00.000Z" }).state, "unknown");
});

test("admission preserves a foreground reserve and treats unknown capacity as unsafe", () => {
  const base = { capacity: { state: "available", remainingPercent: 30 }, policy: { enabled: true, reservePercent: 20 } };
  assert.equal(admitBackgroundWork({ ...base, hasEligibleWork: true }).admit, true);
  assert.equal(admitBackgroundWork({ ...base, capacity: { state: "available", remainingPercent: 10 } }).reason, "foreground reserve");
  assert.equal(admitBackgroundWork({ ...base, capacity: { state: "unknown" } }).reason, "capacity unknown");
  assert.equal(admitBackgroundWork({ ...base, foregroundActive: true }).reason, "active task conflict");
});

test("background one-shot records admission and scheduler health", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-runner-");
  await enqueueWorkTask(worldRoot, task("low", 100));
  await enqueueWorkTask(worldRoot, task("high", 200));
  const events = [];
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    policy: { enabled: true, reservePercent: 20 },
    capacitySource: async () => ({ state: "available", remainingPercent: 80, usedPercent: 20, resetAt: "" }),
    onEvent: async (event) => events.push(event),
    supervisor: async ({ worldRoot: root, taskId }) => {
      assert.equal(root, worldRoot);
      assert.equal(taskId, "high");
      return { claimed: true, taskId: "high", status: "accepted" };
    },
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "high");
  const health = await readWorkSchedulerHealth(worldRoot);
  assert.equal(health["last admitted task"], "high");
  assert.equal(health["capacity state"], "available");
  assert.equal(health["last decision"], "capacity above reserve");
  assert.deepEqual(events.map((event) => event.type), ["capacity"]);
});

test("continuous runner sleeps between bounded wakes and can defer safely", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-continuous-");
  await enqueueWorkTask(worldRoot, task("one"));
  const sleeps = [];
  const events = [];
  const results = await runWorkBackgroundContinuous({
    worldRoot,
    owner: "background",
    policy: { enabled: true },
    capacitySource: async () => ({ state: "unknown", remainingPercent: null }),
    onEvent: async (event) => events.push(event),
    intervalMs: 17,
    maxCycles: 2,
    sleep: async (ms) => sleeps.push(ms)
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.reason), ["capacity unknown", "capacity unknown"]);
  assert.match(results[0].report, /Result: DEFERRED/);
  assert.deepEqual(events.map((event) => event.type), ["capacity", "deferred", "capacity", "deferred"]);
  assert.deepEqual(sleeps, [17, 17]);
});
