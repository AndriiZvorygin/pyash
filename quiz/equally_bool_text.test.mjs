import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("equally compares truth/lie text (true case)", async () => {
  forget();

  await run("exists subj name hits obj num 0 be number ya");
  await run("obj text truth be equally from text truth then obj num 1 to name hits be add do");

  const hits = remember("hits");
  assert.equal(hits.obj.num, 1);
});

test("equally compares truth/lie text (false case)", async () => {
  forget();

  await run("exists subj name hits obj num 0 be number ya");
  await run("obj text truth be equally from text lie then obj num 1 to name hits be add do");

  const hits = remember("hits");
  assert.equal(hits.obj.num, 0);
});
