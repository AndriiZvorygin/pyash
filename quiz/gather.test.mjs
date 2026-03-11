import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("gather joins vec text by newline", async () => {
  forget();

  await run("exists su name lines ob ve text alpha beta gamma be vector ya");
  await run("ob name lines by wo newline to name text joined be gather do");

  const fact = remember("joined");
  assert.ok(fact);
  assert.equal(fact.be, "text");
  assert.equal(fact.ob.text, "alpha\nbeta\ngamma");
});

test("gather joins vec text by remembered delimiter", async () => {
  forget();

  await run("exists su name parts ob ve text red green blue be vector ya");
  await run("exists su name divider ob text \" | \" be text ya");
  await run("ob name parts by name divider to name text joined be gather do");

  const fact = remember("joined");
  assert.ok(fact);
  assert.equal(fact.be, "text");
  assert.equal(fact.ob.text, "red | green | blue");
});

test("gather rejects missing text vector", async () => {
  forget();

  await assert.rejects(
    run("ob text \"abc\" by wo newline to name text joined be gather do"),
    /gather defective: missing text vector/
  );
});

test("gather can write to an existing ceremony output binding", async () => {
  forget();

  await run("su name pool fill from text source to name text output be ceremony def");
  await run("exists su name lines ob ve text alpha beta be vector ya");
  await run("ob name lines by wo newline to name text output be gather do");
  await run("su name output ret");
  await run("prah");
  await run("su name stage from text \"seed\" to name text final be pool fill do");

  const fact = remember("final");
  assert.ok(fact);
  assert.equal(fact.ob.text, "alpha\nbeta");
});
