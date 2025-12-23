import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("loop body can run inline conditional against this.fromindex (via remains parity)", async () => {
  forget();

  await interpret(parse("exists su name hits ob num 0 be number ya"));

  await interpret(parse("su name count odd to name num bucket fromindex num 0 be ceremony def"));
  await interpret(parse("ob this ti fromindex from num 2 to name mod be remains do"));
  await interpret(parse("ob name mod be equally from num 1 then ob num 1 to name hits be add do"));
  await interpret(parse("su name count odd be ceremony prah"));

  // stop-when-equal loop: executes for 0..4, stops at 5
  await interpret(parse("to name outside fromindex num 0 toindex num 5 be count odd do"));

  const out = await interpret(parse("ob name hits be write do"));
  // odds in 0..4 are 1 and 3
  assert.equal(String(out?.value?.text), "2");
});
