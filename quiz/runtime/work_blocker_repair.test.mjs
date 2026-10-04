import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { appendWorkSchedulerEvent } from "../../program/runtime/work/history.mjs";
import { writeWorkSchedulerHealth } from "../../program/runtime/work/health.mjs";
import { addWorkTask } from "../../program/runtime/work/operator.mjs";
import { buildWorkTask } from "../../program/runtime/work/contract.mjs";
import { writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import { assessPriorDayProductivity, findBlockerRepairCandidate, prepareBlockerRepair } from "../../program/runtime/work/blocker_repair.mjs";
import { renderWorkDailyDigest } from "../../program/runtime/work/digest.mjs";
import { runWorkBackgroundOnce } from "../../program/runtime/work/runner.mjs";

async function makeWorldRoot(prefix = "pyash-blocker-repair-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

function capacity() {
  return {
    state: "available",
    usedPercent: 0,
    remainingPercent: 100,
    weekly: {
      identified: true,
      usedPercent: 0,
      remainingPercent: 100,
      windowStartAt: "2026-10-01T00:00:00.000Z",
      resetAt: "2026-10-08T00:00:00.000Z",
      windowMinutes: 10080
    }
  };
}

function blockedExternal(taskId = "roadmap-agent-research-tool-chain") {
  return buildWorkTask({
    taskId,
    owner: "background",
    kind: "roadmap",
    title: "Complete the research tool chain",
    priority: 90,
    status: "blocked",
    queuedAt: "2026-10-03T00:00:00.000Z",
    promptText: "Complete the research tool chain.",
    acceptanceText: "Fixture-free evidence passes.",
    message: "fixture-free proof unavailable",
    checkpoint: { blocker: "The search endpoint at http://mriczo:60490/search returns HTTP 403." }
  });
}

test("prior-day productivity is based on useful work, not merely wake count", () => {
  const now = "2026-10-04T12:00:00.000Z";
  const blocked = {
    at: "2026-10-04T11:00:00.000Z",
    action: "technical-blocked",
    workStarted: false,
    usefulWake: false,
    materialProgress: false
  };
  assert.equal(assessPriorDayProductivity([blocked], { now }).noUsefulWork, true);
  assert.equal(assessPriorDayProductivity([{ ...blocked, action: "admitted", workStarted: true }], { now }).noUsefulWork, false);
  assert.equal(assessPriorDayProductivity([], { now }).noUsefulWork, false);
});

test("a bounded external blocker becomes a linked repair candidate after an unproductive day", async () => {
  const worldRoot = await makeWorldRoot();
  const now = "2026-10-04T12:00:00.000Z";
  await writeWorkTaskStatus(worldRoot, blockedExternal());
  await appendWorkSchedulerEvent(worldRoot, {
    action: "technical-blocked",
    reason: "awaiting external evidence",
    workStarted: false,
    usefulWake: false,
    materialProgress: false
  }, { now: "2026-10-04T11:00:00.000Z" });
  const result = await prepareBlockerRepair({ worldRoot, now });
  assert.equal(result.created, true);
  assert.equal(result.task.kind, "blocker-repair");
  assert.equal(result.task.workSpec.blockerRepair.sourceTaskId, "roadmap-agent-research-tool-chain");
  assert.match(result.task.promptText, /existing checkout|remote service|60490/iu);
  const source = await import("../../program/runtime/work/status.mjs").then(({ readWorkTaskStatus }) => readWorkTaskStatus(worldRoot, "roadmap-agent-research-tool-chain"));
  assert.equal(source.status, "blocked");
});

test("a global baseline blocker takes precedence and is prepared only once per day", async () => {
  const worldRoot = await makeWorldRoot();
  const now = "2026-10-04T12:00:00.000Z";
  await writeWorkTaskStatus(worldRoot, blockedExternal("roadmap-agent-research-tool-chain"));
  await writeWorkSchedulerHealth(worldRoot, {
    "baseline error": "Command failed: git merge --no-edit abc123",
    "last decision": "automation baseline sync blocked: Command failed: git merge --no-edit abc123"
  });
  await appendWorkSchedulerEvent(worldRoot, {
    action: "technical-blocked",
    reason: "automation baseline sync blocked",
    workStarted: false
  }, { now: "2026-10-04T11:00:00.000Z" });
  const first = await prepareBlockerRepair({ worldRoot, now });
  assert.equal(first.candidate.source, "automation-baseline-sync");
  assert.equal(first.created, true);
  const second = await prepareBlockerRepair({ worldRoot, now });
  assert.equal(Boolean(second.created), false);
  assert.match(second.reason, /no bounded|prior day/iu);
});

test("blocker repair bypasses a failing baseline sync without mutating the source task", async () => {
  const worldRoot = await makeWorldRoot();
  const now = "2026-10-04T12:00:00.000Z";
  await writeWorkSchedulerHealth(worldRoot, {
    "baseline error": "Command failed: git merge --no-edit abc123",
    "last decision": "automation baseline sync blocked: Command failed: git merge --no-edit abc123"
  });
  await appendWorkSchedulerEvent(worldRoot, {
    action: "technical-blocked",
    reason: "automation baseline sync blocked",
    workStarted: false
  }, { now: "2026-10-04T11:00:00.000Z" });
  let baselineCalls = 0;
  let supervisorCalls = 0;
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    now,
    policy: { enabled: true },
    capacitySource: async () => capacity(),
    executionPreflight: async () => ({ ok: true, status: "ready" }),
    baselineSync: async () => {
      baselineCalls += 1;
      throw new Error("must be bypassed for blocker repair");
    },
    supervisor: async ({ taskId }) => {
      supervisorCalls += 1;
      return { claimed: true, taskId, status: "accepted", workStarted: true };
    }
  });
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "blocker-repair-automation-baseline-sync-2026-10-04");
  assert.equal(baselineCalls, 0);
  assert.equal(supervisorCalls, 1);
  assert.equal(result.blockerRepair.created, true);
});

test("a useful prior-day wake suppresses blocker repair activation", async () => {
  const worldRoot = await makeWorldRoot();
  const now = "2026-10-04T12:00:00.000Z";
  await writeWorkTaskStatus(worldRoot, blockedExternal());
  await appendWorkSchedulerEvent(worldRoot, {
    action: "admitted",
    reason: "weekly pacing headroom",
    workStarted: true,
    usefulWake: true
  }, { now: "2026-10-04T11:00:00.000Z" });
  const result = await prepareBlockerRepair({ worldRoot, now });
  assert.equal(result.activated, false);
  assert.match(result.reason, /useful work/iu);
});

test("daily digest exposes the blocker repair lane after a workless day", () => {
  const report = renderWorkDailyDigest({
    date: "2026-10-04",
    since: "2026-10-03T00:00:00.000Z",
    until: "2026-10-04T00:00:00.000Z",
    capacity: {
      weekly: {
        identified: true,
        remainingPercent: 97,
        usedPercent: 3,
        resetAt: "2026-10-10T00:00:00.000Z",
        windowStartAt: "2026-10-03T00:00:00.000Z"
      }
    },
    blockerRepair: {
      productivity: { noUsefulWork: true, observedWakes: 24 },
      candidate: {
        title: "Repair the autonomous automation baseline blocker",
        blocker: "automation baseline sync blocked: merge conflict",
        sourceTaskId: ""
      }
    }
  }).report;
  assert.match(report, /Blocker repair lane/u);
  assert.match(report, /no useful work across 24 scheduler wakes/u);
  assert.match(report, /Repair the autonomous automation baseline blocker/u);
  assert.match(report, /integration conflict against current automation baseline/u);
  assert.doesNotMatch(report, /backlog exhausted/u);
});
