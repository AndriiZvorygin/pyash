import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyArtifactRetention,
  createArtifactRetentionPlan,
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
