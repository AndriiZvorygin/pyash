import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("loop body can implement fizzbuzz logic using remains + inline then", async () => {
  forget();

  await interpret(parse("exists subj name fizzHits obj num 0 be number ya"));
  await interpret(parse("exists subj name buzzHits obj num 0 be number ya"));
  await interpret(parse("exists subj name handled obj num 0 be number ya"));
  await interpret(parse("exists subj name rem3 obj num 0 be number ya"));
  await interpret(parse("exists subj name rem5 obj num 0 be number ya"));

  await interpret(parse("subj name fizzbuzz step to name num bucket fromindex num 0 toindex num 0 be ceremony def"));
  await interpret(parse("subj name handled obj num 0 be number ya"));
  await interpret(parse("obj this ti fromindex from num 3 to name rem3 be remains do"));
  await interpret(parse("obj this ti fromindex from num 5 to name rem5 be remains do"));
  await interpret(parse("obj name rem3 be equally from num 0 then obj num 1 to name fizzHits be add do"));
  await interpret(parse("obj name rem5 be equally from num 0 then obj num 1 to name buzzHits be add do"));
  await interpret(parse("obj name rem3 be equally from num 0 then obj num 1 to name handled be add do"));
  await interpret(parse("obj name rem5 be equally from num 0 then obj num 2 to name handled be add do"));
  await interpret(parse("subj name fizzbuzz step be ceremony prah"));

  await interpret(parse("to name outside fromindex num 1 toindex num 16 be fizzbuzz step do"));

  const fizz = await interpret(parse("obj name fizzHits be say do"));
  const buzz = await interpret(parse("obj name buzzHits be say do"));
  assert.equal(String(fizz?.value?.text), "5");
  assert.equal(String(buzz?.value?.text), "3");
});
