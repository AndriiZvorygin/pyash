import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget, dumpSandpits, doRemember } from "../program/remember/index.mjs";

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

test("at all can increment each element via ceremony in place", { todo: "Interpreter map write-back still pending" }, async () => {});

test("100 doors via at all toggles only square positions open", async () => {
  test.todo("Implement 100-doors map logic per documentation/map.md");
});

/*
test("100 doors via at all toggles only square positions open", async () => {
  forget();
  const doors = Array(100).fill(0);
  // Seed doors vector directly
  doRemember({
    mood: "ya",
    exists: true,
    subj: { name: "doors" },
    obj: { ve: { values: doors } },
    be: "vector"
  });

  const program = [
    // Toggle a single door if its index is divisible by the current pass (fromindex)
    "subj name toggle-door be ceremony def",
    "subj name val obj this obj be number ya",
    "subj name idx obj this atindex be number ya",
    "obj num 1 to name idx be add do",
    "obj name idx from name current-pass to name rem be remains do",
    "obj name rem be equally from num 0 then obj num 1 to name val be add do",
    "obj name rem be equally from num 0 then obj name val from num 2 to name val be remains do",
    "subj name val ret",
    "subj name toggle-door be ceremony prah"
  ];

  const sentences = program.map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  for (let pass = 1; pass <= 100; pass++) {
    await interpret(parse(`subj name current-pass obj num ${pass} be number ya`));
    await interpret(parse("obj name doors by name current-pass to name doors at name all be toggle-door do"));
  }

  const result = remember("doors")?.obj?.ve?.values ?? [];
  const openIndices = [];
  result.forEach((v, idx) => {
    if (v === 1) openIndices.push(idx + 1); // convert to 1-based door number
  });

  const expectedOpen = Array.from({ length: 10 }, (_, i) => (i + 1) * (i + 1));
  assert.deepEqual(openIndices, expectedOpen);
});
*/
