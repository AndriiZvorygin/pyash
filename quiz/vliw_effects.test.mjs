import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  analyzeCodeletDependencies,
  decodeCodelet,
  deriveSentenceEffects,
  lowerSentence
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
