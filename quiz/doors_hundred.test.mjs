import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("100 doors ceremony toggles only divisors (placeholder genitive)", async () => {
  forget();

  const doorsInit = "lie ".repeat(100).trim();
  const lines = [
    `exists subj name doors obj ve bool ${doorsInit} be vector ya`,
    // TODO: fix genitive ordering before enabling
    "subj name toggle door obj name doors at num index be ceremony def",
    "obj this ti at ti num be remains by num ti this ti pass to name mod do",
    "obj name mod be equally from num 0 then obj name doors at num ti this ti at be invert do",
    "subj name toggle door be ceremony prah",
    // Loop passes 1..100
    "exists subj name pass obj num 1 be number ya",
    "obj name pass fromindex num 1 toindex num 100 be loop do",
    "obj name doors at name all by num ti pass ti this be toggle door do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const doors = remember("doors")?.obj?.ve?.values;
  assert.ok(Array.isArray(doors));
  for (let i = 0; i < doors.length; i++) {
    const isSquare = Number.isInteger(Math.sqrt(i + 1));
    assert.equal(doors[i], isSquare ? "truth" : "lie");
  }
});
