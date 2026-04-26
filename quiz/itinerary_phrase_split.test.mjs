import test from "node:test";
import assert from "node:assert/strict";

import { splitTextPhrases, cutFromTextToNameItinerary } from "../program/verbs/itinerary_media.mjs";
import { splitItineraryCutsIntoPhrases } from "../command/itinerary_split_phrases.mjs";

test("phrase splitter splits on commas", () => {
  const out = splitTextPhrases("Food prices rise, families adapt");
  assert.deepEqual(out, ["Food prices rise", "families adapt"]);
});

test("phrase splitter splits on periods", () => {
  const out = splitTextPhrases("Food prices rise. Local gardens help.");
  assert.deepEqual(out, ["Food prices rise", "Local gardens help"]);
});

test("phrase splitter splits on newlines", () => {
  const out = splitTextPhrases("Food prices rise\nfamilies adapt\nLocal gardens help");
  assert.deepEqual(out, ["Food prices rise", "families adapt", "Local gardens help"]);
});

test("phrase splitter handles mixed delimiters in order", () => {
  const out = splitTextPhrases("Food prices rise, families adapt.\nLocal gardens help");
  assert.deepEqual(out, ["Food prices rise", "families adapt", "Local gardens help"]);
});

test("phrase splitter drops empties from repeated delimiters", () => {
  const out = splitTextPhrases("Food prices rise,,...\n\n families adapt");
  assert.deepEqual(out, ["Food prices rise", "families adapt"]);
});

test("phrase splitter trims whitespace", () => {
  const out = splitTextPhrases("  Food prices rise  ,   families adapt   .   Local gardens help   ");
  assert.deepEqual(out, ["Food prices rise", "families adapt", "Local gardens help"]);
});

test("phrase units normalize capitalization and deterministic ids", () => {
  const out = splitItineraryCutsIntoPhrases([
    { since: 0, until: 6, obText: "food prices rise, families adapt" }
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "phrase-001");
  assert.equal(out[1].name, "phrase-002");
  assert.equal(out[0].obText, "Food prices rise");
  assert.equal(out[1].obText, "Families adapt");
});

test("phrase quality filter merges weak fragments", () => {
  const out = splitItineraryCutsIntoPhrases([
    { since: 0, until: 6, obText: "food prices rise, and, families adapt" }
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].obText, "Food prices rise and");
  assert.equal(out[1].obText, "Families adapt");
});

test("phrase clamp splits long phrases when max duration is set", () => {
  const out = splitItineraryCutsIntoPhrases([
    { since: 0, until: 12, obText: "food prices rise rapidly across regions" }
  ], { maxPhraseDurationSeconds: 4 });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((row) => row.name), ["phrase-001", "phrase-002", "phrase-003"]);
  assert.equal(out[0].since, 0);
  assert.equal(out[0].until, 4);
  assert.equal(out[2].until, 12);
});

test("cut as phrase creates phrase itinerary rows", async () => {
  const out = await cutFromTextToNameItinerary({
    mood: "do",
    be: "cut",
    from: { text: "Food prices rise, families adapt. Local gardens help." },
    as: { text: "phrase" },
    to: { name: "phrase itinerary", nameTypeWords: ["itinerary"] }
  });
  const series = Array.isArray(out?.ob?.series) ? out.ob.series : [];
  assert.equal(series.length, 3);
  assert.equal(series[0]?.ob?.text, "Food prices rise");
  assert.equal(series[1]?.ob?.text, "families adapt");
  assert.equal(series[2]?.ob?.text, "Local gardens help");
});
