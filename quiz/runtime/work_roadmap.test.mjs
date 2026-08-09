import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import {
  autonomousRoadmapPackages,
  buildAutonomousRoadmap,
  readAutonomousRoadmap,
  refreshAutonomousRoadmap,
  renderAutonomousRoadmapReport
} from "../../program/runtime/work/roadmap.mjs";

async function world(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "todo.md"), "Higher-level translation paths parity\n");
  await fs.writeFile(path.join(repositoryRoot, "documentation", "roadmap.md"), "Next milestone: Agent harness (research + builder)\n");
  return { root, worldRoot, repositoryRoot };
}

test("autonomous roadmap derives substantial package status from durable work state", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-roadmap-state-");
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-translation-parity-tranche",
    owner: "background",
    kind: "roadmap",
    title: "Complete the higher-level translation parity tranche",
    priority: 125,
    promptText: "Implement the tranche.",
    acceptanceText: "Interpreter and JavaScript parity pass.",
    workSpec: { granularity: "substantial" }
  });
  const roadmap = await buildAutonomousRoadmap({ worldRoot, repositoryRoot, now: "2026-08-09T12:00:00.000Z" });
  const active = roadmap.packages.find((item) => item.taskId === "roadmap-translation-parity-tranche");
  assert.equal(active.status, "QUEUED");
  assert.equal(roadmap.packages.length, 8);
  assert.ok(roadmap.packages.filter((item) => item.status === "CANDIDATE").length >= 5);
  assert.match(renderAutonomousRoadmapReport(roadmap), /PYASH AUTONOMOUS ROADMAP/);
  assert.match(await fs.readFile(roadmap.paths.pya, "utf8"), /work autonomous roadmap package roadmap-translation-parity-tranche/u);
  assert.match(await fs.readFile(roadmap.paths.markdown, "utf8"), /Complete the higher-level translation parity tranche/u);
  const reread = await readAutonomousRoadmap(worldRoot);
  assert.equal(reread.packages.find((item) => item.taskId === active.taskId).status, "QUEUED");
});

test("roadmap refresh uses an injected Sol client and persists a bounded proposal", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-roadmap-refresh-");
  const packages = autonomousRoadmapPackages().slice(0, 5).map((item, index) => ({
    taskId: `architect-package-${index + 1}`,
    title: item.title,
    source: item.sourceAnchor,
    sourcePath: item.sourcePath,
    sourceAnchor: item.sourceAnchor,
    whyMatters: item.whyMatters,
    dependencies: item.dependencies,
    scope: item.scope,
    nonGoals: item.nonGoals,
    acceptance: item.acceptance,
    priority: item.priority - index,
    prompt: item.prompt,
    whyNow: item.whyNow
  }));
  const calls = [];
  const result = await refreshAutonomousRoadmap({
    worldRoot,
    repositoryRoot,
    now: "2026-08-09T12:00:00.000Z",
    roleConfig: { manager: { model: "sol-test", reasoningEffort: "low" } },
    appServerFactory: async () => ({
      async startThread() {
        calls.push("startThread");
        return { thread: { id: "roadmap-sol-thread" } };
      },
      async runTurn(options) {
        calls.push(options.requestIdentity ? "runTurn" : "missing-identity");
        return { turnId: "roadmap-refresh-turn", text: JSON.stringify({ summary: "Reconciled the next language packages.", decisions: ["Keep C parity deferred until JS is stable."], packages }) };
      },
      async close() {
        calls.push("close");
      }
    })
  });
  assert.equal(result.status, "refreshed");
  assert.deepEqual(calls, ["startThread", "runTurn", "close"]);
  assert.equal(result.roadmap.architect.threadId, "roadmap-sol-thread");
  assert.equal(result.roadmap.packages.length, 5);
  assert.match(await fs.readFile(result.roadmap.paths.pya, "utf8"), /last sol summary/iu);
  const rebuilt = await buildAutonomousRoadmap({ worldRoot, repositoryRoot });
  assert.deepEqual(
    rebuilt.packages.map((item) => item.taskId),
    result.roadmap.packages.map((item) => item.taskId)
  );
});

test("roadmap progress preserves active Luna checkpoint evidence", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-roadmap-progress-");
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-translation-parity-tranche",
    owner: "background",
    kind: "roadmap",
    title: "Complete the higher-level translation parity tranche",
    priority: 125,
    promptText: "Implement the tranche.",
    acceptanceText: "Interpreter and JavaScript parity pass."
  });
  const status = await readWorkTaskStatus(worldRoot, "roadmap-translation-parity-tranche");
  await writeWorkTaskStatus(worldRoot, {
    ...status,
    status: "implementing",
    checkpoint: {
      ...status.checkpoint,
      implementation: {
        ...status.checkpoint.implementation,
        summary: "1 implementation pass; awaiting next wake",
        passes: 1
      }
    }
  });
  const roadmap = await buildAutonomousRoadmap({ worldRoot, repositoryRoot });
  const active = roadmap.packages.find((item) => item.taskId === "roadmap-translation-parity-tranche");
  assert.equal(active.status, "ACTIVE");
  assert.match(active.progress, /implementation pass/iu);
});
