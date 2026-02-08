import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("resemble matches plain text pattern case-insensitively", async () => {
  forget();
  await run("exists su name hits ob num 0 be number ya");
  await run('ob text "approved PASS verdict" from text "pass" be resemble then ob num 1 to name hits be plus do');
  assert.equal(remember("hits")?.ob?.num, 1);
});

test("resemble supports regex literal with flags", async () => {
  forget();
  await run("exists su name hits ob num 0 be number ya");
  await run('ob text quoted.text.reasoning\nPASS.text.quoted from text "/^PASS$/m" be resemble then ob num 1 to name hits be plus do');
  assert.equal(remember("hits")?.ob?.num, 1);
});

test("resemble returns false for invalid regex", async () => {
  forget();
  await run("exists su name hits ob num 0 be number ya");
  await run('ob text "abc" from text "/([/" be resemble then ob num 1 to name hits be plus do');
  assert.equal(remember("hits")?.ob?.num, 0);
});
