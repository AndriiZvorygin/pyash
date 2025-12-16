import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("map at all can conditionally invert based on at index and pass", async () => {
  forget();

  const lines = [
    "exists subj name doors obj ve bool truth lie truth lie be vector ya",
    "exists subj name pass obj num 2 be number ya",
    "subj name toggle if be ceremony def",
    "obj num ti this ti at be remains from num ti this ti pass to name mod do",
    "obj name mod be equally from num 0 then obj name doors at num ti this ti at be invert do",
    "subj name toggle if be ceremony prah",
    "obj name doors at name all by num ti pass ti this be toggle if do"
  ];

  for (const line of lines) {
    const s = parse(line);
    if (s) await interpret(s);
  }

  const doors = remember("doors")?.obj?.ve?.values;
  assert.ok(Array.isArray(doors));
  // pass=2 should flip indices 2,4,... (1-based), so truth/lie/truth/lie -> truth/truth/truth/truth
  assert.deepEqual(doors, ["truth", "truth", "truth", "truth"]);
});

