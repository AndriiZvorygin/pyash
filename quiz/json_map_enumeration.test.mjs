import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("json map enumeration yields ordered keys, values, and entries", async () => {
  forget();

  await run("su name sample be json map def");
  await run('su name b ob text "bee" ya');
  await run("su name a ob num 1 ya");
  await run("su name aa ob bool truth ya");
  await run("su name skip ob unspecified ya");
  await run("prah");

  const keyRes = await run("all su of sample be read do");
  assert.deepEqual(keyRes?.value?.ve?.values, ["a", "aa", "b"]);

  const valRes = await run("all ob of sample be read do");
  assert.deepEqual(valRes?.value?.ve?.values, [1, true, "bee"]);

  const entryRes = await run("all of sample be read do");
  assert.deepEqual(
    entryRes?.value?.ve?.values,
    [
      { ve: { type: "raw", values: ["a", 1] } },
      { ve: { type: "raw", values: ["aa", true] } },
      { ve: { type: "raw", values: ["b", "bee"] } }
    ]
  );
});

test("json map enumeration errors on non-json map", async () => {
  forget();

  await run("su name sample be map def");
  await run("su name a ob num 1 ya");
  await run("prah");

  let err;
  try {
    await run("all su of sample be read do");
  } catch (caught) {
    err = caught;
  }

  assert.ok(err);
  assert.equal(err.sentence?.su?.name, "json map enumeration defective");
});
