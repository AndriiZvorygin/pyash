import test from "node:test";
import assert from "node:assert/strict";

test("read element from numeric vector via at num <index>", async () => {
  const program = [
    "exists subj name doors obj ve num 3 1 0 be vector ya",
    "obj name doors via space num 0 be read to name first do",
    "obj name doors via space num 1 be read to name second do",
    "obj name doors via space num 2 be read to name third do",
    "obj name doors at ord 2 be read to name secondOrd do"
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
  assert.equal(first?.obj?.num, 3);
  assert.equal(second?.obj?.num, 1);
  assert.equal(third?.obj?.num, 0);
  assert.equal(secondOrd?.obj?.num, 1);
});

test("invert boolean element via at num <index>", async () => {
  const program = [
    "exists subj name doors obj ve bool truth lie truth be vector ya",
    "obj name doors via space num 1 be invert do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const doors = remember("doors");
  assert.ok(Array.isArray(doors?.obj?.ve?.values));
  assert.equal(doors.obj.ve.values[1], "truth"); // lie -> truth
});

test("read boolean element returns truth/lie text", async () => {
  const program = [
    "exists subj name switches obj ve bool lie be vector ya",
    "obj name switches via space num 0 be read to name stateval do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const state = remember("stateval");
  assert.equal(state?.obj?.text, "lie");
});
