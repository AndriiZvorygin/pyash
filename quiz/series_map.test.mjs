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

test("series map accepts ceremony mappers that resolve to typed by signatures", async () => {
  forget();

  await run("su name items be series def");
  await run('su name item 1 ob text "alpha" be text ya');
  await run('su name item 2 ob text "beta" be text ya');
  await run("prah");

  await run("su name label to name text output be ceremony def");
  await run('exists su name output ob text "boundary marker" be text ya');
  await run("prah");

  await run("from name items by name label to name text mapped be series map do");

  const series = remember("mapped");
  assert.ok(series);
  assert.equal(series.be, "series");
  assert.equal((series.ob?.series ?? []).length, 2);
  assert.deepEqual(series.ob.series.map(entry => entry?.from?.num), [1, 2]);
});

test("series map routes by name mind through write calls", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "## marker";
  try {
    forget();

    await run("exists su name helper be mind via state \"qwen3-vl:8b-instruct\" ya");
    await run("su name items be series def");
    await run('su name item 1 ob text "alpha" be text ya');
    await run('su name item 2 ob text "beta" be text ya');
    await run("prah");

    await run("from name items by name helper to name text mapped be series map do");

    const series = remember("mapped");
    assert.ok(series);
    assert.equal(series.be, "series");
    const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
    assert.deepEqual(texts, ["## marker", "## marker"]);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
