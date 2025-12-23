import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("bool literal stores boolean payload", async () => {
  forget();

  await interpret(parse("su name flag ob bool truth be boolean ya"));
  const flag = remember("flag");
  assert.equal(flag?.ob?.boolean, true);

  await interpret(parse("su name off ob bool lie be boolean ya"));
  const off = remember("off");
  assert.equal(off?.ob?.boolean, false);
});

test("hollow literal stores null marker", async () => {
  forget();

  await interpret(parse("su name empty ob hollow be null ya"));
  const empty = remember("empty");
  assert.equal(empty?.ob?.hollow, true);
});

test("write prints bool and hollow literals", async () => {
  forget();

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse("ob bool truth be write do"));
    await interpret(parse("ob hollow be write do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ["truth", "null"]);
});
