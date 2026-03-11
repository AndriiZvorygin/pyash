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

test("distribute preserves empty fields for literal delimiters", async () => {
  forget();

  await run("ob text \"red,,blue,\" by text \",\" to name vec text colors be distribute do");

  const fact = remember("colors");
  assert.ok(fact);
  assert.equal(fact.be, "vector");
  assert.equal(fact.ob.ve.type, "text");
  assert.deepEqual(fact.ob.ve.values, ["red", "", "blue", ""]);
});

test("distribute normalizes carriage-return newlines", async () => {
  forget();

  await run("ob text quoted.text.alpha\rbeta\rgamma.text.quoted by wo newline to name vec text lines be distribute do");

  const fact = remember("lines");
  assert.ok(fact);
  assert.equal(fact.be, "vector");
  assert.equal(fact.ob.ve.type, "text");
  assert.deepEqual(fact.ob.ve.values, ["alpha", "beta", "gamma"]);
});

test("distribute drops one terminal empty line in newline mode", async () => {
  forget();

  await run("ob text quoted.text.alpha\nbeta\ngamma\n.text.quoted by wo newline to name vec text lines be distribute do");

  const fact = remember("lines");
  assert.ok(fact);
  assert.equal(fact.be, "vector");
  assert.equal(fact.ob.ve.type, "text");
  assert.deepEqual(fact.ob.ve.values, ["alpha", "beta", "gamma"]);
});

test("distribute returns a vector result object", async () => {
  forget();

  const result = await run("ob text \"left|right\" by text \"|\" to name vec text halves be distribute do");

  assert.equal(result.be, "vector");
  assert.equal(result.ob.ve.type, "text");
  assert.deepEqual(result.ob.ve.values, ["left", "right"]);
});

test("distribute rejects missing source text", async () => {
  forget();

  await assert.rejects(
    run("ob name missing by text \",\" to name vec text parts be distribute do"),
    /distribute defective: missing source text/
  );
});

test("distribute rejects missing delimiter", async () => {
  forget();

  await assert.rejects(
    run("ob text \"abc\" to name vec text parts be distribute do"),
    /distribute defective: missing delimiter/
  );
});

test("distribute rejects empty delimiter", async () => {
  forget();

  await assert.rejects(
    run("ob text \"abc\" by text \"\" to name vec parts be distribute do"),
    /distribute defective: empty delimiter/
  );
});

test("distribute can write to an existing ceremony output binding", async () => {
  forget();

  await run("su name pool fill from text source to name vec text output be ceremony def");
  await run("ob text quoted.text.alpha\nbeta.text.quoted by wo newline to name vec text output be distribute do");
  await run("su name output ret");
  await run("prah");
  await run("su name stage from text \"seed\" to name vec text final be pool fill do");

  const fact = remember("final");
  assert.ok(fact);
  assert.deepEqual(fact.ob.ve.values, ["alpha", "beta"]);
});
