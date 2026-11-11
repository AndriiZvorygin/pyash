import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyArtifactRetention,
  createArtifactRetentionPlan,
  runConfiguredArtifactRetention,
} from "../command/prune_artifacts.mjs";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const OLD = Date.parse("2026-01-01T00:00:00.000Z");
const HASH = "a".repeat(64);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-artifact-retention-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function setTreeTime(target, timeMs) {
  const stat = fs.lstatSync(target);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const entry of fs.readdirSync(target)) setTreeTime(path.join(target, entry), timeMs);
  }
  fs.utimesSync(target, timeMs / 1000, timeMs / 1000);
}

function addContentObject(root, hash = HASH) {
  const object = path.join(root, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.png`);
  fs.mkdirSync(path.dirname(object), { recursive: true });
  fs.writeFileSync(object, "image bytes");
  fs.utimesSync(object, OLD / 1000, OLD / 1000);
  return object;
}

test("artifact retention defaults to a read-only plan and preserves persistent paths", (t) => {
  const root = fixture(t);
  const oldRun = path.join(root, "artifacts", "20260101-001-old-run");
  const persistent = path.join(root, "artifacts", "downloads", "keep.bin");
  const heldRun = path.join(root, "world", "holding", "artifacts", "20260101-002-held-run", "output.txt");
  fs.mkdirSync(oldRun, { recursive: true });
  fs.writeFileSync(path.join(oldRun, "result.pya"), "old log");
  fs.mkdirSync(path.dirname(persistent), { recursive: true });
  fs.writeFileSync(persistent, "keep");
  fs.mkdirSync(path.dirname(heldRun), { recursive: true });
  fs.writeFileSync(heldRun, "keep");
  setTreeTime(oldRun, OLD);
  setTreeTime(path.dirname(heldRun), OLD);

  const plan = createArtifactRetentionPlan({ root, now: NOW });
  assert.deepEqual(plan.runDirectories.map((item) => item.relative), ["artifacts/20260101-001-old-run"]);
  assert.equal(fs.existsSync(path.join(oldRun, "result.pya")), true);
  assert.equal(fs.existsSync(persistent), true);
  assert.equal(fs.existsSync(heldRun), true);
});

test("apply removes expired run logs before collecting their unreferenced content object", (t) => {
  const root = fixture(t);
  const object = addContentObject(root);
  const run = path.join(root, "artifacts", "20260101-001-old-run");
  const alias = path.join(run, "image.png");
  fs.mkdirSync(run, { recursive: true });
  fs.linkSync(object, alias);
  fs.writeFileSync(path.join(run, "run.pya"), `su name image sha256 ${HASH} ya\n`);
  setTreeTime(run, OLD);

  const preview = createArtifactRetentionPlan({ root, now: NOW });
  assert.equal(preview.contentStore.eligibleObjects, 1);
  assert.equal(fs.existsSync(alias), true);
  assert.equal(fs.existsSync(object), true);

  const result = applyArtifactRetention({ root, now: NOW });
  assert.deepEqual(result.failures, []);
  assert.equal(fs.existsSync(run), false);
  assert.equal(fs.existsSync(object), false);
  assert.equal(result.removedContentObjects.length, 1);
});

test("a retained newspaper reference protects its content-addressed object", (t) => {
  const root = fixture(t);
  const object = addContentObject(root);
  const log = path.join(root, "newspaper", "current-run.pya");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, `su name source hash ob text "${HASH}" ya\n`);
  fs.utimesSync(log, NOW / 1000, NOW / 1000);

  const plan = createArtifactRetentionPlan({ root, now: NOW });
  assert.equal(plan.contentStore.referencedObjects, 1);
  assert.equal(plan.contentStore.eligibleObjects, 0);
  assert.equal(fs.existsSync(object), true);
});

test("old newspaper logs expire, while recent logs remain", (t) => {
  const root = fixture(t);
  const oldLog = path.join(root, "newspaper", "20260101-run.pya");
  const recentLog = path.join(root, "newspaper", "20261109-run.pya");
  fs.mkdirSync(path.dirname(oldLog), { recursive: true });
  fs.writeFileSync(oldLog, "old");
  fs.writeFileSync(recentLog, "recent");
  fs.utimesSync(oldLog, OLD / 1000, OLD / 1000);
  fs.utimesSync(recentLog, NOW / 1000, NOW / 1000);

  const result = applyArtifactRetention({ root, now: NOW });
  assert.equal(fs.existsSync(oldLog), false);
  assert.equal(fs.existsSync(recentLog), true);
  assert.deepEqual(result.failures, []);
});

test("configured thirty-day retention removes old logs and four-digit dated runs", async (t) => {
  const root = fixture(t);
  const cutoffOld = NOW - 31 * 24 * 60 * 60 * 1000;
  const config = path.join(root, "configure", "default.pya");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, [
    "exists su name newspaper maximum bytes ob num 1000 be default ya",
    "exists su name newspaper segment maximum bytes ob num 500 be default ya",
    "exists su name newspaper maximum age days ob num 30 be default ya",
    "",
  ].join("\n"));
  const run = path.join(root, "artifacts", "20261001-1000-old-run");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "result.pya"), "old result");
  setTreeTime(run, cutoffOld);
  const oldLog = path.join(root, "newspaper", "old-run.pya");
  const currentLog = path.join(root, "newspaper", "current-run.pya");
  fs.mkdirSync(path.dirname(oldLog), { recursive: true });
  fs.writeFileSync(oldLog, "old newspaper");
  fs.writeFileSync(currentLog, "current newspaper");
  fs.utimesSync(oldLog, cutoffOld / 1000, cutoffOld / 1000);
  fs.utimesSync(currentLog, NOW / 1000, NOW / 1000);

  const result = await runConfiguredArtifactRetention({ root, now: NOW });
  assert.equal(result.plan.retentionDays, 30);
  assert.equal(result.plan.runDirectories.some((item) => item.relative === "artifacts/20261001-1000-old-run"), true);
  assert.equal(result.plan.newspaperFiles.some((item) => item.relative === "newspaper/old-run.pya"), true);
  assert.equal(result.plan.newspaperFiles.some((item) => item.relative === "newspaper/current-run.pya"), false);
});

test("artifact retention CLI can preview one workspace using another checkout's config", (t) => {
  const root = fixture(t);
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-retention-config-"));
  t.after(() => fs.rmSync(configRoot, { recursive: true, force: true }));
  const config = path.join(configRoot, "configure", "default.pya");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, [
    "exists su name newspaper maximum bytes ob num 1000 be default ya",
    "exists su name newspaper segment maximum bytes ob num 500 be default ya",
    "exists su name newspaper maximum age days ob num 30 be default ya",
    "",
  ].join("\n"));
  const run = path.join(root, "artifacts", "20261001-1000-old-run");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "result.pya"), "old result");
  setTreeTime(run, Date.parse("2026-10-01T00:00:00.000Z"));

  const command = path.resolve("command/prune_artifacts.mjs");
  const child = spawnSync(process.execPath, [command, "--root", root, "--config-root", configRoot, "--json"], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.mode, "preview");
  assert.equal(result.plan.retentionDays, 30);
  assert.ok(result.plan.runDirectories.some((item) => item.relative === "artifacts/20261001-1000-old-run"));
});

test("a retained newspaper run reference protects an aged artifact directory", (t) => {
  const root = fixture(t);
  const runId = "20260101-001-old-run";
  const run = path.join(root, "artifacts", runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "result.pya"), "old result");
  setTreeTime(run, OLD);
  const currentLog = path.join(root, "newspaper", "current-run.pya");
  fs.mkdirSync(path.dirname(currentLog), { recursive: true });
  fs.writeFileSync(currentLog, `exists su name ${runId} be run ya\n`);
  fs.utimesSync(currentLog, NOW / 1000, NOW / 1000);

  const plan = createArtifactRetentionPlan({ root, now: NOW, retentionDays: 30 });
  assert.equal(plan.runDirectories.some((item) => item.relative === `artifacts/${runId}`), false);
});

test("thirty-day retention recognizes old date-stamped run folders without sequence numbers", (t) => {
  const root = fixture(t);
  const runId = "20260101-hardoff-check";
  const run = path.join(root, "artifacts", runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "result.pya"), "old result");
  setTreeTime(run, OLD);

  const plan = createArtifactRetentionPlan({ root, now: NOW, retentionDays: 30 });
  assert.equal(plan.runDirectories.some((item) => item.relative === `artifacts/${runId}`), true);
});

test("expired nested newspapers are removed before their aged run folder", (t) => {
  const root = fixture(t);
  const runId = "20260101-001-old-run";
  const run = path.join(root, "artifacts", runId);
  const nestedLog = path.join(run, "newspaper", "stage.pya");
  fs.mkdirSync(path.dirname(nestedLog), { recursive: true });
  fs.writeFileSync(nestedLog, `exists su name ${runId} be run ya\n`);
  setTreeTime(run, OLD);

  const result = applyArtifactRetention({ root, now: NOW, retentionDays: 30 });
  assert.deepEqual(result.failures, []);
  assert.equal(fs.existsSync(run), false);
});

test("old newspaper hardlinks account for link counts changed by prior planned removals", (t) => {
  const root = fixture(t);
  const first = path.join(root, "newspaper", "20260101-first.pya");
  const second = path.join(root, "world", "newspaper", "20260101-second.pya");
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.mkdirSync(path.dirname(second), { recursive: true });
  fs.writeFileSync(first, "same expired log\n");
  fs.linkSync(first, second);
  fs.utimesSync(first, OLD / 1000, OLD / 1000);

  const result = applyArtifactRetention({ root, now: NOW, retentionDays: 30 });
  assert.deepEqual(result.failures, []);
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
});

test("locked and recently modified dated runs are retained", (t) => {
  const root = fixture(t);
  const lockedRun = path.join(root, "artifacts", "20260101-001-locked-run");
  const recentRun = path.join(root, "artifacts", "20260101-002-recent-run");
  fs.mkdirSync(lockedRun, { recursive: true });
  fs.writeFileSync(path.join(lockedRun, "run.lock"), "active");
  fs.mkdirSync(recentRun, { recursive: true });
  fs.writeFileSync(path.join(recentRun, "result.pya"), "recent update");
  setTreeTime(lockedRun, OLD);
  setTreeTime(recentRun, NOW);

  const plan = createArtifactRetentionPlan({ root, now: NOW });
  assert.equal(plan.runDirectories.length, 0);
});

test("an incomplete reference scan disables content-store collection", (t) => {
  const root = fixture(t);
  const object = addContentObject(root);
  const oversized = path.join(root, "newspaper", "oversized.pya");
  fs.mkdirSync(path.dirname(oversized), { recursive: true });
  const descriptor = fs.openSync(oversized, "w");
  fs.ftruncateSync(descriptor, 64 * 1024 * 1024 + 1);
  fs.closeSync(descriptor);

  const plan = createArtifactRetentionPlan({ root, now: NOW });
  assert.equal(plan.scan.complete, false);
  assert.equal(plan.contentStore.deletionDisabled, true);
  assert.equal(plan.contentStore.eligibleObjects, 0);
  assert.equal(fs.existsSync(object), true);
});

test("a symlink in an artifact reference area fails closed for blob collection", (t) => {
  const root = fixture(t);
  const object = addContentObject(root);
  const target = path.join(root, "outside-manifest.pya");
  const link = path.join(root, "artifacts", "notes", "manifest.pya");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.writeFileSync(target, `su name source hash ob text "${HASH}" ya\n`);
  fs.symlinkSync(target, link);

  const plan = createArtifactRetentionPlan({ root, now: NOW });
  assert.equal(plan.scan.complete, false);
  assert.equal(plan.contentStore.deletionDisabled, true);
  assert.equal(plan.contentStore.eligibleObjects, 0);
  assert.equal(fs.existsSync(object), true);
});
