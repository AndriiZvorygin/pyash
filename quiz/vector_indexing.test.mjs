import test from "node:test";
import assert from "node:assert/strict";

test("read element from numeric vector via at num <index>", async () => {
  const program = [
    "exists su name doors ob ve num 3 1 0 be vector ya",
    "ob name doors via space num 0 be read to name first do",
    "ob name doors via space num 1 be read to name second do",
    "ob name doors via space num 2 be read to name third do",
    "ob name doors at ord 2 be read to name secondOrd do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const first = remember("first");
  const second = remember("second");
  const third = remember("third");
  const secondOrd = remember("secondOrd");
  assert.equal(first?.ob?.num, 3);
  assert.equal(second?.ob?.num, 1);
  assert.equal(third?.ob?.num, 0);
  assert.equal(secondOrd?.ob?.num, 1);
});

test("invert boolean element via at num <index>", async () => {
  const program = [
    "exists su name doors ob ve bool truth lie truth be vector ya",
    "ob name doors via space num 1 be invert do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const doors = remember("doors");
  assert.ok(Array.isArray(doors?.ob?.ve?.values));
  assert.equal(doors.ob.ve.values[1], "truth"); // lie -> truth
});

test("read boolean element returns truth/lie text", async () => {
  const program = [
    "exists su name switches ob ve bool lie be vector ya",
    "ob name switches via space num 0 be read to name stateval do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const state = remember("stateval");
  assert.equal(state?.ob?.text, "lie");
});
