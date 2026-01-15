import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("json map export errors on self reference", async () => {
  forget();

  await run("su name loop be json map def");
  await run("exists su name self ob name loop ya");
  await run("prah");

  let err;
  try {
    await run("ob name loop to state json be write do");
  } catch (caught) {
    err = caught;
  }

  assert.ok(err);
  assert.equal(err.sentence?.su?.name, "json map export self referential");
});

test("json map export errors on indirect self reference", async () => {
  forget();

  await run("su name first be json map def");
  await run("exists su name link ob name second ya");
  await run("prah");

  await run("su name second be json map def");
  await run("exists su name link ob name first ya");
  await run("prah");

  let err;
  try {
    await run("ob name first to state json be write do");
  } catch (caught) {
    err = caught;
  }

  assert.ok(err);
  assert.equal(err.sentence?.su?.name, "json map export self referential");
});
