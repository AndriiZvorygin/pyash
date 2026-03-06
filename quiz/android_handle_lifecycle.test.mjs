import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";
import { runAndroidInputOnce } from "../program/agent/android/index.mjs";
import { readAndroidHandleState } from "../program/agent/android/state.mjs";
import {
  acquireAndroidDeviceLease,
  releaseAndroidDeviceLease
} from "../program/agent/android/lease.mjs";

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

test("android status and await follow handle lifecycle through runtime", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-handle-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  const queued = await run('su name handle one from text "emulator-5554" vyah start future be android verify do');
  assert.deepEqual(queued?.vyah?.ve?.values, ["start", "success"]);

  const queuedStatus = await run('accordingto text "handle one" vyah status be android do');
  assert.equal(queuedStatus?.ob?.text, "queued");
  assert.equal(queuedStatus?.totext?.text, "durable");

  await runAndroidInputOnce({
    worldRoot,
    adapter: {
      async execute() {
        return { success: true, summary: "verify ok" };
      }
    },
    maxItems: 5
  });

  const afterState = await readAndroidHandleState(worldRoot, "handle one");
  assert.equal(afterState?.status, "success");
  assert.equal(afterState?.summary, "verify ok");

  const awaited = await run('accordingto text "handle one" during num 2000 vyah await be android do');
  assert.deepEqual(awaited?.vyah?.ve?.values, ["await", "success"]);
  assert.equal(awaited?.ob?.text, "success");
  assert.equal(awaited?.fromstate?.text, "verify ok");
});

test("android vyah await does not require su name runtime target", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-vyah-await-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await run('su name handle two from text "emulator-5554" vyah start future be android verify do');
  const queuedStatus = await run('accordingto text "handle two" vyah status be android do');
  assert.equal(queuedStatus?.ob?.text, "queued");
});

test("android await timeout includes host worker hint when presence is missing", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-await-timeout-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await run('su name handle timeout from text "emulator-5554" vyah start future be android verify do');
  const awaited = await run('accordingto text "handle timeout" during num 1000 vyah await be android do');
  assert.equal(awaited?.ob?.text, "queued");
  assert.match(String(awaited?.fromstate?.text ?? ""), /start host worker: npm run android:worker/);
});

test("android device lease enforces busy state and supports release", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-lease-"));
  const worldRoot = path.join(root, "world");

  const first = await acquireAndroidDeviceLease(worldRoot, {
    deviceId: "emulator-5554",
    owner: "worker-a",
    commandId: "cmd-1",
    ttlMs: 10000
  });
  assert.equal(first.acquired, true);

  const second = await acquireAndroidDeviceLease(worldRoot, {
    deviceId: "emulator-5554",
    owner: "worker-b",
    commandId: "cmd-2",
    ttlMs: 10000
  });
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "busy");

  const released = await releaseAndroidDeviceLease(worldRoot, {
    deviceId: "emulator-5554",
    owner: "worker-a",
    commandId: "cmd-1"
  });
  assert.equal(released, true);

  const third = await acquireAndroidDeviceLease(worldRoot, {
    deviceId: "emulator-5554",
    owner: "worker-c",
    commandId: "cmd-3",
    ttlMs: 10000
  });
  assert.equal(third.acquired, true);
});

test("android device lease reclaims stale lease by ttl", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-lease-stale-"));
  const worldRoot = path.join(root, "world");

  const first = await acquireAndroidDeviceLease(worldRoot, {
    deviceId: "emulator-5554",
    owner: "worker-a",
    commandId: "cmd-1",
    ttlMs: 1000
  });
  assert.equal(first.acquired, true);

  await new Promise((resolve) => setTimeout(resolve, 1150));

  const second = await acquireAndroidDeviceLease(worldRoot, {
    deviceId: "emulator-5554",
    owner: "worker-b",
    commandId: "cmd-2",
    ttlMs: 1000
  });
  assert.equal(second.acquired, true);
  assert.equal(second.lease?.owner, "worker-b");
});
