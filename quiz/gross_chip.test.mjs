import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

const MAX_BYTES = 5040;
const OVERLAP_BYTES = Math.floor(MAX_BYTES / 8);

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function buildNumericSource(minLength) {
  let out = "";
  let i = 0;
  while (out.length < minLength) {
    out += `${String(i).padStart(6, "0")}|`;
    i += 1;
  }
  return out;
}

function locateStarts(source, texts) {
  const starts = [];
  let searchStart = 0;
  for (const text of texts) {
    const idx = source.indexOf(text, searchStart);
    assert.ok(idx >= 0, "chip text must appear in source");
    starts.push(idx);
    searchStart = idx + 1;
  }
  return starts;
}

test("gross chip stores a text series", async () => {
  forget();

  const source = "hello world";
  await run(`from text ${JSON.stringify(source)} to name text gross chips be gross chip do`);

  const series = remember("gross chips");
  assert.ok(series);
  assert.equal(series.be, "series");
  assert.ok(Array.isArray(series.ob?.series));
  assert.equal(series.ob.series.length, 1);
  assert.equal(series.ob.series[0]?.be, "text");
  assert.equal(series.ob.series[0]?.ob?.text, source);
});

test("gross chip respects max size and overlap for ASCII input", async () => {
  forget();

  const source = buildNumericSource(14000);
  await run(`from text ${JSON.stringify(source)} to name text gross chips be gross chip do`);

  const series = remember("gross chips");
  const texts = series.ob.series.map(entry => entry.ob.text);
  assert.ok(texts.length >= 2);

  const starts = locateStarts(source, texts);
  for (const text of texts) {
    assert.ok(byteLength(text) <= MAX_BYTES);
  }
  for (let i = 0; i < texts.length - 1; i += 1) {
    const expectedNext = starts[i] + byteLength(texts[i]) - OVERLAP_BYTES;
    assert.equal(starts[i + 1], expectedNext);
  }
});

test("gross chip prefers whitespace boundary before max size", async () => {
  forget();

  const source = "a".repeat(5030) + " " + "b".repeat(2000);
  await run(`from text ${JSON.stringify(source)} to name text gross chips be gross chip do`);

  const series = remember("gross chips");
  const texts = series.ob.series.map(entry => entry.ob.text);
  assert.ok(texts.length >= 2);
  assert.equal(texts[0].length, 5031);
  assert.ok(texts[0].endsWith(" "));

  const starts = locateStarts(source, texts);
  const expectedNext = starts[0] + byteLength(texts[0]) - OVERLAP_BYTES;
  assert.equal(starts[1], expectedNext);
});

test("gross chip avoids splitting UTF-8 sequences", async () => {
  forget();

  const source = "a".repeat(5039) + "€" + "b".repeat(1000);
  await run(`from text ${JSON.stringify(source)} to name text gross chips be gross chip do`);

  const series = remember("gross chips");
  const texts = series.ob.series.map(entry => entry.ob.text);
  assert.ok(texts.length >= 2);
  assert.ok(texts.some(text => text.includes("€")));
  for (const text of texts) {
    assert.equal(text.includes("\uFFFD"), false);
  }
});
