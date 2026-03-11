import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("vector map applies mapper to each element", async () => {
  forget();

  await run("exists su name items ob ve text alpha beta be vector ya");
  await run("from name items by name text to name vec mapped be vector map do");

  const vec = remember("mapped");
  assert.ok(vec);
  assert.equal(vec.be, "vector");
  assert.deepEqual(vec.ob.ve.values, ["alpha", "beta"]);
  assert.equal(vec.ob.ve.type, "text");
});

test("vector map can overwrite an existing output binding", async () => {
  forget();

  await run("exists su name items ob ve text alpha beta be vector ya");
  await run("exists su name output ob ve text stale be vector ya");
  await run("from name items by name text to name vec output be vector map do");

  const fact = remember("output");
  assert.ok(fact);
  assert.equal(fact.be, "vector");
  assert.equal(fact.ob.ve.type, "text");
  assert.deepEqual(fact.ob.ve.values, ["alpha", "beta"]);
});
