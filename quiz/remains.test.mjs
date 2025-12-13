import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("remains stores remainder in target name", async () => {
  forget();

  await run("exists subj name dividend obj num 10 be number ya");
  await run("obj name dividend from num 3 to name rem be remains do");

  const rem = remember("rem");
  assert.equal(rem?.obj?.num, 1);
  assert.equal(remember("result")?.obj?.num, 1);
});

test("remains resolves numeric names", async () => {
  forget();

  await run("exists subj name lhs obj num 14 be number ya");
  await run("exists subj name rhs obj num 5 be number ya");
  await run("obj name lhs from name rhs to name rem be remains do");

  assert.equal(remember("rem")?.obj?.num, 4);
});

test("remains throws when divisor missing", async () => {
  forget();
  await assert.rejects(() => run("obj num 5 be remains do"), /remains: from is required/);
});
