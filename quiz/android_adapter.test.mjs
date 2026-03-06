import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAdbAdapter } from "../program/agent/android/adapter_adb.mjs";

function makeRunAdbStub({ calls, worldRoot } = {}) {
  return async ({ deviceId, args }) => {
    calls.push({ deviceId, args: [...args] });
    const key = args.join(" ");
    if (key === "shell getprop ro.product.model") return { stdout: "Pixel 8" };
    if (key === "shell getprop ro.build.version.release") return { stdout: "15" };
    if (key === "shell wm size") return { stdout: "Physical size: 1080x2400" };
    if (key === "shell dumpsys window") return { stdout: "mCurrentFocus=Window{42 u0 com.example/.MainActivity}" };
    if (args[0] === "pull") {
      const dest = String(args[2] ?? "");
      if (dest) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, "PNG", "utf8");
      }
      return { stdout: "pulled" };
    }
    if (args[0] === "push") return { stdout: "pushed" };
    return { stdout: "ok" };
  };
}

test("adb adapter lowers verify to state inspection commands", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-adapter-verify-"));
  const worldRoot = path.join(root, "world");
  const calls = [];
  const adapter = createAdbAdapter({ worldRoot, runAdb: makeRunAdbStub({ calls, worldRoot }) });
  const result = await adapter.execute({
    intent: "verify",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android verify" }
  });
  assert.equal(result.success, true);
  assert.match(String(result.summary), /model=Pixel 8/);
  assert.deepEqual(calls.map((entry) => entry.args.join(" ")), [
    "shell getprop ro.product.model",
    "shell getprop ro.build.version.release",
    "shell wm size",
    "shell dumpsys window"
  ]);
});

test("adb adapter lowers tap glide scroll press type begin send accept intents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-adapter-lower-"));
  const worldRoot = path.join(root, "world");
  const calls = [];
  const adapter = createAdbAdapter({ worldRoot, runAdb: makeRunAdbStub({ calls, worldRoot }) });

  await adapter.execute({
    intent: "tap",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android tap", ob: { ve: { values: [100, 200] } } }
  });
  await adapter.execute({
    intent: "glide",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android glide", ob: { ve: { values: [100, 200, 300, 400] } }, during: { num: 250 } }
  });
  await adapter.execute({
    intent: "scroll",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android scroll", ob: { text: "down" } }
  });
  await adapter.execute({
    intent: "press",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android press", ob: { text: "KEYCODE_HOME" } }
  });
  await adapter.execute({
    intent: "type",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android type", ob: { text: "hello world" } }
  });
  await adapter.execute({
    intent: "begin",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android begin", ob: { text: "com.example.app" } }
  });
  await adapter.execute({
    intent: "begin",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android begin", ob: { text: "https://example.com" } }
  });
  await adapter.execute({
    intent: "send",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android send", from: { filename: "/tmp/a.txt" }, to: { text: "/sdcard/Download/a.txt" } }
  });
  await adapter.execute({
    intent: "accept",
    deviceId: "emulator-5554",
    payloadSentence: { be: "android accept", from: { text: "/sdcard/Download/a.txt" }, to: { filename: "/tmp/a-out.txt" } }
  });

  const args = calls.map((entry) => entry.args);
  assert.deepEqual(args[0], ["shell", "input", "tap", 100, 200]);
  assert.deepEqual(args[1], ["shell", "input", "swipe", 100, 200, 300, 400, 250]);
  assert.deepEqual(args[2], ["shell", "wm", "size"]);
  assert.equal(args[3][0], "shell");
  assert.equal(args[3][1], "input");
  assert.equal(args[3][2], "swipe");
  assert.deepEqual(args[4], ["shell", "input", "keyevent", "KEYCODE_HOME"]);
  assert.deepEqual(args[5], ["shell", "input", "text", "hello%sworld"]);
  assert.deepEqual(args[6], ["shell", "monkey", "-p", "com.example.app", "-c", "android.intent.category.LAUNCHER", "1"]);
  assert.deepEqual(args[7], ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "https://example.com"]);
  assert.deepEqual(args[8], ["push", "/tmp/a.txt", "/sdcard/Download/a.txt"]);
  assert.deepEqual(args[9], ["pull", "/sdcard/Download/a.txt", "/tmp/a-out.txt"]);
});

test("adb adapter observe writes artifact file under android lane artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-adapter-observe-"));
  const worldRoot = path.join(root, "world");
  const calls = [];
  const adapter = createAdbAdapter({ worldRoot, runAdb: makeRunAdbStub({ calls, worldRoot }) });

  const result = await adapter.execute({
    intent: "observe",
    deviceId: "emulator-5554",
    envelope: { commandId: "observe-1", payloadId: "observe-1" },
    payloadSentence: { be: "android observe" }
  });

  assert.equal(result.success, true);
  assert.match(String(result.summary), /observe ok file=observe-1\.png bytes=3/);
  const observed = result?.data?.file;
  assert.ok(observed);
  const stat = await fs.stat(observed);
  assert.equal(stat.isFile(), true);
});
