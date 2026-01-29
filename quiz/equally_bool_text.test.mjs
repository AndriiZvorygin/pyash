import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("equally compares truth/lie text (true case)", async () => {
  forget();

  await run("exists su name hits ob num 0 be number ya");
  await run("ob text truth be equally from text truth then ob num 1 to name hits be plus do");

  const hits = remember("hits");
  assert.equal(hits.ob.num, 1);
});

test("equally compares truth/lie text (false case)", async () => {
  forget();

  await run("exists su name hits ob num 0 be number ya");
  await run("ob text truth be equally from text lie then ob num 1 to name hits be plus do");

  const hits = remember("hits");
  assert.equal(hits.ob.num, 0);
});

test("equally resolves ob name text in conditionals", async () => {
  forget();

  await run("exists su name status ob text \"PASS\" be text ya");
  await run("exists su name hits ob num 0 be number ya");
  await run("ob name status from text \"PASS\" be equally then ob num 1 to name hits be plus do");

  const hits = remember("hits");
  assert.equal(hits.ob.num, 1);
});
