import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("import loads json object into json map with nested arrays", async () => {
  forget();

  const json = JSON.stringify({
    name: "Ada",
    pets: [{ kind: "cat" }, { kind: "dog" }],
    tags: [true, false]
  });

  await run(`obj text ${JSON.stringify(json)} to name profile be import do`);

  const profile = remember("profile");
  assert.equal(profile?.be, "json map");
  assert.equal(profile?.obj?.map?.name?.text, "Ada");

  const pets = profile?.obj?.map?.pets;
  assert.equal(pets?.ve?.type, "name");
  assert.deepEqual(pets?.ve?.values, ["profile pets 1", "profile pets 2"]);

  const tags = profile?.obj?.map?.tags;
  assert.equal(tags?.ve?.type, "bool");
  assert.deepEqual(tags?.ve?.values, ["truth", "lie"]);

  const cat = remember("profile pets 1");
  assert.equal(cat?.be, "json map");
  assert.equal(cat?.obj?.map?.kind?.text, "cat");

  const dog = remember("profile pets 2");
  assert.equal(dog?.be, "json map");
  assert.equal(dog?.obj?.map?.kind?.text, "dog");
});

test("imported json map can be exported via write", async () => {
  forget();

  const json = JSON.stringify({
    name: "Ada",
    pets: [{ kind: "cat" }],
    tags: [true, false]
  });

  await run(`obj text ${JSON.stringify(json)} to name profile be import do`);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("obj name profile to state json be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.equal(
    logs[0],
    '{\n  "name": "Ada",\n  "pets": [\n    {\n      "kind": "cat"\n    }\n  ],\n  "tags": [\n    true,\n    false\n  ]\n}'
  );
});
