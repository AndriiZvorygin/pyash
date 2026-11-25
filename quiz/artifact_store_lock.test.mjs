import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { acquireArtifactStoreLock, registerArtifactRun } from "../program/library/artifact_store_lock.mjs";

async function makeTempDir(prefix = "artifact-lock-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function aliveOwner(pid = process.pid) {
  return [
    "su name artifact store maintenance lock be json map def",
    `su name process id ob num ${pid} be number ya`,
    `su name lock token ob text "abcdef0123456789abcdef0123456789" be text ya`,
    "prah",
    ""
  ].join("\n");
}

test("the lock is taken and released", async () => {
  const root = await makeTempDir();
  const release = await acquireArtifactStoreLock(root);
  const lockPath = path.join(root, "artifacts", ".maintenance-lock");
  assert.ok(await fs.stat(lockPath), "the lock is there while it is held");
  await release();
  await assert.rejects(() => fs.stat(lockPath), "the lock is gone once it is released");
});

test("a lock held by a living run is waited for, not fought over", async () => {
  const root = await makeTempDir();
  const lockPath = path.join(root, "artifacts", ".maintenance-lock");
  await fs.mkdir(lockPath, { recursive: true });
  await fs.writeFile(path.join(lockPath, "owner.pya"), aliveOwner());

  // Another run holds the lock and lets go a moment later.
  setTimeout(async () => {
    await fs.rm(lockPath, { recursive: true, force: true });
  }, 120);

  const release = await acquireArtifactStoreLock(root, { waitMs: 5000, pollMs: 20 });
  await release();
});

test("a lock held by a dead run is stale and is taken over", async () => {
  const root = await makeTempDir();
  const lockPath = path.join(root, "artifacts", ".maintenance-lock");
  await fs.mkdir(lockPath, { recursive: true });
  await fs.writeFile(path.join(lockPath, "owner.pya"), aliveOwner(999999));

  const release = await acquireArtifactStoreLock(root, { waitMs: 1000, pollMs: 20 });
  await release();
});

test("a lock that is never given up is a failure", async () => {
  const root = await makeTempDir();
  const lockPath = path.join(root, "artifacts", ".maintenance-lock");
  await fs.mkdir(lockPath, { recursive: true });
  await fs.writeFile(path.join(lockPath, "owner.pya"), aliveOwner());

  await assert.rejects(
    () => acquireArtifactStoreLock(root, { waitMs: 150, pollMs: 20 }),
    /locked by process/u
  );
  await fs.rm(lockPath, { recursive: true, force: true });
});

test("runs that start together do not fight over the lock", async () => {
  const root = await makeTempDir();
  const marks = [];
  await Promise.all(Array.from({ length: 8 }, async (_unused, index) => {
    const release = await acquireArtifactStoreLock(root, { waitMs: 10000, pollMs: 10 });
    marks.push(index);
    await release();
  }));
  assert.equal(marks.length, 8, "every run took the lock in turn");
});

test("a registered run leaves its mark and takes it away again", async () => {
  const root = await makeTempDir();
  const { markerPath, cleanup } = await registerArtifactRun({ root, runId: "radio-test" });
  assert.ok(await fs.stat(markerPath), "the run is marked as active");
  cleanup();
  await assert.rejects(() => fs.stat(markerPath), "the mark is gone after the run");
});
