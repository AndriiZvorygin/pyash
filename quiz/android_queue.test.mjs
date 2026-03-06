import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  androidQueuePaths,
  ensureAndroidQueueDirs,
  enqueueInputEnvelope,
  enqueueProduceEnvelope,
  claimOldestInputEnvelope,
  claimOldestProduceEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail,
  queueDepth
} from "../program/agent/android_core/queue.mjs";

const PAYLOAD_OLD = {
  mood: "do",
  be: "command",
  ob: { text: "adb shell getprop ro.build.version.release" }
};

const PAYLOAD_NEW = {
  mood: "do",
  be: "command",
  ob: { text: "adb shell dumpsys battery" }
};

test("android queue creates expected directory layout under world/holding/android", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-queue-layout-"));
  const worldRoot = path.join(root, "world");
  const paths = await ensureAndroidQueueDirs(worldRoot);
  assert.equal(paths.root, path.join(worldRoot, "holding", "android"));

  const statInput = await fs.stat(paths.inputDir);
  const statRuntime = await fs.stat(paths.runtimeDir);
  const statProduce = await fs.stat(paths.produceDir);
  const statSuccess = await fs.stat(paths.produceSuccessDir);
  const statFail = await fs.stat(paths.produceFailDir);
  assert.equal(statInput.isDirectory(), true);
  assert.equal(statRuntime.isDirectory(), true);
  assert.equal(statProduce.isDirectory(), true);
  assert.equal(statSuccess.isDirectory(), true);
  assert.equal(statFail.isDirectory(), true);
});

test("android queue enqueues and claims oldest input envelope with parsed payload sentence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-queue-input-"));
  const worldRoot = path.join(root, "world");

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-05T15:30:10.000Z",
    deviceId: "emulator-5554",
    identity: "adb://localhost:5037",
    agentName: "mricge",
    commandId: "cmd-old",
    payloadSentence: PAYLOAD_OLD
  });
  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-05T15:30:11.000Z",
    deviceId: "emulator-5554",
    identity: "adb://localhost:5037",
    agentName: "mricge",
    commandId: "cmd-new",
    payloadSentence: PAYLOAD_NEW
  });

  const first = await claimOldestInputEnvelope(worldRoot, { workerTag: "android-router" });
  assert.equal(first?.envelope?.commandId, "cmd-old");
  assert.equal(first?.envelope?.payloadSentence?.ob?.text, "adb shell getprop ro.build.version.release");
});

test("android queue supports produce claims and success/fail transitions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-queue-produce-"));
  const worldRoot = path.join(root, "world");
  await enqueueProduceEnvelope(worldRoot, {
    queuedAt: "2026-03-05T15:31:12.000Z",
    deviceId: "emulator-5554",
    identity: "adb://localhost:5037",
    agentName: "mricge",
    payloadId: "payload-20260305-0001",
    payloadSentence: {
      mood: "ya",
      su: { name: "android command" },
      be: "result",
      ob: { text: "ok" }
    }
  });

  const produceClaim = await claimOldestProduceEnvelope(worldRoot, { workerTag: "android-sender" });
  assert.equal(produceClaim?.envelope?.phase, "produce");
  assert.equal(produceClaim?.envelope?.payloadId, "payload-20260305-0001");

  const successPath = await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: produceClaim.path });
  assert.match(successPath, /produce\/success\//);
});

test("android queue fail ack can requeue then fail out", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-queue-retry-"));
  const worldRoot = path.join(root, "world");
  const paths = androidQueuePaths(worldRoot);

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-05T15:32:10.000Z",
    deviceId: "emulator-5554",
    identity: "adb://localhost:5037",
    agentName: "mricge",
    commandId: "cmd-retry",
    payloadSentence: PAYLOAD_OLD
  });

  const first = await claimOldestInputEnvelope(worldRoot, { workerTag: "android-router" });
  const requeuedPath = await ackRuntimeEnvelopeFail(worldRoot, {
    runtimePath: first.path,
    retryCount: 0,
    maxRetries: 2,
    requeuePhase: "input"
  });
  assert.match(requeuedPath, /\/input\//);

  const second = await claimOldestInputEnvelope(worldRoot, { workerTag: "android-router" });
  const failedPath = await ackRuntimeEnvelopeFail(worldRoot, {
    runtimePath: second.path,
    retryCount: 2,
    maxRetries: 2,
    requeuePhase: "input"
  });
  assert.match(failedPath, /produce\/fail\//);

  const depth = await queueDepth(worldRoot);
  assert.equal(depth.input, 0);
  assert.equal(depth.produce, 0);
  const failed = await fs.readdir(paths.produceFailDir);
  assert.equal(failed.length, 1);
});

test("android queue claim scopes envelopes by device and agent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-queue-scope-"));
  const worldRoot = path.join(root, "world");

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-05T15:40:10.000Z",
    deviceId: "emulator-5554",
    identity: "adb://localhost:5037",
    agentName: "accountant",
    commandId: "cmd-scope-1",
    payloadSentence: PAYLOAD_OLD
  });

  const wrongAgentClaim = await claimOldestInputEnvelope(worldRoot, {
    workerTag: "android-input",
    deviceId: "emulator-5554",
    agentName: "mricge"
  });
  assert.equal(wrongAgentClaim, null);

  const rightAgentClaim = await claimOldestInputEnvelope(worldRoot, {
    workerTag: "android-input",
    deviceId: "emulator-5554",
    agentName: "accountant"
  });
  assert.equal(rightAgentClaim?.envelope?.commandId, "cmd-scope-1");
});
