import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("verify phrase count from remembered text and phrase stores map output", async () => {
  forget();
  await run('exists su name text source ob text "armor of light armor of light shine bright" be text ya');
  await run('exists su name text phrase ob text "armor of light" be text ya');
  await run("be verify as wo phrase count atleast num 2 atmost num 3 from name text source with name text phrase to name map report do");
  const report = remember("report");
  assert.equal(report?.be, "map");
  assert.equal(report?.ob?.map?.pass, true);
  assert.equal(report?.ob?.map?.occurrences, 2);
  assert.equal(report?.ob?.map?.phrase, "armor of light");
  assert.equal(report?.ob?.map?.mode, "phrase count");
  assert.equal(report?.ob?.map?.source, "source");
});

test("verify phrase count from ob text with literal phrase fails outside bounds", async () => {
  forget();
  await run('be verify as wo phrase count atleast num 3 atmost num 5 ob text "shine bright shine bright" with text "shine bright" to name map report do');
  const report = remember("report");
  assert.equal(report?.ob?.map?.pass, false);
  assert.equal(report?.ob?.map?.occurrences, 2);
  assert.equal(report?.ob?.map?.phrase, "shine bright");
  assert.equal(report?.ob?.map?.source, "ob text");
});

test("verify phrase count rejects missing phrase input", async () => {
  forget();
  await run('exists su name text source ob text "alpha beta gamma" be text ya');
  await assert.rejects(
    () => run("be verify as wo phrase count atleast num 1 atmost num 2 from name text source to name map report do"),
    /verify defective: expected with text or with name text phrase/
  );
});
