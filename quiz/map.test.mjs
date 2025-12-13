import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

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
