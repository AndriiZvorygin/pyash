import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("abridge stores deterministic text output within byte budget", async () => {
  forget();

  const source = [
    "## Overview",
    "The system should reduce repetitive statements.",
    "Action required: keep dates like 2026-02-08.",
    "In summary, preserve key decisions and numbers."
  ].join("\n");
  await run(`from text ${JSON.stringify(source)} atmost byte 110 to name text abridged be abridge do`);

  const fact = remember("abridged");
  assert.ok(fact);
  assert.equal(fact.be, "text");
  assert.ok(typeof fact.ob?.text === "string");
  assert.ok(Buffer.byteLength(fact.ob.text, "utf8") <= 110);
});

test("abridge is deterministic for same input and budget", async () => {
  forget();

  const source = "Decision: ship now. Action required today. Action required today. Notes remain.";
  const one = await run(`from text ${JSON.stringify(source)} atmost byte 80 be abridge do`);
  const two = await run(`from text ${JSON.stringify(source)} atmost byte 80 be abridge do`);
  assert.equal(one?.ob?.text, two?.ob?.text);
});

test("abridge keeps selected sentences in source order", async () => {
  forget();

  const source = [
    "Middle details are verbose.",
    "Decision approved by board.",
    "Background context that is less critical.",
    "Action required by Friday."
  ].join(" ");
  const result = await run(`from text ${JSON.stringify(source)} atmost byte 120 be abridge do`);
  const lines = String(result?.ob?.text ?? "").split("\n").filter(Boolean);
  let cursor = 0;
  for (const line of lines) {
    const idx = source.indexOf(line, cursor);
    assert.ok(idx >= 0, "selected sentence must appear after prior selection");
    cursor = idx + line.length;
  }
});

test("abridge reduces duplicate n-gram sentences", async () => {
  forget();

  const source = [
    "Action required now.",
    "Action required now.",
    "Action required now.",
    "Decision final."
  ].join(" ");
  const result = await run(`from text ${JSON.stringify(source)} atmost byte 200 be abridge do`);
  const output = String(result?.ob?.text ?? "");
  const repeats = output.match(/Action required now\./g) ?? [];
  assert.ok(repeats.length <= 1);
});

test("abridge throws when source text is missing", async () => {
  forget();

  await assert.rejects(
    run("from name text missing source be abridge do"),
    (err) => err?.sentence?.su?.name === "abridge defective"
  );
});

test("abridge maps across a series via ob text payload", async () => {
  forget();

  await run("su name wise chips be series def");
  await run('su name chip 1 ob text "Decision approved. Extra notes." be text ya');
  await run('su name chip 2 ob text "Action required now. Action required now." be text ya');
  await run("prah");

  await run("from name wise chips by name abridge to name text abridged chips be series map do");
  const series = remember("abridged chips");
  assert.ok(series);
  assert.equal(series.be, "series");
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.equal(texts.length, 2);
  assert.ok(texts[0].includes("Decision"));
  const repeats = texts[1].match(/Action required now\./g) ?? [];
  assert.ok(repeats.length <= 1);
});
