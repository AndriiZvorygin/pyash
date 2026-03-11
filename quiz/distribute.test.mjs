import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("distribute splits text by newline into vec text", async () => {
  forget();

  await run("ob text quoted.text.alpha\nbeta\r\ngamma.text.quoted by wo newline to name vec text lines be distribute do");

  const fact = remember("lines");
  assert.ok(fact);
  assert.equal(fact.be, "vector");
  assert.equal(fact.ob.ve.type, "text");
  assert.deepEqual(fact.ob.ve.values, ["alpha", "beta", "gamma"]);
});

test("distribute splits remembered text by remembered delimiter", async () => {
  forget();

  await run("exists su name source ob text \"red,green,blue\" be text ya");
  await run("exists su name comma ob text \",\" be text ya");
  await run("ob name source by name comma to name vec colors be distribute do");

  const fact = remember("colors");
  assert.ok(fact);
  assert.equal(fact.be, "vector");
  assert.equal(fact.ob.ve.type, "text");
  assert.deepEqual(fact.ob.ve.values, ["red", "green", "blue"]);
});

test("distribute rejects empty delimiter", async () => {
  forget();

  await assert.rejects(
    run("ob text \"abc\" by text \"\" to name vec parts be distribute do"),
    /distribute defective: empty delimiter/
  );
});
