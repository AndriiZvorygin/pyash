import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  analyzeCodeletDependencies,
  decodeCodelet,
  deriveSentenceEffects,
  lowerSentence,
  scheduleCodeletDependencies
} from "../program/library/vliw/index.mjs";

test("decoded instructions expose stable read and write effects", () => {
  const named = decodeCodelet(lowerSentence(parse("su name collector ob num 7 be number ya"))[0].words);
  const update = deriveSentenceEffects(parse("ob num 2 from name collector be subtract do"));
  assert.deepEqual(named.effects, { reads: [], writes: ["collector"], sideEffect: false });
  assert.deepEqual(update, {
    reads: ["collector"],
    writes: ["collector"],
    sideEffect: false
  });
});

test("dependency analysis reports unresolved references without changing execution order", () => {
  const instructions = [
    { sentence: parse("ob num 2 from name collector be subtract do") },
    { sentence: parse("su name collector ob num 7 be number ya") }
  ];
  assert.deepEqual(analyzeCodeletDependencies(instructions), [
    {
      index: 0,
      reads: ["collector"],
      writes: ["collector"],
      dependencies: ["collector"],
      ready: false,
      sideEffect: false
    },
    {
      index: 1,
      reads: [],
      writes: ["collector"],
      dependencies: [],
      ready: true,
      sideEffect: false
    }
  ]);
});

test("dependency scheduling places producers first and keeps independent order stable", () => {
  const consumer = { sentence: { ob: { name: "collector" }, be: "read" } };
  const producer = { sentence: { su: { name: "collector" } } };
  const independent = { sentence: { su: { name: "answer" } } };
  assert.deepEqual(
    scheduleCodeletDependencies([consumer, producer, independent]).map((entry) => entry.index),
    [1, 0, 2]
  );
});

test("dependency scheduling rejects unresolved and duplicate references", () => {
  assert.throws(
    () => scheduleCodeletDependencies([{ sentence: { ob: { name: "missing" }, be: "read" } }]),
    (error) => error.code === "unfulfilled-dependency"
  );
  assert.throws(
    () => scheduleCodeletDependencies([
      { sentence: { su: { name: "collector" } } },
      { sentence: { su: { name: "collector" } } }
    ]),
    (error) => error.code === "duplicate-writer"
  );
});

test("dependency scheduling preserves observable side-effect order", () => {
  const first = { sentence: { be: "command" } };
  const second = { sentence: { be: "write" } };
  assert.deepEqual(
    scheduleCodeletDependencies([first, second]).map((entry) => entry.index),
    [0, 1]
  );
});
