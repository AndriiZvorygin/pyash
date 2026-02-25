import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";

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

test("series map accepts itinerary series payloads", async () => {
  forget();
  doRemember({
    mood: "ya",
    su: { name: "teaching sections" },
    be: "itinerary",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "cut 001" },
          since: { num: 0 },
          until: { num: 1 },
          ob: { text: "first paragraph" },
          be: "cut"
        },
        {
          mood: "ya",
          su: { name: "cut 002" },
          since: { num: 1 },
          until: { num: 2 },
          ob: { text: "second paragraph" },
          be: "cut"
        }
      ]
    }
  });

  await run("from name teaching sections by name text to name text mapped be series map do");

  const series = remember("mapped");
  assert.ok(series);
  assert.equal(series.be, "series");
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, ["first paragraph", "second paragraph"]);
});

test("series map mapper fromindex register does not trigger ceremony loop execution", async () => {
  forget();

  await run("su name items be series def");
  await run('su name item 1 ob text "alpha" be text ya');
  await run('su name item 2 ob text "beta" be text ya');
  await run("prah");

  await run("su name mapper ob text item fromindex num 0 be ceremony def");
  await run("su name mapper index stage ob num of fromindex of this to name num mapper index be plus do");
  await run("ob num 1 to name mapper index be plus do");
  await run("su name mapper output stage ob text of ob of this to name text mapper output be text do");
  await run("su name mapper output stage ret");
  await run("prah");

  await run("from name items by name mapper to name text mapped be series map do");

  const series = remember("mapped");
  assert.ok(series);
  assert.equal(series.be, "series");
  assert.equal((series.ob?.series ?? []).length, 2);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, ["alpha", "beta"]);
  assert.deepEqual(series.ob.series.map(entry => entry?.from?.num), [1, 2]);
});

test("series map preserves filename outputs from ceremony mappers", async () => {
  forget();

  await run("su name items be series def");
  await run('su name item 1 ob text "alpha" be text ya');
  await run('su name item 2 ob text "beta" be text ya');
  await run("prah");

  await run("su name mapper ob text item fromindex num 0 to name filename section clip be ceremony def");
  await run('su name section clip stage ob filename "artifacts/run/section-footnote.mp4" to name filename section clip be filename do');
  await run("su name section clip stage ret");
  await run("prah");

  await run("from name items by name mapper to name text mapped be series map do");

  const series = remember("mapped");
  assert.ok(series);
  assert.equal(series.be, "series");
  const rows = Array.isArray(series.ob?.series) ? series.ob.series : [];
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.be, "filename");
  assert.equal(String(rows[0]?.ob?.filename ?? ""), "artifacts/run/section-footnote.mp4");
});
