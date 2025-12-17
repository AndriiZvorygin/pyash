import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("genitive num of obj of this mutates target", async () => {
  forget();

  const lines = [
    "exists subj name bucket obj num 1 be number ya",
    "subj name bump obj name num be ceremony def",
    "obj num 2 to num of obj of this be add do",
    "subj name bump be ceremony prah",
    "subj name evoker obj name bucket be bump do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const bucket = remember("bucket");
  assert.equal(bucket?.obj?.num, 3);
});

test("genitive this ti obj ti num mutates target", async () => {
  forget();

  const lines = [
    "exists subj name bucket obj num 1 be number ya",
    "subj name bump obj name num be ceremony def",
    "obj num 2 to this ti obj ti num be add do",
    "subj name bump be ceremony prah",
    "subj name evoker obj name bucket be bump do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const bucket = remember("bucket");
  assert.equal(bucket?.obj?.num, 3);
});

test("genitive remains uses evoker fields", async () => {
  forget();

  const lines = [
    "exists subj name counter obj num 5 be number ya",
    "subj name modceremony obj name num from num be ceremony def",
    "obj name counter from num 3 be remains to name counter do",
    "subj name modceremony  prah",
    "subj name evoker obj name counter from num 3 be modceremony do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const mod = remember("counter");
  assert.equal(mod?.obj?.num, 2); // 5 % 3 = 2
});
