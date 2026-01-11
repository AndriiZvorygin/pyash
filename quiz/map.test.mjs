import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget, dumpSandpits, doRemember } from "../program/remember/index.mjs";

test("at all map writes to new vector via to", async () => {
  forget();
  const program = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "be invert ob name values to name out at name all do"
  ].join("\n");
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const out = remember("out");
  assert.ok(out?.ob?.ve?.values);
  assert.deepEqual(out.ob.ve.values, [-1, -2, -3]);
});

test("at all foreach updates source vector in place when no to", async () => {
  forget();
  const program = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "be invert ob name values at name all do"
  ].join("\n");
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const vec = remember("values");
  assert.ok(vec?.ob?.ve?.values);
  assert.deepEqual(vec.ob.ve.values, [-1, -2, -3]);
});

test("at all provides atindex register inside ceremony body", async () => {
  forget();
  const program = [
    "exists su name values ob ve num 4 5 6 be vector ya",
    "su name capture-index ob num value atindex num 0 be ceremony def",
    "su name picked ob this atindex be number ya",
    "su name picked ret",
    "su name capture-index be ceremony prah",
    "be capture-index ob name values at name all do"
  ].join("\n");
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const sandpit = dumpSandpits().at(-1) || [];
  const evoker = sandpit[0];
  assert.equal(evoker?.atindex?.num, 2, "last atindex register should be visible inside ceremony body");
});

test("at all can increment each element via ceremony in place", async () => {
  forget();
  const program = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "su name bump ob num value be ceremony def",
    "ob num 1 to this ti ob ti num be plus do",
    "su name bump be ceremony prah",
    "ob name values at name all be bump do"
  ].join("\n");
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const vec = remember("values");
  assert.deepEqual(vec?.ob?.ve?.values, [2, 3, 4]);
});

test.todo("100 doors via at all toggles only square positions open (pending 100-doors map logic)");

test("10 doors via at all toggles only square positions open (map, by pass)", async () => {
  forget();
  const program = [
    "exists su name doors ob ve num 0 0 0 0 0 0 0 0 0 0 be vector ya",
    // Toggle a single door if (atindex+1) % pass === 0.
    "su name toggle pass by num 0 ob num value atindex num 0 be ceremony def",
    "su name door ob this atindex be number ya",
    "ob num 1 to num of ob of door be plus do",
    "ob num of ob of door from num of by of this to name rem be remains do",
    "ob name rem be equally from num 0 then ob num 1 to this ti ob ti num be plus do",
    "ob name rem be equally from num 0 then ob this ti ob ti num from num 2 to this ti ob ti num be remains do",
    "su name toggle pass be ceremony prah",
    // For passes 1..10 inclusive: stop when fromindex==11.
    "su name process pass fromindex num 0 be ceremony def",
    "ob name doors by num of fromindex of this at name all be toggle pass do",
    "su name process pass be ceremony prah",
    "fromindex num 1 toindex num 11 be process pass do",
  ].join("\n");
  const sentences = program.split("\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const values = remember("doors")?.ob?.ve?.values ?? [];
  assert.deepEqual(values, [1, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
});

/*
test("at all map writes to new vector via to", async () => {
  forget();
  const program = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "be invert ob name values to name out at name all do"
  ].join("\\n");
  const sentences = program.split("\\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const out = remember("out");
  assert.ok(out?.ob?.ve?.values);
  assert.deepEqual(out.ob.ve.values, [-1, -2, -3]);
});

test("at all foreach updates source vector in place when no to", async () => {
  forget();
  const program = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "be invert ob name values at name all do"
  ].join("\\n");
  const sentences = program.split("\\n").map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  const vec = remember("values");
  assert.ok(vec?.ob?.ve?.values);
  assert.deepEqual(vec.ob.ve.values, [-1, -2, -3]);
});

test("at all provides by register for index inside ceremony body", async () => {
  forget();
  const program = [
    "exists su name values ob ve num 4 5 6 be vector ya",
    "su name capture-index to name num atindex num 0 be ceremony def",
    "su name picked ob this atindex be number ya",
    "su name picked ret",
    "su name capture-index be ceremony prah",
    "be capture-index ob name values to name out at name all do"
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

test("100 doors via at all toggles only square positions open", async () => {
  forget();
  const doors = Array(100).fill(0);
  // Seed doors vector directly
  doRemember({
    mood: "ya",
    exists: true,
    su: { name: "doors" },
    ob: { ve: { values: doors } },
    be: "vector"
  });

  const program = [
    // Toggle a single door if its index is divisible by the current pass (fromindex)
    "su name toggle-door be ceremony def",
    "su name val ob this ob be number ya",
    "su name idx ob this atindex be number ya",
    "ob num 1 to name idx be plus do",
    "ob name idx from name current-pass to name rem be remains do",
    "ob name rem be equally from num 0 then ob num 1 to name val be plus do",
    "ob name rem be equally from num 0 then ob name val from num 2 to name val be remains do",
    "su name val ret",
    "su name toggle-door be ceremony prah"
  ];

  const sentences = program.map(parse).filter(Boolean);
  for (const s of sentences) await interpret(s);

  for (let pass = 1; pass <= 100; pass++) {
    await interpret(parse(`su name current-pass ob num ${pass} be number ya`));
    await interpret(parse("ob name doors by name current-pass to name doors at name all be toggle-door do"));
  }

  const result = remember("doors")?.ob?.ve?.values ?? [];
  const openIndices = [];
  result.forEach((v, idx) => {
    if (v === 1) openIndices.push(idx + 1); // convert to 1-based door number
  });

  const expectedOpen = Array.from({ length: 10 }, (_, i) => (i + 1) * (i + 1));
  assert.deepEqual(openIndices, expectedOpen);
});
*/
