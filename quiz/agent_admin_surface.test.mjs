import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember, remember } from "../program/remember/index.mjs";
import { readServiceControls } from "../program/agent/scheduler_service_control.mjs";

function setWorldRoot(worldRoot) {
  doRemember({
    mood: "ya",
    su: { name: "world root" },
    ob: { filename: worldRoot },
    be: "filename"
  });
}

test("house establish/list/improve surface works via Pyash sentences", async () => {
  forget();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-surface-"));
  const worldRoot = path.join(tmpRoot, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  setWorldRoot(worldRoot);

  const established = await interpret(parse(
    'su name parity coder ob text "Fix parity regressions and report delta." be establish do'
  ));
  assert.equal(established?.value?.boolean, true);
  assert.equal(remember("result")?.be, "establish");

  const listed = await interpret(parse("be list from wo house do"));
  const names = listed?.value?.ve?.values ?? [];
  assert.equal(Array.isArray(names), true);
  assert.equal(names.includes("parity coder"), true);

  const improved = await interpret(parse(
    'su name parity coder ob text "Prefer targeted tests before npm test." be improve do'
  ));
  assert.equal(improved?.value?.boolean, true);
  assert.equal(remember("result")?.be, "improve");
});

test("house begin/stop/restart toggles agent services", async () => {
  forget();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-agent-surface-"));
  const worldRoot = path.join(tmpRoot, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  setWorldRoot(worldRoot);

  await interpret(parse(
    'su name parity coder ob text "Fix parity regressions and report delta." be establish do'
  ));

  const beginRes = await interpret(parse("su name parity coder be begin from wo house do"));
  assert.equal(beginRes?.value?.boolean, true);
  assert.equal(remember("result")?.be, "begin");

  const controlsAfterBegin = await readServiceControls({ worldRoot });
  assert.equal(controlsAfterBegin.get("parity coder heartbeat"), true);

  const stopRes = await interpret(parse("su name parity coder be stop from wo house do"));
  assert.equal(stopRes?.value?.boolean, true);
  assert.equal(remember("result")?.be, "stop");

  const controlsAfterStop = await readServiceControls({ worldRoot });
  assert.equal(controlsAfterStop.get("parity coder heartbeat"), false);

  const restartRes = await interpret(parse("su name parity coder be restart from wo house do"));
  assert.equal(restartRes?.value?.boolean, true);
  assert.equal(remember("result")?.be, "restart");
});
