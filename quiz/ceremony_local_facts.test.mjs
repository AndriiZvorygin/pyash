import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ya facts inside ceremony body do not leak to main memory", async () => {
  forget();

  await run("su name maker be ceremony def");
  await run("exists su name local ob num 7 be number ya");
  await run("su name maker be ceremony prah");

  const before = allRemember().filter(s => s.su?.name === "local").length;
  await run("be maker do");
  const after = allRemember().filter(s => s.su?.name === "local").length;

  assert.equal(after, before, "no new local facts should be added to main memory");
});
