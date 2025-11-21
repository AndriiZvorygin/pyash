import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, dumpDefinitionIndex, getDefinition } from "../memory.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("def sentences are indexed by subj name with position in memory", async () => {
  resetMemory();

  await run("su alpha be paragraph def");
  await run("su beta be topic def");

  const index = dumpDefinitionIndex();
  assert.deepEqual(
    index.map(entry => entry.name),
    ["alpha", "beta"],
    "definitions should be sorted by name"
  );
  assert.equal(index[0].index, 0, "alpha should point to first memory slot");
  assert.equal(index[1].index, 1, "beta should point to second memory slot");

  const alphaDef = getDefinition("alpha");
  assert.ok(alphaDef, "alpha definition should be retrievable");
  assert.equal(alphaDef.subj.name, "alpha");
  assert.equal(alphaDef.be, "paragraph");
});

test("redef updates index to latest memory position and reset clears", async () => {
  resetMemory();

  await run("su alpha be paragraph def");
  await run("su alpha be topic def");

  let idx = dumpDefinitionIndex().find(entry => entry.name === "alpha");
  assert.ok(idx, "alpha entry should exist");
  assert.equal(idx.index, 1, "second definition should win");

  const alphaDef = getDefinition("alpha");
  assert.equal(alphaDef.be, "topic", "retrieved definition should follow last write");

  resetMemory();
  idx = dumpDefinitionIndex().find(entry => entry.name === "alpha");
  assert.equal(idx, undefined, "reset should clear definition index");
  assert.equal(getDefinition("alpha"), undefined, "reset should clear stored definition lookup");
});
