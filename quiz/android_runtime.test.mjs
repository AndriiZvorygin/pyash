import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  resolveAndroidIntent,
  runAndroidInputOnce,
  runAndroidProduceOnce
} from "../program/agent/android/index.mjs";
import {
  enqueueInputEnvelope,
  queueDepth
} from "../program/agent/android_core/queue.mjs";
import { runScheduledJob } from "../program/agent/scheduled_jobs.mjs";

test("android runtime resolves intent from android-prefixed be value", () => {
  const intent = resolveAndroidIntent({ be: "android verify" });
  assert.equal(intent, "verify");
});

test("android runtime input phase executes envelopes through adapter and produces outcomes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-runtime-input-"));
  const worldRoot = path.join(root, "world");
  const calls = [];

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-06T05:20:10.000Z",
    deviceId: "emulator-5554",
    identity: "adb://localhost:5037",
    agentName: "mricge",
    commandId: "cmd-verify-1",
    payloadSentence: {
      mood: "do",
      be: "android verify",
      ob: { text: "verify device state" }
    }
  });

  const input = await runAndroidInputOnce({
    worldRoot,
    maxItems: 5,
    adapter: {
      async execute(args = {}) {
        calls.push(args);
        return { success: true, summary: "verify ok" };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.intent, "verify");
  assert.equal(input.received, 1);
  assert.equal(input.handled, 1);
  assert.equal(input.enqueued, 1);

  const depthAfterInput = await queueDepth(worldRoot);
  assert.equal(depthAfterInput.input, 0);
  assert.equal(depthAfterInput.produce, 1);

  const produce = await runAndroidProduceOnce({ worldRoot, maxItems: 5 });
  assert.equal(produce.sent, 1);

  const depthAfterProduce = await queueDepth(worldRoot);
  assert.equal(depthAfterProduce.total, 0);
});

test("scheduled job routes android input without requiring agent identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-runtime-scheduled-"));
  const worldRoot = path.join(root, "world");

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-06T05:22:10.000Z",
    deviceId: "emulator-5554",
    identity: "adb://localhost:5037",
    agentName: "accountant",
    commandId: "cmd-verify-2",
    payloadSentence: {
      mood: "do",
      be: "android unknown",
      ob: { text: "unsupported" }
    }
  });

  const result = await runScheduledJob({
    worldRoot,
    job: {
      jobName: "android input",
      laneName: "android_input",
      prompt: "",
      agentName: ""
    }
  });

  assert.match(String(result?.status ?? ""), /^android:/);
});
