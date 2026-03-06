import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";
import { claimOldestInputEnvelope } from "../program/agent/android_core/queue.mjs";
import { queueDepth } from "../program/agent/android_core/queue.mjs";

async function run(line) {
  return interpret(parse(line));
}

function setWorldRoot(worldRoot) {
  doRemember({
    mood: "ya",
    su: { name: "world root" },
    ob: { filename: worldRoot },
    be: "root"
  });
}

test("android verify sentence enqueues command envelope with queued status", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-verb-verify-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  const result = await run('su name cmd verify 1 from text "emulator-5554" be android verify do');
  assert.equal(result?.be, "android command");
  assert.equal(result?.vyah?.name, "start");
  assert.equal(result?.as?.name, "verify");
  assert.equal(result?.from?.text, "emulator-5554");

  const claimed = await claimOldestInputEnvelope(worldRoot, { workerTag: "quiz" });
  assert.equal(claimed?.envelope?.deviceId, "emulator-5554");
  assert.equal(claimed?.envelope?.commandId, "cmd verify 1");
  assert.equal(claimed?.envelope?.payloadSentence?.be, "android verify");
});

test("android tap sentence keeps coordinate vector payload for lowering", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-verb-tap-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await run('su name cmd tap 1 from text "emulator-5554" ob ve num 120 640 be android tap do');
  const claimed = await claimOldestInputEnvelope(worldRoot, { workerTag: "quiz" });
  const payload = claimed?.envelope?.payloadSentence;
  assert.equal(payload?.be, "android tap");
  assert.deepEqual(payload?.ob?.ve?.values, [120, 640]);
});

test("android press sentence keeps keyevent payload for lowering", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-verb-press-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await run('from text "emulator-5554" ob text "KEYCODE_HOME" be android press do');
  const claimed = await claimOldestInputEnvelope(worldRoot, { workerTag: "quiz" });
  const payload = claimed?.envelope?.payloadSentence;
  assert.equal(payload?.be, "android press");
  assert.equal(payload?.ob?.text, "KEYCODE_HOME");
});

test("android send sentence supports remote transfer arguments", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-verb-send-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);
  const localPath = path.join(root, "local.txt");
  await fs.writeFile(localPath, "hello\n", "utf8");

  await run(`from filename "${localPath}" fromstate text "emulator-5554" to text "/sdcard/Download/local.txt" be android send do`);
  const claimed = await claimOldestInputEnvelope(worldRoot, { workerTag: "quiz" });
  const payload = claimed?.envelope?.payloadSentence;
  assert.equal(payload?.be, "android send");
  assert.equal(payload?.from?.filename, localPath);
  assert.equal(payload?.fromstate?.text, "emulator-5554");
  assert.equal(payload?.to?.text, "/sdcard/Download/local.txt");
});

test("android verb requires device id when no default is configured", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-verb-device-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await assert.rejects(
    () => run('be android verify do'),
    (err) => err?.sentence?.su?.name === "android command defective"
  );
});

test("android phase verbs run without shelling out", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-phase-verb-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await run('from text "emulator-5554" be android verify do');
  const inputResult = await run("be android input do");
  const produceResult = await run("be android produce do");
  assert.equal(inputResult?.as?.name, "input");
  assert.equal(produceResult?.as?.name, "produce");
  const depth = await queueDepth(worldRoot);
  assert.equal(Number.isFinite(depth.total), true);
});
