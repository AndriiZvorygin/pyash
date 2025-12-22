import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("compile converts json text to pyash json map defs", async () => {
  forget();

  const json = JSON.stringify({
    name: "Ada",
    pets: [{ kind: "cat" }]
  });

  await run(
    `subj name profile obj text ${JSON.stringify(json)} from state json to state pyash to name output be compile do`
  );

  const output = remember("output");
  const text = output?.obj?.text ?? "";

  assert.match(text, /quoted\.pyash\./);
  assert.match(text, /subj name profile pets 1 be json map def/);
  assert.match(text, /subj name profile be json map def/);
  assert.match(text, /subj name pets obj ve name "profile pets 1" ya/);
  assert.match(text, /subj name profile be json map prah/);

  const childIdx = text.indexOf("subj name profile pets 1 be json map def");
  const parentIdx = text.indexOf("subj name profile be json map def");
  assert.ok(childIdx >= 0 && parentIdx >= 0);
  assert.ok(childIdx < parentIdx);
});
