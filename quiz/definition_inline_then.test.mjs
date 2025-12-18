import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("definition body can run an inline conditional (… then …) imperatively", async () => {
  forget();

  await interpret(parse("exists subj name flag obj num 0 be number ya"));

  await interpret(parse("subj name check be ceremony def"));
  await interpret(parse("obj name flag be equally from num 0 then obj num 1 to name flag be add do"));
  await interpret(parse("subj name check be ceremony prah"));

  await interpret(parse("be check do"));

  const out = await interpret(parse("obj name flag be say do"));
  assert.equal(String(out?.value?.text), "1");
});

test("definition body skips inline conditional consequence when condition is false", async () => {
  forget();

  await interpret(parse("exists subj name flag obj num 1 be number ya"));

  await interpret(parse("subj name check be ceremony def"));
  await interpret(parse("obj name flag be equally from num 0 then obj num 1 to name flag be add do"));
  await interpret(parse("subj name check be ceremony prah"));

  await interpret(parse("be check do"));

  const out = await interpret(parse("obj name flag be say do"));
  assert.equal(String(out?.value?.text), "1");
});
