import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";
import { runAndroidInputOnce } from "../program/agent/android/index.mjs";

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

test("android lifecycle appends queued/running/success outcomes to newspaper", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-android-outcome-newspaper-"));
  const worldRoot = path.join(root, "world");
  setWorldRoot(worldRoot);

  await run('su name handle news from text "emulator-5554" vyah start be android verify do');
  await runAndroidInputOnce({
    worldRoot,
    adapter: {
      async execute() {
        return { success: true, summary: "verify ok" };
      }
    },
    maxItems: 5
  });

  const newspaperDir = path.join(worldRoot, "newspaper");
  const files = await fs.readdir(newspaperDir);
  const androidLog = files.find((name) => name.includes("-android-agent.pya"));
  assert.ok(androidLog, "expected android newspaper log");
  const text = await fs.readFile(path.join(newspaperDir, androidLog), "utf8");
  assert.match(text, /vyah queued success/);
  assert.match(text, /vyah running success/);
  assert.match(text, /vyah success/);
});
