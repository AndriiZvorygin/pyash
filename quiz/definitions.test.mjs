import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember, dumpDefinitionIndex, getDefinition, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("def sentences are indexed by subj name with position in memory", async () => {
  forget();

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
  forget();

  await run("su alpha be paragraph def");
  await run("su alpha be topic def");

  let idx = dumpDefinitionIndex().find(entry => entry.name === "alpha");
  assert.ok(idx, "alpha entry should exist");
  assert.equal(idx.index, 1, "second definition should win");

  const alphaDef = getDefinition("alpha");
  assert.equal(alphaDef.be, "topic", "retrieved definition should follow last write");

  forget();
  idx = dumpDefinitionIndex().find(entry => entry.name === "alpha");
  assert.equal(idx, undefined, "reset should clear definition index");
  assert.equal(getDefinition("alpha"), undefined, "reset should clear stored definition lookup");
});

test("definition index captures end via prah and supports invoking the paragraph", async () => {
  forget();

  await run("subj name result obj num 5 be number ya");
  await run("subj name add two to name num be ceremony def");
  await run("obj num 2 to name result be add do");
  await run("subj name add two be ceremony prah");

  const entry = dumpDefinitionIndex().find(e => e.name === "add two");
  assert.ok(entry, "definition index should include add two");
  assert.equal(entry.index, 1, "start index should point to def sentence");
  assert.equal(entry.end, 3, "end index should point to closing prah");

  await run("to name result be add two do");

  const latestResult = remember("result");
  assert.ok(latestResult, "result should be retrievable after function call");
  assert.equal(latestResult.obj.num, 7, "function body should have added two");
});

test("last-write wins keeps updated fact after command and preserves def/prah block entries", async () => {
  forget();

  await run("subj name result obj num 5 be number ya");
  await run("obj num 2 to name result be add do");

  const mem = allRemember();
  const resultFacts = mem.filter(s => s.subj?.name === "result" && s.mood === "ya");

  assert.equal(resultFacts.length, 1, "only one result fact should remain");
  assert.equal(resultFacts[0].obj.num, 7, "result fact should be updated after add");
  assert.equal(mem[0].mood, "do", "command should remain before updated fact");

  // Protect facts inside def/prah blocks
  await run("subj name block be ceremony def");
  await run("subj name collector obj num 1 be number ya"); // inside block
  await run("subj name block be ceremony prah");

  await run("subj name collector obj num 10 be number ya"); // outside block update
  const collectors = allRemember().filter(s => s.subj?.name === "collector");

  assert.equal(
    collectors.length >= 2,
    true,
    "collector fact inside def/prah block should not be removed"
  );
  const protectedCollector = collectors.find(s => s.obj?.num === 1);
  const updatedCollector = collectors.find(s => s.obj?.num === 10);
  assert.ok(protectedCollector, "collector inside def block should persist");
  assert.ok(updatedCollector, "collector outside block should be stored");
});

test("invoking while definition is still open just records and does not run", async () => {
  forget();

  await run("subj name incomplete be ceremony def");
  await run("obj num 1 to name result be add do"); // recorded inside open block

  const before = allRemember().length;
  const res = await run("be incomplete do");
  assert.equal(res?.recorded, true, "invocation should be recorded while block is open");
  assert.equal(allRemember().length, before + 1, "invocation should be appended to memory");
  assert.equal(remember("result"), undefined, "body should not execute while definition remains open");
});

test("ceremony def captures signature words from typed header", async () => {
  forget();

  await run("subj name loop body to name num tloh num 0 until num 0 be ceremony def");
  await run("subj name loop body be ceremony prah");

  const def = getDefinition("loop body");
  assert.ok(def?.signatureWords, "definition should carry signatureWords");
  assert.deepEqual(
    def.signatureWords,
    ["be", "loop body", "tloh", "num", "to", "name", "num", "until", "num"]
  );
});

test.todo("ceremony def headers declare signature cases/types (new signature style)");
// Target behaviour (per documentation/signature.md):
// be add two def
//   to name num
// ceremony
//   ...
// end
//
// After parsing, the def entry should expose a signature:
// ["be","add two","to","name","num"]
// and runtime dispatch should use that signature rather than the bare verb map.
