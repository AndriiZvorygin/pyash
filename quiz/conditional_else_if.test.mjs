import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("inline else-if executes alternative conditional consequence", async () => {
  forget();
  await run('ob num 1 from num 2 be equally else if ob num 3 from num 3 be equally then ob text "alt" to name text out be text do');
  assert.equal(remember("out")?.ob?.text, "alt");
});

test("inline else executes fallback sentence", async () => {
  forget();
  await run('ob num 1 from num 2 be equally else ob text "fallback" to name text out be text do');
  assert.equal(remember("out")?.ob?.text, "fallback");
});
