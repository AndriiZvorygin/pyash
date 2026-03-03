import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember, remember } from "../program/remember/index.mjs";

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

test("map def inside ceremony body is replayed at invoke time", async () => {
  forget();

  await run("su name maker to name map output be ceremony def");
  await run("su name output be map def");
  await run('su name pass ob text "false" ya');
  await run('su name verdict ob text "FAIL" ya');
  await run("prah");
  await run("su name output ret");
  await run("su name maker be ceremony prah");

  await run("su name demo to name map out be maker do");

  const out = remember("out");
  assert.ok(out?.ob?.map, "expected out map payload");
  assert.equal(out?.ob?.map?.pass?.ob?.text, "false");
  assert.equal(out?.ob?.map?.verdict?.ob?.text, "FAIL");
});
