import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget, dumpSandpits } from "../program/remember/index.mjs";

test("at all map writes to new vector via to", async () => {
  forget();
  const program = [
    "exists subj name vec obj ve num 1 2 3 be vector ya",
    "be invert obj name vec to name out at name all do"
  ].join("\\n");
  const sentences = program.split("\\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const out = remember("out");
  assert.ok(out?.obj?.ve?.values);
  assert.deepEqual(out.obj.ve.values, [-1, -2, -3]);
});

test("at all foreach updates source vector in place when no to", async () => {
  forget();
  const program = [
    "exists subj name vec obj ve num 1 2 3 be vector ya",
    "be invert obj name vec at name all do"
  ].join("\\n");
  const sentences = program.split("\\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const vec = remember("vec");
  assert.ok(vec?.obj?.ve?.values);
  assert.deepEqual(vec.obj.ve.values, [-1, -2, -3]);
});

test("at all provides by register for index inside ceremony body", async () => {
  forget();
  const program = [
    "exists subj name vec obj ve num 4 5 6 be vector ya",
    "subj name capture-index to name num atindex num 0 be ceremony def",
    "subj name picked obj this atindex be number ya",
    "subj name picked ret",
    "subj name capture-index be ceremony prah",
    "be capture-index obj name vec to name out at name all do"
  ].join("\\n");
  const sentences = program.split("\\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const sandpit = dumpSandpits().at(-1) || [];
  const evoker = sandpit[0];
  assert.equal(evoker?.atindex?.num, 2, "last atindex register should be visible inside ceremony body");
});
