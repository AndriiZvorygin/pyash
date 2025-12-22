import test from "node:test";
import assert from "node:assert/strict";

test("map at all can conditionally invert based on atindex parity", async () => {
  const program = [
    "exists subj name values obj ve num 1 2 3 4 be vector ya",
    "subj name toggle even obj name num value atindex num 0 be ceremony def",
    "obj this ti atindex from num 2 to name mod be remains do",
    "obj name mod be equally from num 0 then obj this obj be invert do",
    "subj name toggle even be ceremony prah",
    "obj name values at name all be toggle even do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const vec = remember("values");
  assert.ok(Array.isArray(vec?.obj?.ve?.values));
  assert.deepEqual(vec.obj.ve.values, [-1, 2, -3, 4]);
});
