import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("loop body can implement fizzbuzz logic using remains + inline then", async () => {
  forget();

  await interpret(parse("exists su name fizzHits ob num 0 be number ya"));
  await interpret(parse("exists su name buzzHits ob num 0 be number ya"));
  await interpret(parse("exists su name handled ob num 0 be number ya"));
  await interpret(parse("exists su name rem3 ob num 0 be number ya"));
  await interpret(parse("exists su name rem5 ob num 0 be number ya"));

  await interpret(parse("su name fizzbuzz step to name num bucket fromindex num 0 toindex num 0 be ceremony def"));
  await interpret(parse("su name handled ob num 0 be number ya"));
  await interpret(parse("ob this ti fromindex from num 3 to name rem3 be remains do"));
  await interpret(parse("ob this ti fromindex from num 5 to name rem5 be remains do"));
  await interpret(parse("ob name rem3 be equally from num 0 then ob num 1 to name fizzHits be plus do"));
  await interpret(parse("ob name rem5 be equally from num 0 then ob num 1 to name buzzHits be plus do"));
  await interpret(parse("ob name rem3 be equally from num 0 then ob num 1 to name handled be plus do"));
  await interpret(parse("ob name rem5 be equally from num 0 then ob num 2 to name handled be plus do"));
  await interpret(parse("su name fizzbuzz step be ceremony prah"));

  await interpret(parse("to name outside fromindex num 1 toindex num 16 be fizzbuzz step do"));

  const fizz = await interpret(parse("ob name fizzHits be write do"));
  const buzz = await interpret(parse("ob name buzzHits be write do"));
  assert.equal(String(fizz?.value?.text), "5");
  assert.equal(String(buzz?.value?.text), "3");
});
