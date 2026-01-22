import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("ecology sets and reads a variable", async () => {
  forget();
  const key = "PYA_ECOLOGY_TEST";
  delete process.env[key];

  await run(`su name ${key} be ecology ob text "alpha" do`);
  const fact = remember(key);
  assert.equal(fact?.ob?.text, "alpha");

  const result = await run(`su name ${key} be ecology que`);
  assert.match(result ?? "", /su name PYA_ECOLOGY_TEST ob text "alpha" be ecology ya/);
});

test("ecology returns a map of environment values", async () => {
  forget();
  const res = await run("be ecology do");
  assert.equal(res?.ob?.name, "ecology env");
  const mapFact = remember("ecology env");
  assert.ok(mapFact?.ob?.map);
});
