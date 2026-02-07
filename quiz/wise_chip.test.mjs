import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("wise chip resolves marker boundaries from boundary series", async () => {
  forget();

  const source = "Intro start A ... end A. Middle. Start B ... end B. Tail.";
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob ve text "start A" "Start B" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  assert.equal(series.be, "series");
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.equal(texts.length, 2);
  assert.equal(texts[0], "start A ... end A. Middle. ");
  assert.equal(texts[1], "Start B ... end B. Tail.");
});

test("wise chip skips duplicate boundary markers that resolve to the same offset", async () => {
  forget();

  const source = "## One\nA\n## Two\nB\n";
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob ve text "## One" "## One" "## Two" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, ["## One\\nA\\n", "## Two\\nB\\n"]);
});

test("wise chip normalizes wrapper quotes around boundary markers", async () => {
  forget();

  const source = "## Start\\nA\\n## End\\nB\\n";
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob text "\\"## Start\\"" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, ["## Start\\nA\\n## End\\nB\\n"]);
});
