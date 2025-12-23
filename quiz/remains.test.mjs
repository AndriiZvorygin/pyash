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

  await run("exists su name dividend ob num 10 be number ya");
  await run("ob name dividend from num 3 to name rem be remains do");

  const rem = remember("rem");
  assert.equal(rem?.ob?.num, 1);
  assert.equal(remember("result")?.ob?.num, 1);
});

test("remains resolves numeric names", async () => {
  forget();

  await run("exists su name lhs ob num 14 be number ya");
  await run("exists su name rhs ob num 5 be number ya");
  await run("ob name lhs from name rhs to name rem be remains do");

  assert.equal(remember("rem")?.ob?.num, 4);
});

test("remains throws when divisor missing", async () => {
  forget();
  await assert.rejects(() => run("ob num 5 be remains do"), /remains: from is required/);
});
