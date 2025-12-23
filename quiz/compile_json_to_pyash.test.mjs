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
    `su name profile ob text ${JSON.stringify(json)} from state json to state pyash to name output be compile do`
  );

  const output = remember("output");
  const text = output?.ob?.text ?? "";

  assert.match(text, /quoted\.pyash\./);
  assert.match(text, /su name profile pets 1 be json map def/);
  assert.match(text, /su name profile be json map def/);
  assert.match(text, /su name pets ob ve name "profile pets 1" ya/);
  assert.match(text, /\bprah\b/);

  const childIdx = text.indexOf("su name profile pets 1 be json map def");
  const parentIdx = text.indexOf("su name profile be json map def");
  assert.ok(childIdx >= 0 && parentIdx >= 0);
  assert.ok(childIdx < parentIdx);
});
