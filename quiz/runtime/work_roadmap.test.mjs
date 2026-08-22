import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { archiveWorkTask } from "../../program/runtime/work/operator.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import {
  autonomousRoadmapPackages,
  buildAutonomousRoadmap,
  isAwaitingExternalEvidence,
  isHumanDecisionBlock,
  isRetryableWorkBlock,
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

test("live system refusal is external evidence, not technical retry or human direction", () => {
  const task = {
    status: "blocked",
    checkpoint: {
      blocker: "The implementation corrections are complete and focused tests pass. Acceptance now depends solely on required live systems: configured search at localhost:60490 and Ollama at localhost:11434 both refuse connections. Further Luna turns cannot produce fixture-free evidence."
    }
  };
  assert.equal(isAwaitingExternalEvidence(task), true);
  assert.equal(isRetryableWorkBlock(task), false);
  assert.equal(isHumanDecisionBlock(task), false);
});

test("external evidence progress removes duplicated classification prefixes", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-roadmap-external-prefix-");
  const roadmap = await buildAutonomousRoadmap({
    worldRoot,
    repositoryRoot,
    persist: false,
    tasks: [{
      taskId: "roadmap-product-alpha-soak",
      title: "Prove product alpha",
      status: "blocked",
      priority: 85,
      checkpoint: {
        blocker: "awaiting external evidence: awaiting external evidence: Matrix qualification remains required"
      },
      workSpec: {}
    }]
  });
  const product = roadmap.packages.find((item) => item.taskId === "roadmap-product-alpha-soak");
  assert.match(product.progress, /^awaiting external evidence: Matrix qualification remains required$/u);
});

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
  assert.ok(roadmap.packages.length >= 11);
  assert.ok(roadmap.packages.filter((item) => item.status === "CANDIDATE").length >= 8);
  assert.match(renderAutonomousRoadmapReport(roadmap), /PYASH AUTONOMOUS ROADMAP/);
  assert.match(await fs.readFile(roadmap.paths.pya, "utf8"), /work autonomous roadmap package roadmap-translation-parity-tranche/u);
  assert.match(await fs.readFile(roadmap.paths.markdown, "utf8"), /Complete the higher-level translation parity tranche/u);
  const reread = await readAutonomousRoadmap(worldRoot);
  assert.equal(reread.packages.find((item) => item.taskId === active.taskId).status, "QUEUED");
});

test("Personal Headquarters packages survive an older generated roadmap catalog", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-roadmap-headquarters-");
  await fs.mkdir(path.join(worldRoot, "holding", "work", "artifacts"), { recursive: true });
  await fs.writeFile(path.join(worldRoot, "holding", "work", "artifacts", "autonomous-roadmap.pya"), [
    "su name work autonomous roadmap state be map def",
    "  su name schema ob text \"3\" ya",
    "prah",
    "su name work autonomous roadmap package old-generated-package be map def",
    "  su name task id ob text \"old-generated-package\" ya",
    "  su name title ob text \"Old package\" ya",
    "  su name source path ob text \"documentation/roadmap.md\" ya",
    "  su name source anchor ob text \"old package\" ya",
    "prah",
    ""
  ].join("\n"));
  const roadmap = await buildAutonomousRoadmap({ worldRoot, repositoryRoot, persist: false });
  const ids = roadmap.packages.map((item) => item.taskId);
  assert.equal(roadmap.schema, "4");
  assert.equal(ids.includes("old-generated-package"), false);
  assert.deepEqual(
    ids.filter((taskId) => taskId.startsWith("hq-")),
    [
      "hq-organization-and-work-contract",
      "hq-fixture-mail-vertical-slice",
      "hq-approval-and-resumption",
      "hq-chief-briefing",
      "hq-email-and-capability-boundaries",
      "hq-contacts-commitments-knowledge-alignment",
      "hq-state-api-and-2d-projection",
      "hq-temporary-workers-and-workload-evaluation"
    ]
  );
  assert.ok(roadmap.packages
    .filter((item) => item.taskId.startsWith("hq-"))
    .every((item) => item.nonGoals && item.whyMatters));
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

test("schema change discards stale generated catalogs during reconciliation", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-roadmap-schema-");
  await fs.mkdir(path.join(worldRoot, "holding", "work", "artifacts"), { recursive: true });
  await fs.writeFile(path.join(worldRoot, "holding", "work", "artifacts", "autonomous-roadmap.pya"), [
    "su name work autonomous roadmap state be map def",
    "  su name schema ob text \"1\" ya",
    "prah",
    "su name work autonomous roadmap package stale-generated-task be map def",
    "  su name task id ob text \"stale-generated-task\" ya",
    "  su name title ob text \"Stale generated task\" ya",
    "  su name source path ob text \"documentation/todo.md\" ya",
    "  su name source anchor ob text \"stale\" ya",
    "prah",
    ""
  ].join("\n"));
  const roadmap = await buildAutonomousRoadmap({ worldRoot, repositoryRoot });
  assert.equal(roadmap.packages.some((item) => item.taskId === "stale-generated-task"), false);
  assert.ok(roadmap.packages.some((item) => item.taskId === "roadmap-agent-research-tool-chain"));
  assert.equal(roadmap.reconciliation.source, "documentation/reference/roadmap-reconciliation-2026-08.md");
});

test("superseded maintenance remains durable but cannot become roadmap work", async () => {
  const { worldRoot, repositoryRoot } = await world("pyash-roadmap-superseded-");
  await enqueueWorkTask(worldRoot, {
    taskId: "work-accepted-report",
    owner: "background",
    kind: "maintenance",
    title: "historical report demonstration",
    promptText: "Preserve the historical result.",
    acceptanceText: "The historical report remains readable.",
    workSpec: { granularity: "substantial" }
  });
  await archiveWorkTask(worldRoot, "work-accepted-report", "superseded by durable report coverage");
  const roadmap = await buildAutonomousRoadmap({ worldRoot, repositoryRoot });
  assert.equal(roadmap.needsDecision.some((item) => item.taskId === "work-accepted-report"), false);
  assert.equal(roadmap.retryable.some((item) => item.taskId === "work-accepted-report"), false);
  const stored = await readWorkTaskStatus(worldRoot, "work-accepted-report");
  assert.equal(stored.workSpec.archived, true);
  assert.equal(stored.workSpec.lifecycle, "superseded");
});
