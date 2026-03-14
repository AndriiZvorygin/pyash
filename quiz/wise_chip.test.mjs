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
  assert.equal(texts.length, 3);
  assert.equal(texts[0], "Intro ");
  assert.equal(texts[1], "start A ... end A. Middle. ");
  assert.equal(texts[2], "Start B ... end B. Tail.");
});

test("wise chip includes source prefix before first boundary marker", async () => {
  forget();

  const source = "Lead in text. ## Section A\\nBody A\\n## Section B\\nBody B\\n";
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob ve text "## Section A" "## Section B" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, ["Lead in text. ", "## Section A\nBody A\n", "## Section B\nBody B\n"]);
});

test("wise chip drops preface before first question boundary marker", async () => {
  forget();

  const source = [
    "Opening invocation.",
    "",
    "#### M",
    "How can we serve?",
    "",
    "#### Q'uo",
    "Serve with love.",
    "",
    "#### P",
    "How can we balance wisdom?",
    "",
    "#### Q'uo",
    "Balance heart and light."
  ].join("\\n");
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob ve text "#### M" "#### P" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, [
    "#### M\nHow can we serve?\n\n#### Q'uo\nServe with love.\n\n",
    "#### P\nHow can we balance wisdom?\n\n#### Q'uo\nBalance heart and light."
  ]);
});

test("wise chip output is reversible by stitching chips in order", async () => {
  forget();

  const source = [
    "Preface paragraph.",
    "## Section One",
    "Alpha line.",
    "## Section Two",
    "Beta line.",
    "## Section Three",
    "Gamma line."
  ].join("\\n");
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob ve text "## Section One" "## Section Two" "## Section Three" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals atmost byte 24 to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.ok(texts.length > 3);
  const stitched = texts.join("");
  assert.equal(stitched, source.replace(/\\n/gu, "\n"));
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
  assert.deepEqual(texts, ["## One\nA\n", "## Two\nB\n"]);
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
  assert.deepEqual(texts, ["## Start\nA\n## End\nB\n"]);
});

test("wise chip honors atmost byte by splitting large slices", async () => {
  forget();

  const source = "AAAAA BBBBB CCCCC DDDDD EEEEE FFFFF GGGGG";
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob text "AAAAA" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals atmost byte 12 to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.ok(texts.length > 1);
  for (const text of texts) {
    assert.ok(Buffer.byteLength(text, "utf8") <= 12);
  }
});

test("wise chip honors atleast byte by merging small slices", async () => {
  forget();

  const source = "AA..BB..CC..DD";
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);

  await run("su name boundary proposals be series def");
  await run('su name proposal 1 from num 1 ob ve text "AA" "BB" "CC" "DD" be boundary ya');
  await run("prah");

  await run("from name text source by name boundary proposals atleast byte 6 to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.ok(texts.length < 4);
  for (let i = 0; i < texts.length - 1; i += 1) {
    assert.ok(Buffer.byteLength(texts[i], "utf8") >= 6);
  }
});

test("wise chip accepts newline text boundary proposals", async () => {
  forget();

  const source = "#### J\n\nquestion\n\n#### Q’uo\n\nanswer\n\n#### N\n\nnext question\n\n#### Q’uo\n\nnext answer";
  await run(`exists su name source ob text ${JSON.stringify(source)} be text ya`);
  await run(`exists su name boundary proposals ob text ${JSON.stringify("#### J\n#### N")} be text ya`);

  await run("from name text source by name text boundary proposals to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const texts = (series.ob?.series ?? []).map(entry => entry?.ob?.text ?? "");
  assert.deepEqual(texts, [
    "#### J\n\nquestion\n\n#### Q’uo\n\nanswer\n\n",
    "#### N\n\nnext question\n\n#### Q’uo\n\nnext answer"
  ]);
});

test("wise chip groups timed series by atleast minute and atmost minute", async () => {
  forget();

  await run("su name transcript cuts be series def");
  await run('su name cut 001 since num 0 until num 40 ob text "intro section" ya');
  await run('su name cut 002 since num 41 until num 85 ob text "first argument" ya');
  await run('su name cut 003 since num 90 until num 130 ob text "second argument" ya');
  await run('su name cut 004 since num 260 until num 320 ob text "late section after big pause" ya');
  await run("prah");

  await run("from name series transcript cuts atleast minute 2 atmost minute 10 to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const entries = series.ob?.series ?? [];
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.since?.num, 0);
  assert.equal(entries[0]?.until?.num, 130);
  assert.match(entries[0]?.ob?.text ?? "", /intro section first argument second argument/u);
  assert.equal(entries[1]?.since?.num, 260);
  assert.equal(entries[1]?.until?.num, 320);
});

test("wise chip forces timed split by atmost minute when no pause appears", async () => {
  forget();

  await run("su name transcript cuts be series def");
  await run('su name cut 001 since num 0 until num 100 ob text "part one" ya');
  await run('su name cut 002 since num 101 until num 220 ob text "part two" ya');
  await run('su name cut 003 since num 221 until num 360 ob text "part three" ya');
  await run("prah");

  await run("from name series transcript cuts atleast second 90 atmost minute 3 to name text wise chips be wise chip do");

  const series = remember("wise chips");
  assert.ok(series);
  const entries = series.ob?.series ?? [];
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    const duration = Number(entry?.until?.num ?? 0) - Number(entry?.since?.num ?? 0);
    assert.ok(duration <= 180.0001);
  }
});
