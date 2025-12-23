import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("genitive num of ob of this mutates target", async () => {
  forget();

  const lines = [
    "exists su name bucket ob num 1 be number ya",
    "su name bump ob name num value be ceremony def",
    "ob num 2 to num of ob of this be add do",
    "su name bump be ceremony prah",
    "su name evoker ob name bucket be bump do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const bucket = remember("bucket");
  assert.equal(bucket?.ob?.num, 3);
});

test("genitive this ti ob ti num mutates target", async () => {
  forget();

  const lines = [
    "exists su name bucket ob num 1 be number ya",
    "su name bump ob name num value be ceremony def",
    "ob num 2 to this ti ob ti num be add do",
    "su name bump be ceremony prah",
    "su name evoker ob name bucket be bump do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const bucket = remember("bucket");
  assert.equal(bucket?.ob?.num, 3);
});

test("genitive remains uses evoker fields", async () => {
  forget();

  const lines = [
    "exists su name counter ob num 5 be number ya",
    "su name modceremony ob name num value from num be ceremony def",
    "ob name counter from num 3 be remains to name counter do",
    "su name modceremony  prah",
    "su name evoker ob name counter from num 3 be modceremony do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const mod = remember("counter");
  assert.equal(mod?.ob?.num, 2); // 5 % 3 = 2
});
