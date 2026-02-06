import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("series map applies a mapper and returns a series", async () => {
  forget();

  await run("su name items be series def");
  await run('su name item 1 ob text "alpha" be text ya');
  await run('su name item 2 ob text "beta" be text ya');
  await run("prah");

  await run("from name items by name text to name text mapped be series map do");

  const series = remember("mapped");
  assert.ok(series);
  assert.equal(series.be, "series");
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, ["alpha", "beta"]);
  assert.deepEqual(series.ob.series.map(entry => entry?.from?.num), [1, 2]);
});
