import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  calculateWeeklyPacing,
  normalizeCodexCapacity,
  admitBackgroundWork
} from "../../program/runtime/work/capacity.mjs";
import { claimOldestWorkTask, enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { readWorkSchedulerHealth } from "../../program/runtime/work/health.mjs";
import { readWorkTaskStatus, transitionWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import { inspectWorkBackground, probeExternalEvidenceTask, runWorkBackgroundContinuous, runWorkBackgroundOnce } from "../../program/runtime/work/runner.mjs";

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
  assert.equal(capacity.weekly.identified, false);
  const accountShape = normalizeCodexCapacity({
    rateLimits: { primary: { usedPercent: 7, resetsAt: 1786579507, windowDurationMins: 10080 } }
  }, { now: "2026-08-07T12:30:00.000Z" });
  assert.equal(accountShape.state, "available");
  assert.equal(accountShape.remainingPercent, 93);
  assert.equal(accountShape.windowMinutes, 10080);
  assert.equal(accountShape.weekly.identified, true);
  assert.equal(accountShape.weekly.windowStartAt, "2026-08-06T00:05:07.000Z");
  assert.equal(normalizeCodexCapacity({}, { now: "2026-08-07T12:30:00.000Z" }).state, "unknown");
});

test("admission preserves a foreground reserve and treats unknown capacity as unsafe", () => {
  const weekly = (usedPercent, remainingPercent) => ({
    identified: true,
    state: "available",
    usedPercent,
    remainingPercent,
    windowStartAt: "2026-08-03T12:00:00.000Z",
    resetAt: "2026-08-10T12:00:00.000Z"
  });
  const base = {
    capacity: { weekly: weekly(20, 80) },
    policy: { enabled: true, reservePercent: 20 },
    now: "2026-08-07T12:00:00.000Z"
  };
  assert.equal(admitBackgroundWork({ ...base, hasEligibleWork: true }).admit, true);
  assert.equal(admitBackgroundWork({ ...base, capacity: { weekly: weekly(90, 10) } }).reason, "weekly reserve");
  assert.equal(admitBackgroundWork({ ...base, capacity: { weekly: { identified: false, state: "unknown" } } }).reason, "capacity unknown");
  assert.equal(admitBackgroundWork({ ...base, foregroundActive: true }).reason, "active task conflict");
});

test("weekly pacing follows the seven-day curve and protects the final reserve", () => {
  const capacity = {
    weekly: {
      identified: true,
      state: "available",
      usedPercent: 0,
      remainingPercent: 100,
      windowStartAt: "2026-08-03T00:00:00.000Z",
      resetAt: "2026-08-10T00:00:00.000Z"
    }
  };
  const dayOne = calculateWeeklyPacing(capacity, { reservePercent: 15, now: "2026-08-04T00:00:00.000Z" });
  const dayFour = calculateWeeklyPacing(capacity, { reservePercent: 15, now: "2026-08-07T00:00:00.000Z" });
  const end = calculateWeeklyPacing(capacity, { reservePercent: 15, now: "2026-08-10T00:00:00.000Z" });
  assert.equal(Math.round(dayOne.minimumRemainingPercent * 10) / 10, 87.9);
  assert.equal(Math.round(dayFour.minimumRemainingPercent * 10) / 10, 51.4);
  assert.equal(end.minimumRemainingPercent, 15);
});

test("interactive usage ahead of the curve pauses background work", () => {
  const capacity = {
    weekly: {
      identified: true,
      state: "available",
      usedPercent: 30,
      remainingPercent: 70,
      windowStartAt: "2026-08-03T00:00:00.000Z",
      resetAt: "2026-08-10T00:00:00.000Z"
    }
  };
  const decision = admitBackgroundWork({
    capacity,
    policy: { enabled: true, reservePercent: 15, pacingDeadbandPercent: 1 },
    hasEligibleWork: true,
    now: "2026-08-04T00:00:00.000Z"
  });
  assert.equal(decision.reason, "weekly pacing limit");
  assert.ok(decision.pacing.headroomPercent < 0);
});

test("weekly pacing defers when reset timing is unknown", () => {
  const decision = admitBackgroundWork({
    capacity: {
      weekly: { identified: true, state: "available", usedPercent: 4, remainingPercent: 96 }
    },
    policy: { enabled: true },
    hasEligibleWork: true,
    now: "2026-08-09T00:00:00.000Z"
  });
  assert.equal(decision.reason, "capacity unknown");
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
    capacitySource: async () => ({
      state: "available",
      remainingPercent: 80,
      usedPercent: 20,
      resetAt: "2026-08-10T12:00:00.000Z",
      weekly: {
        identified: true,
        state: "available",
        remainingPercent: 80,
        usedPercent: 20,
        windowStartAt: "2026-08-03T12:00:00.000Z",
        resetAt: "2026-08-10T12:00:00.000Z"
      }
    }),
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
  assert.equal(health["last decision"], "weekly pacing headroom");
  assert.deepEqual(events.map((event) => event.type), ["capacity"]);
});

test("background baseline sync skips active work and runs before a new task", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-baseline-");
  const capacitySource = async () => ({
    state: "available",
    remainingPercent: 80,
    usedPercent: 20,
    weekly: {
      identified: true,
      state: "available",
      remainingPercent: 80,
      usedPercent: 20,
      windowStartAt: "2026-08-03T12:00:00.000Z",
      resetAt: "2026-08-10T12:00:00.000Z"
    }
  });
  await enqueueWorkTask(worldRoot, task("active-task"));
  await claimOldestWorkTask(worldRoot, { workerTag: "test" });
  await transitionWorkTaskStatus(worldRoot, "active-task", "planning");
  await transitionWorkTaskStatus(worldRoot, "active-task", "implementing");
  await enqueueWorkTask(worldRoot, task("queued-high", 200));
  let syncCalls = 0;
  const active = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    policy: { enabled: true },
    capacitySource,
    baselineSync: async () => {
      syncCalls += 1;
      return { status: "synchronized", commit: "unexpected" };
    },
    supervisor: async ({ taskId }) => ({ claimed: true, taskId, status: "implementing" }),
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(active.admitted, true);
  assert.equal(active.selected, "active-task");
  assert.equal(active.baseline.status, "skipped-active-task");
  assert.equal(syncCalls, 0);

  const nextWorld = await makeWorldRoot("pyash-work-baseline-next-");
  await enqueueWorkTask(nextWorld, task("next-task"));
  const next = await runWorkBackgroundOnce({
    worldRoot: nextWorld,
    owner: "background",
    policy: { enabled: true },
    capacitySource,
    baselineSync: async () => {
      syncCalls += 1;
      return { status: "synchronized", commit: "baseline-2" };
    },
    supervisor: async () => ({ claimed: true, taskId: "next-task", status: "accepted" }),
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(next.baseline.status, "synchronized");
  assert.equal(syncCalls, 1);
});

test("background preflight defers globally without claiming a task", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-preflight-");
  await enqueueWorkTask(worldRoot, task("preflight-task"));
  let supervisorCalls = 0;
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    policy: { enabled: true },
    capacitySource: async () => ({
      state: "available",
      remainingPercent: 80,
      usedPercent: 20,
      weekly: {
        identified: true,
        state: "available",
        remainingPercent: 80,
        usedPercent: 20,
        windowStartAt: "2026-08-03T12:00:00.000Z",
        resetAt: "2026-08-10T12:00:00.000Z"
      }
    }),
    executionPreflight: async () => ({
      ok: false,
      status: "blocked",
      check: "Codex App Server/sandbox initialization",
      reason: "bwrap: loopback: Failed RTM_NEWADDR"
    }),
    supervisor: async () => {
      supervisorCalls += 1;
      return { claimed: true, taskId: "preflight-task", status: "accepted" };
    },
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /execution environment blocked/u);
  assert.equal(supervisorCalls, 0);
  assert.equal((await readWorkTaskStatus(worldRoot, "preflight-task")).status, "ready");
  const health = await readWorkSchedulerHealth(worldRoot);
  assert.equal(health["execution preflight status"], "blocked");
  assert.match(health["execution preflight reason"], /RTM_NEWADDR/u);
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

test("background runner reports an empty backlog as idle", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-idle-");
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    policy: { enabled: true },
    capacitySource: async () => ({ state: "unknown", remainingPercent: null }),
    now: () => "2026-08-07T12:01:00.000Z"
  });
  assert.equal(result.reason, "no eligible work");
  assert.match(result.report, /Result: IDLE/);
});

test("external evidence does not starve candidate promotion", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-external-starvation-");
  const repositoryRoot = path.join(path.dirname(worldRoot), "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "todo.md"), "Introduce result tracking with per-command IDs instead of generic result\n");
  await enqueueWorkTask(worldRoot, {
    ...task("roadmap-agent-research-tool-chain", 140),
    title: "Agent research evidence",
    workSpec: { granularity: "substantial" },
    status: "ready"
  });
  await transitionWorkTaskStatus(worldRoot, "roadmap-agent-research-tool-chain", "blocked", {
    message: "required live systems: configured search and Ollama both refuse connections",
    error: "required live systems: configured search and Ollama both refuse connections"
  });
  const capacitySource = async () => ({
    state: "available",
    remainingPercent: 90,
    usedPercent: 10,
    weekly: {
      identified: true,
      state: "available",
      remainingPercent: 90,
      usedPercent: 10,
      windowStartAt: "2026-08-17T12:00:00.000Z",
      resetAt: "2026-08-24T12:00:00.000Z"
    }
  });
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    repositoryRoot,
    curate: true,
    policy: { enabled: true },
    capacitySource,
    externalEvidenceProbe: async () => ({ available: false, reason: "external dependency still unavailable: Ollama" }),
    supervisor: async ({ taskId }) => ({ claimed: true, taskId, status: "accepted" }),
    now: "2026-08-18T12:00:00.000Z"
  });
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "roadmap-command-result-identity");
  assert.deepEqual(result.curation.created, ["roadmap-command-result-identity"]);
  const health = await readWorkSchedulerHealth(worldRoot);
  assert.equal(health["technical continuation unavailable wakes"] || "0", "0");
  assert.equal(health["work-started wakes"], "1");
});

test("exhausted technical continuation does not starve a runnable candidate", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-technical-starvation-");
  const repositoryRoot = path.join(path.dirname(worldRoot), "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "roadmap.md"), "hq-organization-and-work-contract\n");
  await enqueueWorkTask(worldRoot, {
    ...task("roadmap-mind-reply-envelope-streaming-follow-up-5", 120),
    title: "Mind streaming continuation",
    workSpec: { granularity: "substantial" },
    status: "ready"
  });
  const blocked = await readWorkTaskStatus(worldRoot, "roadmap-mind-reply-envelope-streaming-follow-up-5");
  await writeWorkTaskStatus(worldRoot, {
    ...blocked,
    status: "blocked",
    message: "turn timeout",
    checkpoint: {
      ...blocked.checkpoint,
      blocker: "turn timeout",
      recoveryCount: 2,
      activeTurn: {}
    }
  });
  const capacitySource = async () => ({
    state: "available",
    remainingPercent: 90,
    usedPercent: 10,
    weekly: {
      identified: true,
      state: "available",
      remainingPercent: 90,
      usedPercent: 10,
      windowStartAt: "2026-08-17T12:00:00.000Z",
      resetAt: "2026-08-24T12:00:00.000Z"
    }
  });
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    repositoryRoot,
    curate: true,
    policy: { enabled: true },
    capacitySource,
    supervisor: async ({ taskId }) => ({ claimed: true, taskId, status: "implementing" }),
    now: "2026-08-18T12:00:00.000Z"
  });
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "hq-organization-and-work-contract");
  assert.deepEqual(result.curation.created, ["hq-organization-and-work-contract"]);
  const health = await readWorkSchedulerHealth(worldRoot);
  assert.equal(health["technical continuation unavailable wakes"] || "0", "0");
  assert.equal(health["work-started wakes"], "1");
});

test("a healthy external dependency resumes its parked task without replanning", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-external-probe-");
  await enqueueWorkTask(worldRoot, task("roadmap-translation-parity-tranche", 130));
  const prerequisite = await readWorkTaskStatus(worldRoot, "roadmap-translation-parity-tranche");
  await writeWorkTaskStatus(worldRoot, {
    ...prerequisite,
    status: "accepted",
    checkpoint: {
      ...prerequisite.checkpoint,
      integration: { status: "integrated", commit: "translation-baseline" }
    }
  });
  await enqueueWorkTask(worldRoot, {
    ...task("roadmap-mind-reply-envelope-streaming", 120),
    title: "Mind streaming evidence",
    workSpec: { granularity: "substantial" },
    status: "ready"
  });
  await transitionWorkTaskStatus(worldRoot, "roadmap-mind-reply-envelope-streaming", "blocked", {
    message: "fixture-free Ollama evidence unavailable",
    error: "fixture-free Ollama evidence unavailable"
  });
  const current = await readWorkTaskStatus(worldRoot, "roadmap-mind-reply-envelope-streaming");
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    checkpoint: {
      ...current.checkpoint,
      review: { revisionInstructions: "Run the fixture-free smoke and preserve the existing plan." },
      convergence: { status: "blocked", reviewedAt: "2026-08-18T11:00:00.000Z", decision: "BLOCK", rationale: "stale external evidence" }
    }
  });
  const inspected = await inspectWorkBackground({
    worldRoot,
    owner: "background",
    capacitySource: async () => ({ state: "available", weekly: { identified: true, remainingPercent: 90, usedPercent: 10, windowStartAt: "2026-08-17T12:00:00.000Z", resetAt: "2026-08-24T12:00:00.000Z" } }),
    externalEvidenceProbe: async () => ({
      available: true,
      reason: "external dependencies available",
      checks: [{ name: "Ollama", healthy: true, endpoint: "http://mriczo:11434" }]
    }),
    now: "2026-08-18T12:00:00.000Z"
  });
  assert.deepEqual(inspected.resumedExternal.map((item) => item.taskId), ["roadmap-mind-reply-envelope-streaming"]);
  assert.equal(inspected.selected.taskId, "roadmap-mind-reply-envelope-streaming");
  const resumed = await readWorkTaskStatus(worldRoot, "roadmap-mind-reply-envelope-streaming");
  assert.equal(resumed.status, "ready");
  assert.equal(resumed.checkpoint.resumeCount, 1);
  assert.equal(resumed.checkpoint.convergence.decision, "");
  assert.equal(resumed.checkpoint.convergence.reviewedAt, "");
  assert.match(resumed.checkpoint.review.revisionInstructions, /http:\/\/mriczo:11434/u);
});

test("generic real-backend qualification is not falsely released by an Ollama probe", async () => {
  const result = await probeExternalEvidenceTask({
    status: "blocked",
    checkpoint: { blocker: "awaiting external evidence: Matrix qualification, CI URL, and a real-backend smoke remain required" }
  }, {
    env: { OLLAMA_HOST: "http://mriczo:11434" },
    fetchImpl: async () => ({ ok: true, async json() { return { models: [{ name: "qwen3.5:9b" }] }; } })
  });
  assert.equal(result.available, false);
  assert.equal(result.checked, false);
});

test("search evidence probes the JSON search contract rather than the healthy landing page", async () => {
  const urls = [];
  const result = await probeExternalEvidenceTask({
    status: "blocked",
    checkpoint: { blocker: "fixture-free search proof is unavailable because the search endpoint returns HTTP 403" }
  }, {
    env: { PYA_WEB_SEARCH_MOTOR: "http://mriczo:60490/" },
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { ok: false, status: 403, async json() { return {}; } };
    }
  });
  assert.equal(result.available, false);
  assert.equal(result.checks[0].name, "web search");
  assert.match(result.checks[0].endpoint, /\/search\?q=pyash&format=json&count=1/u);
  assert.equal(urls.length, 1);
});
