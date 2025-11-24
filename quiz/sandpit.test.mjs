import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/dispatcher/index.mjs";
import { resetMemory, dumpMemory, dumpSandpits, getMemory } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ceremony runs in sandpit and merges results to main memory only", async () => {
  resetMemory();

  await run("subj name target obj num 1 be number ya");
  await run("subj name incrementer be ceremony def");
  await run("obj num 2 to name target be add do");
  await run("subj name incrementer be ceremony prah");

  await run("to name target be incrementer do");

  const mem = dumpMemory();
  const pits = dumpSandpits();
  const target = getMemory("target");
  const result = getMemory("result");

  assert.ok(target);
  assert.equal(target.obj.num, 3, "merged result should update target");
  assert.ok(result);
  assert.equal(result.obj.num, 3, "result fact should reflect merged update");

  const sandpit = pits.at(-1);
  assert.ok(sandpit, "sandpit trace should be recorded");
  assert.ok(
    !mem.some(s => s.mood === "def" && s.subj?.name === "incrementer" && s.be === "ceremony" && s.fromSandpit),
    "no sandpit body facts should leak into main memory"
  );
});
