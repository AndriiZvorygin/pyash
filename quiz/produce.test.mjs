import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("dot product from inline vectors", async () => {
  forget();

  await run("ob vec num 1 2 3 by vec num 4 5 6 to name z be produce do");

  const z = remember("z");
  const result = remember("result");

  assert.equal(z.ob.num, 32);
  assert.equal(result.ob.num, 32);
});

test("dot product from named vectors", async () => {
  forget();

  await run("exists su name w ob vec num 1 1 1 be vector ya");
  await run("exists su name x ob vec num 2 3 4 be vector ya");

  await run("from name w by name x to name z be produce do");

  const z = remember("z");
  const result = remember("result");

  assert.equal(z.ob.num, 9);
  assert.equal(result.ob.num, 9);
});

test("mismatched vector lengths throw", async () => {
  forget();

  await run("exists su name w ob vec num 1 2 be vector ya");
  await run("exists su name x ob vec num 1 2 3 be vector ya");

  await assert.rejects(() => run("from name w by name x be produce do"), /same length/);
});

test("vector elements must be numeric", async () => {
  forget();

  await assert.rejects(() => run("ob vec letter a b by vec num 1 2 to name z be produce do"), /numeric values/);
});
