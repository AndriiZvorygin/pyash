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

  await run("subj name maker be ceremony def");
  await run("subj name local obj num 7 be number ya");
  await run("subj name maker be ceremony prah");

  const before = allRemember().filter(s => s.subj?.name === "local").length;
  await run("be maker do");
  const after = allRemember().filter(s => s.subj?.name === "local").length;

  assert.equal(after, before, "no new local facts should be added to main memory");
});
