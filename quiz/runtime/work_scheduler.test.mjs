import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { curateWorkBacklog } from "../../program/runtime/work/curator.mjs";
import { integrateAcceptedWork, synchronizeAutomationBranch } from "../../program/runtime/work/integration.mjs";
import { appendWorkSchedulerEvent } from "../../program/runtime/work/history.mjs";
import { buildWorkDailyDigest, renderWorkDailyDigest, writeWorkDailyDigestState } from "../../program/runtime/work/digest.mjs";
import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { listWorkTasks } from "../../program/runtime/work/operator.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
}

async function world(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return { root, worldRoot };
}

test("backlog curation creates bounded TODO-sourced substantial packages without duplicates", async () => {
  const { root, worldRoot } = await world("pyash-work-curator-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "todo.md"), [
    "Higher-level translation paths parity",
    "Mind: plus streaming path and richer reply envelopes per mind.md.",
    "Add error-handling paths for ceremonies/sandpits using ret with be error."
  ].join("\n"));
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-translation-parity-tranche",
    owner: "background",
    kind: "roadmap",
    title: "Complete translation parity",
    priority: 130,
    queuedAt: "2026-08-09T03:00:00.000Z",
    promptText: "Complete translation parity.",
    acceptanceText: "The translation parity tests pass."
  });
  const prerequisite = await readWorkTaskStatus(worldRoot, "roadmap-translation-parity-tranche");
  await writeWorkTaskStatus(worldRoot, {
    ...prerequisite,
    status: "accepted",
    checkpoint: {
      ...prerequisite.checkpoint,
      integration: { status: "integrated", commit: "translation-baseline" }
    }
  });
  const preview = await curateWorkBacklog({ worldRoot, repositoryRoot, dryRun: true, maxTasks: 2 });
  assert.equal(preview.proposed.length, 2);
  assert.equal(preview.proposed[0].provenance.kind, "todo");
  const created = await curateWorkBacklog({ worldRoot, repositoryRoot, maxTasks: 2, now: "2026-08-09T04:00:00.000Z" });
  assert.equal(created.created.length, 2);
  assert.equal((await curateWorkBacklog({ worldRoot, repositoryRoot, dryRun: true })).proposed.length, 0);
  const stored = await listWorkTasks(worldRoot, { includeTerminal: true });
  const curated = stored.find((task) => task.taskId !== "roadmap-translation-parity-tranche");
  assert.equal(curated.workSpec.granularity, "substantial");
  assert.match(curated.contextText, /Why now/u);
});

test("accepted work integrates onto a synchronized automation baseline", async () => {
  const { root } = await world("pyash-work-integration-");
  const repositoryRoot = path.join(root, "repo");
  const worktreePath = path.join(root, "task");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await git(repositoryRoot, "init", "-q");
  await git(repositoryRoot, "config", "user.email", "test@example.com");
  await git(repositoryRoot, "config", "user.name", "Pyash Test");
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "base\n");
  await git(repositoryRoot, "add", "README.md");
  await git(repositoryRoot, "commit", "-qm", "base");
  const baseRevision = (await git(repositoryRoot, "rev-parse", "HEAD")).stdout.trim();
  await git(repositoryRoot, "branch", "automation/roadmap", baseRevision);
  await git(repositoryRoot, "worktree", "add", "--detach", worktreePath, baseRevision);
  await fs.writeFile(path.join(worktreePath, "README.md"), "automation\n");
  await git(worktreePath, "add", "README.md");
  await git(worktreePath, "commit", "-qm", "automation change");
  await fs.writeFile(path.join(worktreePath, "TASK.md"), "task evidence\n");
  await git(worktreePath, "add", "TASK.md");
  await git(worktreePath, "commit", "-qm", "automation evidence");
  await fs.writeFile(path.join(repositoryRoot, "HUMAN.md"), "human\n");
  await git(repositoryRoot, "add", "HUMAN.md");
  await git(repositoryRoot, "commit", "-qm", "human baseline change");
  const synced = await synchronizeAutomationBranch({
    repositoryRoot,
    branch: "automation/roadmap",
    masterRef: "master",
    now: "2026-08-09T04:30:00.000Z"
  });
  assert.equal(synced.status, "synchronized");
  const integrated = await integrateAcceptedWork({
    repositoryRoot,
    worktreePath,
    baseRevision,
    branch: "automation/roadmap",
    now: "2026-08-09T05:00:00.000Z"
  });
  assert.equal(integrated.status, "integrated");
  assert.equal(integrated.strategy, "cherry-pick task history onto synchronized branch");
  assert.notEqual(integrated.commit, baseRevision);
  assert.equal((await git(repositoryRoot, "rev-parse", "refs/heads/automation/roadmap")).stdout.trim(), integrated.branchCommit);
  assert.notEqual(integrated.branchCommit, synced.commit);
  assert.equal((await git(repositoryRoot, "show", "--format=%s", "--no-patch", integrated.branchCommit)).stdout.trim(), "automation evidence");
  assert.equal((await git(repositoryRoot, "show", `refs/heads/automation/roadmap:README.md`)).stdout, "automation\n");
  assert.equal((await git(repositoryRoot, "show", `refs/heads/automation/roadmap:TASK.md`)).stdout, "task evidence\n");
});

test("conflicting accepted work remains blocked instead of improvising a merge", async () => {
  const { root } = await world("pyash-work-integration-conflict-");
  const repositoryRoot = path.join(root, "repo");
  const worktreePath = path.join(root, "task");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await git(repositoryRoot, "init", "-q");
  await git(repositoryRoot, "config", "user.email", "test@example.com");
  await git(repositoryRoot, "config", "user.name", "Pyash Test");
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "base\n");
  await git(repositoryRoot, "add", "README.md");
  await git(repositoryRoot, "commit", "-qm", "base");
  const baseRevision = (await git(repositoryRoot, "rev-parse", "HEAD")).stdout.trim();
  await git(repositoryRoot, "branch", "automation/roadmap", baseRevision);
  await git(repositoryRoot, "worktree", "add", "--detach", worktreePath, baseRevision);
  await fs.writeFile(path.join(worktreePath, "README.md"), "automation\n");
  await git(worktreePath, "add", "README.md");
  await git(worktreePath, "commit", "-qm", "conflicting automation change");
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "human\n");
  await git(repositoryRoot, "add", "README.md");
  await git(repositoryRoot, "commit", "-qm", "human conflicting change");
  await synchronizeAutomationBranch({ repositoryRoot, branch: "automation/roadmap", masterRef: "master" });
  await assert.rejects(
    integrateAcceptedWork({ repositoryRoot, worktreePath, baseRevision, branch: "automation/roadmap" }),
    /cherry-pick|conflict|patch failed/iu
  );
  assert.equal((await git(repositoryRoot, "rev-parse", "refs/heads/automation/roadmap")).stdout.trim(), (await git(repositoryRoot, "rev-parse", "master")).stdout.trim());
});

test("daily digest aggregates scheduler events and durable task progress", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await enqueueWorkTask(worldRoot, {
    taskId: "digest-task",
    owner: "background",
    kind: "roadmap",
    title: "Complete a substantial parity tranche",
    priority: 125,
    queuedAt: "2026-08-09T06:00:00.000Z",
    promptText: "Implement it.",
    acceptanceText: "Tests pass."
  });
  const task = await readWorkTaskStatus(worldRoot, "digest-task");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "accepted",
    startedAt: "2026-08-09T06:10:00.000Z",
    finishedAt: "2026-08-09T06:40:00.000Z",
    checkpoint: {
      ...task.checkpoint,
      plan: { summary: "Plan the tranche." },
      implementation: { summary: "Implemented the tranche.", passes: 2 },
      review: { decision: "ACCEPT", explanation: "Evidence is sufficient." },
      workspace: { worktreePath: "/tmp/digest-worktree" }
    }
  });
  const capacity = {
    weekly: {
      identified: true,
      state: "available",
      usedPercent: 8,
      remainingPercent: 92,
      windowStartAt: "2026-08-03T00:00:00.000Z",
      resetAt: "2026-08-10T00:00:00.000Z"
    }
  };
  await appendWorkSchedulerEvent(worldRoot, { type: "admitted", taskId: "digest-task", capacity }, { now: "2026-08-09T06:15:00.000Z" });
  await appendWorkSchedulerEvent(worldRoot, { type: "idle", reason: "no eligible work", capacity }, { now: "2026-08-09T06:45:00.000Z" });
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    since: "2026-08-09T00:00:00.000Z",
    until: "2026-08-09T23:00:00.000Z",
    capacitySource: async () => capacity,
    now: "2026-08-09T23:00:00.000Z"
  });
  assert.match(digest.report, /Complete a substantial parity tranche/u);
  assert.match(digest.report, /Sol plan: Plan the tranche\./u);
  assert.match(digest.report, /Sol review: ACCEPT Evidence is sufficient\./u);
  assert.match(digest.report, /Admitted: 1/u);
  assert.match(digest.report, /ROADMAP/u);
  assert.match(digest.report, /Complete the higher-level translation parity tranche/u);
  assert.match(digest.report, /Add HNUC compositional-case validation/u);
  assert.match(digest.report, /Digest status:/u);
  assert.doesNotMatch(digest.subject, /needs direction/iu);
  assert.match(digest.report, /ROADMAP WORK REMAINS|READY QUEUE EMPTY|Current pacing floor/iu);
});

test("daily digest reports material progress and deduplicates duplicate recovery records", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-progress-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await enqueueWorkTask(worldRoot, {
    taskId: "progress-task",
    owner: "background",
    kind: "roadmap",
    title: "Progress task",
    priority: 100,
    queuedAt: "2026-08-17T01:00:00.000Z",
    promptText: "Implement the task.",
    acceptanceText: "The targeted test passes."
  });
  const task = await readWorkTaskStatus(worldRoot, "progress-task");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "implementing",
    checkpoint: {
      ...task.checkpoint,
      implementation: {
        ...task.checkpoint.implementation,
        passHistory: [
          { pass: 1, state: "completed", at: "2026-08-17T01:10:00.000Z", material: true, materialReasons: ["new commit"], newCommits: ["abc1234"] },
          { pass: 2, state: "completed", at: "2026-08-17T02:10:00.000Z", material: false, materialReasons: [], noDeltaReason: "same evidence" }
        ],
        passes: 2,
        materialProgressPasses: 1,
        noProgressPasses: 1,
        commitsProduced: 1,
        lastMaterialProgressAt: "2026-08-17T01:10:00.000Z"
      }
    }
  });
  const capacity = { weekly: { identified: true, remainingPercent: 80, usedPercent: 20, resetAt: "2026-08-24T00:00:00.000Z" } };
  for (const at of ["2026-08-17T03:00:00.000Z", "2026-08-17T03:00:01.000Z"]) {
    await appendWorkSchedulerEvent(worldRoot, {
      type: "recovered",
      taskId: "progress-task",
      recoveryCount: 2,
      reason: "recovered after preflight",
      previousBlocker: "turn timeout",
      capacity
    }, { now: at });
  }
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    since: "2026-08-17T00:00:00.000Z",
    until: "2026-08-17T23:00:00.000Z",
    capacitySource: async () => capacity,
    now: "2026-08-17T23:00:00.000Z"
  });
  assert.match(digest.report, /Implementation passes: 2/u);
  assert.match(digest.report, /Material-progress passes: 1/u);
  assert.match(digest.report, /No-delta passes: 1/u);
  assert.match(digest.report, /Commits produced: 1/u);
  assert.match(digest.report, /Operational recoveries: 1/u);
  assert.equal((digest.report.match(/progress-task: recovered after preflight/gu) || []).length, 1);
});

test("daily digest reports completed work before additional temporary blockers", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-completed-blocked-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "todo.md"), "Add error-handling paths for ceremonies/sandpits\n");
  await enqueueWorkTask(worldRoot, {
    taskId: "completed-digest-task",
    owner: "background",
    kind: "roadmap",
    title: "Strengthen CLI language UX",
    priority: 100,
    queuedAt: "2026-08-18T08:00:00.000Z",
    promptText: "Improve the CLI.",
    acceptanceText: "Focused tests pass."
  });
  const completed = await readWorkTaskStatus(worldRoot, "completed-digest-task");
  await writeWorkTaskStatus(worldRoot, {
    ...completed,
    status: "accepted",
    startedAt: "2026-08-18T08:10:00.000Z",
    finishedAt: "2026-08-18T08:30:00.000Z",
    checkpoint: { ...completed.checkpoint, review: { decision: "ACCEPT", explanation: "CLI evidence passes." } }
  });
  await enqueueWorkTask(worldRoot, {
    taskId: "blocked-digest-task",
    owner: "background",
    kind: "roadmap",
    title: "Ceremony error propagation",
    priority: 120,
    queuedAt: "2026-08-18T08:00:00.000Z",
    promptText: "Reconcile the ceremony capability.",
    acceptanceText: "Focused tests pass.",
    checkpoint: { blocker: "automation branch integration blocked: merge conflict", integration: { status: "reconciliation" } }
  });
  const blockedDigestTask = await readWorkTaskStatus(worldRoot, "blocked-digest-task");
  await writeWorkTaskStatus(worldRoot, { ...blockedDigestTask, status: "blocked" });
  const capacity = { weekly: { identified: true, remainingPercent: 70, usedPercent: 30, resetAt: "2026-08-20T00:00:00.000Z", windowStartAt: "2026-08-13T00:00:00.000Z" } };
  await appendWorkSchedulerEvent(worldRoot, { type: "admitted", taskId: "completed-digest-task", capacity, workStarted: true, usefulWake: true, materialProgress: true }, { now: "2026-08-18T08:20:00.000Z" });
  await appendWorkSchedulerEvent(worldRoot, { type: "technical-blocked", reason: "no eligible work", capacity, workStarted: false }, { now: "2026-08-18T09:20:00.000Z" });
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    since: "2026-08-18T00:00:00.000Z",
    until: "2026-08-18T23:00:00.000Z",
    capacitySource: async () => capacity,
    now: "2026-08-18T23:00:00.000Z"
  });
  assert.match(digest.report, /Runnable roadmap/u);
  assert.doesNotMatch(digest.report, /No package completed today\./u);
  assert.doesNotMatch(digest.report, /No package completed today\./u);
  assert.match(digest.report, /Useful wakes: 1 \/ 2/u);
  assert.match(digest.report, /Blocked before model: 1/u);
});

test("daily digest counts a recovery and its admitted outcome as one useful wake", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-useful-wake-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(repositoryRoot, { recursive: true });
  const capacity = { weekly: { identified: true, remainingPercent: 80, usedPercent: 20, resetAt: "2026-08-20T00:00:00.000Z", windowStartAt: "2026-08-13T00:00:00.000Z" } };
  await appendWorkSchedulerEvent(worldRoot, {
    type: "recovered",
    taskId: "recovered-task",
    recoveryCount: 2,
    reason: "recovered after preflight",
    capacity
  }, { now: "2026-08-18T08:00:00.000Z" });
  await appendWorkSchedulerEvent(worldRoot, {
    type: "admitted",
    taskId: "recovered-task",
    capacity,
    workStarted: true,
    usefulWake: true,
    materialProgress: true
  }, { now: "2026-08-18T08:01:00.000Z" });
  await appendWorkSchedulerEvent(worldRoot, {
    type: "technical-blocked",
    reason: "no runnable integration candidate",
    capacity,
    workStarted: false
  }, { now: "2026-08-18T09:00:00.000Z" });
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    since: "2026-08-18T00:00:00.000Z",
    until: "2026-08-18T23:00:00.000Z",
    capacitySource: async () => capacity,
    now: "2026-08-18T23:00:00.000Z"
  });
  assert.match(digest.report, /Hourly wakes: 2/u);
  assert.match(digest.report, /Useful wakes: 1 \/ 2/u);
  assert.doesNotMatch(digest.report, /Useful wakes: [3-9]/u);
});

test("daily digest surfaces a long gap since the previous successful report", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-gap-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await writeWorkDailyDigestState(worldRoot, {
    "last report at": "2026-08-18T13:09:14.439Z",
    "last subject": "Pyash daily: roadmap work temporarily blocked",
    status: "roadmap-blocked"
  });
  const capacity = { weekly: { identified: true, remainingPercent: 100, usedPercent: 0, resetAt: "2026-08-27T11:30:02.000Z", windowStartAt: "2026-08-20T11:30:02.000Z" } };
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    capacitySource: async () => capacity,
    now: "2026-08-20T11:30:01.595Z",
    persist: false
  });
  assert.match(digest.report, /Reporting gap/u);
  assert.match(digest.report, /No successful daily digest was recorded for 46\.3 hours/u);
  assert.match(digest.report, /scheduled report interval should be checked/u);
});

test("timeout-blocked work is operationally blocked, not roadmap exhaustion", async () => {
  const { root, worldRoot } = await world("pyash-work-timeout-block-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "todo.md"), "Higher-level translation paths parity\n");
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-translation-parity-tranche",
    owner: "background",
    kind: "roadmap",
    title: "Complete a translation tranche",
    priority: 130,
    queuedAt: "2026-08-09T06:00:00.000Z",
    promptText: "Implement it.",
    acceptanceText: "Tests pass."
  });
  const task = await readWorkTaskStatus(worldRoot, "roadmap-translation-parity-tranche");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "blocked",
    checkpoint: { ...task.checkpoint, blocker: "turn timeout while starting Luna" }
  });
  const curation = await curateWorkBacklog({ worldRoot, repositoryRoot, dryRun: true });
  assert.equal(curation.needsDirection, false);
  assert.deepEqual(curation.retryable, ["roadmap-translation-parity-tranche"]);
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    since: "2026-08-09T00:00:00.000Z",
    until: "2026-08-09T23:00:00.000Z",
    capacitySource: async () => ({ weekly: { remainingPercent: 80, usedPercent: 20, resetAt: "2026-08-10T00:00:00.000Z" } }),
    now: "2026-08-09T23:00:00.000Z"
  });
  assert.equal(digest.status, "roadmap-partially-blocked");
  assert.doesNotMatch(digest.subject, /temporarily blocked/iu);
  assert.match(digest.report, /Operational blocks/iu);
  assert.doesNotMatch(digest.report, /backlog exhausted/iu);
});

test("technical blocked wakes are not reported as idle and blocker rationale stays compact", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-technical-block-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "todo.md"), "Mind: plus streaming path and richer reply envelopes\n");
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-mind-reply-envelope-streaming",
    owner: "background",
    kind: "roadmap",
    title: "Mind reply envelopes and streaming",
    priority: 110,
    queuedAt: "2026-08-09T06:00:00.000Z",
    promptText: "Fix the concrete compiled streaming correction.",
    acceptanceText: "Focused tests pass.",
    workSpec: { granularity: "substantial" }
  });
  const task = await readWorkTaskStatus(worldRoot, "roadmap-mind-reply-envelope-streaming");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "blocked",
    message: "revision limit reached: compiled stream duplicates output",
    checkpoint: {
      ...task.checkpoint,
      blocker: "revision limit reached: compiled stream duplicates output. CORRECTION: fix the duplicate emission and rerun targeted tests."
    }
  });
  const capacity = { weekly: { identified: true, remainingPercent: 85, usedPercent: 15, resetAt: "2026-08-10T00:00:00.000Z", windowStartAt: "2026-08-03T00:00:00.000Z" } };
  await appendWorkSchedulerEvent(worldRoot, { type: "idle", reason: "no eligible work", capacity }, { now: "2026-08-09T06:45:00.000Z" });
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    since: "2026-08-09T00:00:00.000Z",
    until: "2026-08-09T23:00:00.000Z",
    capacitySource: async () => capacity,
    now: "2026-08-09T23:00:00.000Z"
  });
  assert.match(digest.report, /Technical continuation unavailable: 1/u);
  assert.match(digest.report, /Idle \/ no work: 0/u);
  assert.match(digest.report, /correction required: compiled streaming duplicates output and loses reply metadata/u);
  assert.doesNotMatch(digest.report, /Sol review:.*full rationale/iu);
});

test("digest uses one canonical Next package for runnable and roadmap sections", () => {
  const digest = renderWorkDailyDigest({
    date: "2026-08-23",
    since: "2026-08-23T00:00:00.000Z",
    until: "2026-08-23T23:00:00.000Z",
    capacity: { weekly: { identified: true, remainingPercent: 90, usedPercent: 10 } },
    roadmap: {
      packages: [
        { taskId: "hq-organization-and-work-contract", title: "Define Headquarters organization and work contracts", status: "CANDIDATE" },
        { taskId: "product-alpha", title: "Product alpha qualification", status: "BLOCKED / EXTERNAL EVIDENCE", progress: "external evidence required" }
      ],
      externalEvidence: [{ taskId: "product-alpha", title: "Product alpha qualification", blocker: "external evidence required" }],
      needsDecision: [],
      retryableTechnical: []
    }
  });
  assert.match(digest.report, /Runnable roadmap[\s\S]*Next: Define Headquarters organization and work contracts/u);
  assert.match(digest.report, /ROADMAP[\s\S]*Next:\n  Define Headquarters organization and work contracts/u);
  assert.doesNotMatch(digest.report, /ROADMAP[\s\S]*Next:\n  \(none\)/u);
});

test("digest separates active work from dependency-waiting work", () => {
  const digest = renderWorkDailyDigest({
    date: "2026-08-23",
    since: "2026-08-23T00:00:00.000Z",
    until: "2026-08-23T23:00:00.000Z",
    capacity: { weekly: { identified: true, remainingPercent: 90, usedPercent: 10 } },
    tasks: [
      { taskId: "hq-fixture-mail-vertical-slice", title: "Prove Headquarters fixture mail", status: "ready" },
      { taskId: "hq-approval-and-resumption", title: "Add Headquarters approval", status: "ready" }
    ],
    roadmap: {
      packages: [
        {
          taskId: "hq-fixture-mail-vertical-slice",
          title: "Prove Headquarters fixture mail",
          status: "QUEUED",
          dependencyStatus: { satisfied: false, unmet: [{ dependency: "hq-organization-and-work-contract", reason: "status is blocked" }] }
        },
        {
          taskId: "hq-approval-and-resumption",
          title: "Add Headquarters approval",
          status: "QUEUED",
          dependencyStatus: { satisfied: false, unmet: [{ dependency: "hq-fixture-mail-vertical-slice", reason: "not integrated" }] }
        },
        {
          taskId: "roadmap-command-result-identity",
          title: "Add durable per-command result identity",
          status: "CANDIDATE",
          dependencyStatus: { satisfied: true, unmet: [] }
        }
      ],
      externalEvidence: [],
      needsDecision: [],
      retryableTechnical: []
    }
  });
  assert.match(digest.report, /Current work\n------------\n\(none\)/u);
  assert.match(digest.report, /Waiting on dependencies[\s\S]*Prove Headquarters fixture mail/u);
  assert.match(digest.report, /ROADMAP[\s\S]*Next:\n  Add durable per-command result identity/u);
  assert.match(digest.report, /Current work\n------------\n\(none\)\n\nWaiting on dependencies/u);
});

test("product-alpha qualification is shown as external evidence, not technical correction", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-product-alpha-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "roadmap.md"), "Product alpha\n");
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-product-alpha-soak",
    owner: "background",
    kind: "roadmap",
    title: "Prove product alpha",
    priority: 85,
    promptText: "Prove it.",
    acceptanceText: "Qualification evidence exists."
  });
  const task = await readWorkTaskStatus(worldRoot, "roadmap-product-alpha-soak");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "blocked",
    message: "awaiting external evidence: Matrix qualification, CI URL, day-zero real-backend smoke, and a genuine uninterrupted 168-hour soak ledger remain required",
    checkpoint: {
      ...task.checkpoint,
      blocker: "awaiting external evidence: Matrix qualification, CI URL, day-zero real-backend smoke, and a genuine uninterrupted 168-hour soak ledger remain required"
    }
  });
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    capacitySource: async () => ({ weekly: { identified: true, remainingPercent: 95, usedPercent: 5, resetAt: "2026-08-27T00:00:00.000Z", windowStartAt: "2026-08-20T00:00:00.000Z" } }),
    now: "2026-08-22T15:00:00.000Z",
    persist: false
  });
  assert.match(digest.report, /External evidence waiting[\s\S]*Matrix qualification/iu);
  assert.doesNotMatch(digest.report, /technical correction required: awaiting external evidence/iu);
});
