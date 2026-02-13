import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createScheduler,
  parseSchedulePolicyText,
  loadSchedulePolicy,
  loadSchedulePolicyWithGlobal,
  discoverScheduledJobs
} from "../program/agent/scheduler.mjs";

test("parse schedule policy extracts jobs, intervals, tools, and lane overrides", async () => {
  const text = [
    "su name heartbeat for name priest with wo tools vyah habit per minute 24 be calendar ya",
    'su name heartbeat lane ob text "Daily Review" ya',
    "su name cleanup for name priest with name janitor vyah habit every second 5 be calendar ya",
    "su name daily sync for name priest with wo tools vyah habit per hour 24 be calendar ya",
    "su name archive for name priest with wo tools vyah habit during day 1 be calendar ya"
  ].join("\n");
  const jobs = parseSchedulePolicyText(text, { defaultAgentName: "fallback" });
  assert.equal(jobs.length, 4);

  const cleanup = jobs.find(job => job.jobName === "cleanup");
  assert.ok(cleanup);
  assert.equal(cleanup.intervalMs, 5 * 1000);
  assert.equal(cleanup.agentName, "priest");
  assert.equal(cleanup.withCase?.name, "janitor");
  assert.equal(cleanup.laneName, "cleanup");

  const heartbeat = jobs.find(job => job.jobName === "heartbeat");
  assert.ok(heartbeat);
  assert.equal(heartbeat.intervalMs, 24 * 60 * 1000);
  assert.equal(heartbeat.withCase?.wo, "tools");
  assert.equal(heartbeat.laneName, "daily_review");

  const daily = jobs.find(job => job.jobName === "daily sync");
  assert.ok(daily);
  assert.equal(daily.intervalMs, 24 * 60 * 60 * 1000);

  const archive = jobs.find(job => job.jobName === "archive");
  assert.ok(archive);
  assert.equal(archive.intervalMs, 24 * 60 * 60 * 1000);
});

test("parse schedule policy locks recurrence grammar across per/every/during forms", () => {
  const text = [
    "su name minute canonical for name priest with wo tools vyah habit per minute 3 be calendar ya",
    "su name hour alias for name priest with wo tools vyah habit every hour 2 be calendar ya",
    "su name week legacy for name priest with wo tools vyah habit during week 1 be calendar ya"
  ].join("\n");
  const jobs = parseSchedulePolicyText(text, { defaultAgentName: "fallback" });
  assert.equal(jobs.length, 3);

  const minuteCanonical = jobs.find(job => job.jobName === "minute canonical");
  assert.equal(minuteCanonical?.intervalMs, 3 * 60 * 1000);

  const hourAlias = jobs.find(job => job.jobName === "hour alias");
  assert.equal(hourAlias?.intervalMs, 2 * 60 * 60 * 1000);

  const weekLegacy = jobs.find(job => job.jobName === "week legacy");
  assert.equal(weekLegacy?.intervalMs, 7 * 24 * 60 * 60 * 1000);
});

test("parse schedule policy preserves channel poll vector order in with case", () => {
  const text = [
    'su name channel poll for name helper with ve text "matrix" "email" "telegram" vyah habit during minute 1 be calendar ya'
  ].join("\n");
  const jobs = parseSchedulePolicyText(text, { defaultAgentName: "helper" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.jobName, "channel poll");
  assert.deepEqual(jobs[0]?.withCase?.ve?.values, ["matrix", "email", "telegram"]);
});

test("load schedule policy reads conduct/calendar.pya", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-schedule-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  const conductDir = path.join(agentHouse, "conduct");
  await fs.mkdir(conductDir, { recursive: true });
  const schedulePath = path.join(conductDir, "calendar.pya");
  await fs.writeFile(schedulePath, 'su name scan for name helper ob text "scan now" per minute 3 be calendar ya\n', "utf8");
  const jobs = await loadSchedulePolicy({ agentHouse, agentName: "helper" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.jobName, "scan");
  assert.equal(jobs[0]?.prompt, "scan now");
  assert.equal(jobs[0]?.laneName, "scan");
});

test("load schedule policy parses hour/day units from conduct/calendar.pya", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-schedule-units-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  const conductDir = path.join(agentHouse, "conduct");
  await fs.mkdir(conductDir, { recursive: true });
  const schedulePath = path.join(conductDir, "calendar.pya");
  await fs.writeFile(
    schedulePath,
    [
      'su name review for name helper ob text "hourly form" every hour 24 be calendar ya',
      'su name backup for name helper ob text "daily form" per day 1 be calendar ya'
    ].join("\n") + "\n",
    "utf8"
  );
  const jobs = await loadSchedulePolicy({ agentHouse, agentName: "helper" });
  assert.equal(jobs.length, 2);
  const review = jobs.find(job => job.jobName === "review");
  assert.equal(review?.intervalMs, 24 * 60 * 60 * 1000);
  const backup = jobs.find(job => job.jobName === "backup");
  assert.equal(backup?.intervalMs, 24 * 60 * 60 * 1000);
});

test("load schedule policy ignores conduct/schedule.pya without conduct/calendar.pya", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-schedule-fallback-"));
  const agentHouse = path.join(root, "world", "house", "helper");
  const conductDir = path.join(agentHouse, "conduct");
  await fs.mkdir(conductDir, { recursive: true });
  const schedulePath = path.join(conductDir, "schedule.pya");
  await fs.writeFile(schedulePath, 'su name scan for name helper ob text "fallback" per minute 7 be calendar ya\n', "utf8");
  const jobs = await loadSchedulePolicy({ agentHouse, agentName: "helper" });
  assert.equal(jobs.length, 0);
});

test("scheduler skips overlapping ticks and records telemetry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scheduler-"));
  const telemetryPath = path.join(root, "scheduler.pya");
  let release;
  const waitForRelease = new Promise((resolve) => {
    release = resolve;
  });
  const scheduler = createScheduler({
    jobs: [{
      jobName: "heartbeat",
      laneName: "heartbeat",
      intervalMs: 1000,
      agentName: "helper",
      prompt: "",
      withCase: { wo: "tools" }
    }],
    telemetryPath,
    runJob: async () => {
      await waitForRelease;
      return { status: "ok" };
    }
  });

  const first = scheduler.runNow();
  const second = scheduler.runNow();
  release();
  await Promise.all([first, second]);
  await scheduler.flushTelemetry();

  const snap = scheduler.snapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0]?.runs, 1);
  assert.equal(snap[0]?.skips, 1);
  assert.equal(typeof snap[0]?.overlapPct, "number");
  assert.equal(snap[0]?.errorCount, 0);
  assert.equal(snap[0]?.lastStatus, "ok");

  const telemetry = await fs.readFile(telemetryPath, "utf8");
  assert.match(telemetry, /as name skip_overlap/);
  assert.match(telemetry, /as name run/);
  assert.match(telemetry, /\\"overlapPct\\":/);
});

test("scheduler skips disabled services", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scheduler-disabled-"));
  const telemetryPath = path.join(root, "scheduler.pya");
  let ran = false;
  const scheduler = createScheduler({
    jobs: [{
      jobName: "matrix probe",
      laneName: "matrix_probe",
      intervalMs: 1000,
      agentName: "helper",
      prompt: "",
      withCase: { wo: "tools" }
    }],
    telemetryPath,
    isJobEnabled: async () => false,
    runJob: async () => {
      ran = true;
      return { status: "ok" };
    }
  });

  await scheduler.runNow();
  await scheduler.flushTelemetry();
  assert.equal(ran, false);
  const snap = scheduler.snapshot();
  assert.equal(snap[0]?.enabled, false);
  const telemetry = await fs.readFile(telemetryPath, "utf8");
  assert.match(telemetry, /as name skip_disabled/);
});

test("scheduler records error counters and last status on run failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-scheduler-error-"));
  const telemetryPath = path.join(root, "scheduler.pya");
  const scheduler = createScheduler({
    jobs: [{
      jobName: "unstable",
      laneName: "unstable",
      intervalMs: 1000,
      agentName: "helper",
      prompt: "",
      withCase: { wo: "tools" }
    }],
    telemetryPath,
    runJob: async () => {
      throw new Error("boom");
    }
  });

  await scheduler.runNow();
  await scheduler.flushTelemetry();
  const snap = scheduler.snapshot();
  assert.equal(snap[0]?.runs, 0);
  assert.equal(snap[0]?.errorCount, 1);
  assert.equal(snap[0]?.consecutiveErrors, 1);
  assert.equal(snap[0]?.lastStatus, "error");
  assert.match(String(snap[0]?.lastError), /boom/);

  const telemetry = await fs.readFile(telemetryPath, "utf8");
  assert.match(telemetry, /as name error/);
  assert.match(telemetry, /\\"errorCount\\":1/);
});

test("global schedule loads and agent-local overrides by agent+job", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-schedule-merge-"));
  const worldRoot = path.join(root, "world");
  const globalConduct = path.join(worldRoot, "conduct");
  const agentHouse = path.join(worldRoot, "house", "priest");
  const agentConduct = path.join(agentHouse, "conduct");
  await fs.mkdir(globalConduct, { recursive: true });
  await fs.mkdir(agentConduct, { recursive: true });
  await fs.writeFile(
    path.join(globalConduct, "calendar.pya"),
    [
      "su name heartbeat for name priest ob text \"global prompt\" vyah habit during minute 24 be calendar ya",
      'su name heartbeat lane ob text "global lane" ya'
    ].join("\n") + "\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(agentConduct, "calendar.pya"),
    [
      "su name heartbeat for name priest ob text \"local prompt\" vyah habit during minute 5 be calendar ya",
      'su name heartbeat lane ob text "local lane" ya'
    ].join("\n") + "\n",
    "utf8"
  );
  const jobs = await loadSchedulePolicyWithGlobal({ worldRoot, agentHouse, agentName: "priest" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.intervalMs, 5 * 60 * 1000);
  assert.equal(jobs[0]?.prompt, "local prompt");
  assert.equal(jobs[0]?.laneName, "local_lane");
});

test("discover scheduled jobs gathers global and agent-local declarations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-schedule-discover-"));
  const worldRoot = path.join(root, "world");
  const globalConduct = path.join(worldRoot, "conduct");
  const alphaConduct = path.join(worldRoot, "house", "alpha", "conduct");
  const betaConduct = path.join(worldRoot, "house", "beta", "conduct");
  await fs.mkdir(globalConduct, { recursive: true });
  await fs.mkdir(alphaConduct, { recursive: true });
  await fs.mkdir(betaConduct, { recursive: true });
  await fs.writeFile(
    path.join(globalConduct, "calendar.pya"),
    "su name heartbeat for name alpha vyah habit during minute 24 be calendar ya\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(betaConduct, "calendar.pya"),
    "su name matrix probe for name beta with wo tools vyah habit during minute 1 be calendar ya\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(globalConduct, "agent.pya"),
    [
      'su name alpha house directory ob filename "world/house/alpha" ya',
      'su name beta house directory ob filename "world/house/beta" ya'
    ].join("\n") + "\n",
    "utf8"
  );
  const jobs = await discoverScheduledJobs({ worldRoot });
  const keys = jobs.map(job => `${job.agentName}:${job.jobName}`);
  assert.ok(keys.includes("alpha:heartbeat"));
  assert.ok(keys.includes("beta:matrix probe"));
});
