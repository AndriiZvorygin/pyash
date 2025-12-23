import test from "node:test";
import assert from "node:assert/strict";

test("map at all can conditionally invert based on atindex parity", async () => {
  const program = [
    "exists su name values ob ve num 1 2 3 4 be vector ya",
    "su name toggle even ob num value atindex num 0 be ceremony def",
    "ob this ti atindex from num 2 to name mod be remains do",
    "ob name mod be equally from num 0 then ob this ob be invert do",
    "su name toggle even be ceremony prah",
    "ob name values at name all be toggle even do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const vec = remember("values");
  assert.ok(Array.isArray(vec?.ob?.ve?.values));
  assert.deepEqual(vec.ob.ve.values, [-1, 2, -3, 4]);
});
