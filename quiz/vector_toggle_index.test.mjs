import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("invert toggles a boolean door at a given index", async () => {
  forget();

  const sentences = [
    "exists subj name doors obj ve bool truth lie truth be vector ya",
    "obj name doors at num 1 be invert do"
  ].map(parse).filter(Boolean);

  for (const s of sentences) await interpret(s);

  const doors = remember("doors");
  assert.ok(Array.isArray(doors?.obj?.ve?.values));
  assert.deepEqual(doors.obj.ve.values, ["truth", "truth", "truth"]);
});
