import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("bool literal stores boolean payload", async () => {
  forget();

  await interpret(parse("subj name flag obj bool truth be boolean ya"));
  const flag = remember("flag");
  assert.equal(flag?.obj?.boolean, true);

  await interpret(parse("subj name off obj bool lie be boolean ya"));
  const off = remember("off");
  assert.equal(off?.obj?.boolean, false);
});

test("hollow literal stores null marker", async () => {
  forget();

  await interpret(parse("subj name empty obj hollow be null ya"));
  const empty = remember("empty");
  assert.equal(empty?.obj?.hollow, true);
});

test("say prints bool and hollow literals", async () => {
  forget();

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse("obj bool truth be say do"));
    await interpret(parse("obj hollow be say do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ["truth", "null"]);
});
