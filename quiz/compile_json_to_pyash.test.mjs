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

test("compile converts large nested json without truncation (stress)", async () => {
  forget();

  const items = [];
  for (let i = 0; i < 250; i += 1) {
    items.push({
      id: i,
      label: `item-${i}`,
      flags: [i % 2 === 0, i % 3 === 0, i % 5 === 0],
      meta: { bucket: Math.floor(i / 25), weight: i + 0.5 },
    });
  }
  const json = JSON.stringify({
    title: "stress-profile",
    count: items.length,
    items,
  });

  await run(
    `su name stress_profile ob text ${JSON.stringify(json)} from state json to state pyash to name output be compile do`
  );

  const output = remember("output");
  const text = output?.ob?.text ?? "";

  assert.match(text, /quoted\.pyash\./);
  assert.match(text, /su name stress_profile be json map def/);
  assert.match(text, /su name title ob text "stress-profile" ya/);
  assert.match(text, /su name count ob num 250 ya/);
  assert.match(text, /su name stress_profile items 1 be json map def/);
  assert.match(text, /su name stress_profile items 250 be json map def/);
  assert.match(text, /su name id ob num 249 ya/);
  assert.ok(text.length > 50_000, "expected large pyash output for stress payload");
});
