import test from "node:test";
import assert from "node:assert/strict";

// TODO: implement vector element addressing (read/write/invert) with "at" + quantity index.

test("read element from numeric vector via at num <index>", async () => {
  const program = [
    "exists subj name doors obj ve num 0 1 0 be vector ya",
    "obj name doors via space num 2 be read to name picked do"
  ].join("\n");

  const { interpret } = await import("../program/bridge/index.mjs");
  const { parse } = await import("../program/understand/index.mjs");
  const { remember, forget } = await import("../program/remember/index.mjs");

  forget();
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const picked = remember("picked");
  assert.equal(picked?.obj?.num, 1);
});

test("invert boolean element via at num <index>", async () => {
  const program = [
    "exists subj name doors obj ve text truth lie truth be vector ya",
    "obj name doors via space num 2 be invert do"
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
    "exists subj name switches obj ve text lie be vector ya",
    "obj name switches via space num 1 be read to name stateval do"
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
