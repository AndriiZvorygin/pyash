import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureSpoolDirs,
  makeSpoolFilename,
  writeSpoolItem,
  listSpoolItemsOldestFirst,
  claimSpoolItem,
  completeSpoolItem,
  failSpoolItem
} from "../program/library/spool.mjs";

test("makeSpoolFilename renders stable sortable format", () => {
  const name = makeSpoolFilename({
    at: "2026-02-13T18:30:11.000Z",
    channelType: "matrix",
    agentName: "mricge",
    roomName: "!room:matrix.liberit.ca",
    kind: "event",
    hash: "abc123def456"
  });
  assert.equal(
    name,
    "20260213-183011-matrix-mricge-room-matrix.liberit.ca-event-abc123def456.pya"
  );
});

test("spool writes atomically and lists oldest first", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-spool-order-"));
  const tmpDir = path.join(root, "tmp");
  const inputDir = path.join(root, "input");
  await ensureSpoolDirs(root, [tmpDir, inputDir]);

  const first = makeSpoolFilename({
    at: "2026-02-13T18:30:10.000Z",
    channelType: "matrix",
    agentName: "a",
    roomName: "r",
    kind: "event",
    hash: "aaaa"
  });
  const second = makeSpoolFilename({
    at: "2026-02-13T18:30:11.000Z",
    channelType: "matrix",
    agentName: "a",
    roomName: "r",
    kind: "event",
    hash: "bbbb"
  });

  await writeSpoolItem({ tmpDir, targetDir: inputDir, filename: second, text: "two\n" });
  await writeSpoolItem({ tmpDir, targetDir: inputDir, filename: first, text: "one\n" });

  const names = await listSpoolItemsOldestFirst(inputDir);
  assert.deepEqual(names, [first, second]);
});

test("spool write does not overwrite when filename collides", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-spool-collision-"));
  const tmpDir = path.join(root, "tmp");
  const inputDir = path.join(root, "input");
  await ensureSpoolDirs(root, [tmpDir, inputDir]);

  const filename = makeSpoolFilename({
    at: "2026-02-13T18:30:10.000Z",
    channelType: "matrix",
    agentName: "a",
    roomName: "r",
    kind: "produce",
    hash: "samehash"
  });
  const first = await writeSpoolItem({ tmpDir, targetDir: inputDir, filename, text: "one\n" });
  const second = await writeSpoolItem({ tmpDir, targetDir: inputDir, filename, text: "two\n" });

  assert.equal(first.filename, filename);
  assert.notEqual(second.filename, filename);
  const names = await listSpoolItemsOldestFirst(inputDir);
  assert.equal(names.length, 2);
});

test("spool claim moves one item into runtime and prevents double claim", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-spool-claim-"));
  const tmpDir = path.join(root, "tmp");
  const inputDir = path.join(root, "input");
  const runtimeDir = path.join(root, "runtime");
  await ensureSpoolDirs(root, [tmpDir, inputDir, runtimeDir]);
  const filename = makeSpoolFilename({
    at: "2026-02-13T18:30:10.000Z",
    channelType: "matrix",
    agentName: "a",
    roomName: "r",
    kind: "event",
    hash: "claim"
  });
  await writeSpoolItem({ tmpDir, targetDir: inputDir, filename, text: "hello\n" });

  const firstClaim = await claimSpoolItem({
    fromDir: inputDir,
    runtimeDir,
    filename,
    workerTag: "router"
  });
  assert.ok(firstClaim?.path);
  const secondClaim = await claimSpoolItem({
    fromDir: inputDir,
    runtimeDir,
    filename,
    workerTag: "router2"
  });
  assert.equal(secondClaim, null);
});

test("spool complete and fail/requeue move files to expected destinations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-spool-move-"));
  const tmpDir = path.join(root, "tmp");
  const inputDir = path.join(root, "input");
  const runtimeDir = path.join(root, "runtime");
  const successDir = path.join(root, "produce", "success");
  const failDir = path.join(root, "produce", "fail");
  await ensureSpoolDirs(root, [tmpDir, inputDir, runtimeDir, successDir, failDir]);

  const successName = makeSpoolFilename({
    at: "2026-02-13T18:30:10.000Z",
    channelType: "matrix",
    agentName: "a",
    roomName: "r",
    kind: "produce",
    hash: "ok"
  });
  await writeSpoolItem({ tmpDir, targetDir: inputDir, filename: successName, text: "ok\n" });
  const claim = await claimSpoolItem({ fromDir: inputDir, runtimeDir, filename: successName });
  const completedPath = await completeSpoolItem({ runtimePath: claim.path, successDir });
  assert.match(completedPath, /produce\/success\//);

  const failName = makeSpoolFilename({
    at: "2026-02-13T18:30:11.000Z",
    channelType: "matrix",
    agentName: "a",
    roomName: "r",
    kind: "produce",
    hash: "fail"
  });
  await writeSpoolItem({ tmpDir, targetDir: inputDir, filename: failName, text: "no\n" });
  const failClaim = await claimSpoolItem({ fromDir: inputDir, runtimeDir, filename: failName });
  const requeuedPath = await failSpoolItem({
    runtimePath: failClaim.path,
    failDir,
    requeueDir: inputDir,
    retryCount: 0,
    maxRetries: 2
  });
  assert.match(requeuedPath, /\/input\//);

  const requeuedName = path.basename(requeuedPath);
  const failClaim2 = await claimSpoolItem({ fromDir: inputDir, runtimeDir, filename: requeuedName });
  const failedPath = await failSpoolItem({
    runtimePath: failClaim2.path,
    failDir,
    requeueDir: inputDir,
    retryCount: 2,
    maxRetries: 2
  });
  assert.match(failedPath, /produce\/fail\//);
});

test("spool requeue strips accumulated worker suffixes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-spool-worker-suffix-"));
  const runtimeDir = path.join(root, "runtime");
  const inputDir = path.join(root, "input");
  const failDir = path.join(root, "fail");
  await ensureSpoolDirs(root, [runtimeDir, inputDir, failDir]);
  const bloatedName = "20260214-002952-matrix-mricge-room-produce-hash--mricge-produce--mricge-produce--mricge-produce.pya";
  const runtimePath = path.join(runtimeDir, bloatedName);
  await fs.writeFile(runtimePath, "x\n", "utf8");
  const requeued = await failSpoolItem({
    runtimePath,
    failDir,
    requeueDir: inputDir,
    retryCount: 0,
    maxRetries: 2
  });
  const base = path.basename(requeued);
  assert.equal(base.includes("--mricge-produce"), false);
  assert.match(base, /^20260214-002952-matrix-mricge-room-produce-hash\.pya$/);
});
