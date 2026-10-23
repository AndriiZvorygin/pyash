import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import { buildProgram } from "../program/program.mjs";
import {
  HKESTLAT_COMPOUND_ANALYSIS_FORMAT,
  WORLD_ENGLISH_BIBLE_MATTHEW_6_9_13,
  analyzeHkestlatCompounds,
  buildLordPrayerAnalysis,
  renderLordPrayerAnalysisPya
} from "../program/verbs/exchange/translation/hkestlat_compound_analysis.mjs";

function dictionaryRows() {
  return [
    { en: "heaven", zh: "天堂", pya: "cyak" },
    { en: "heavens", zh: "天堂", pya: "cyak" },
    { en: "kingdom", zh: "王国" },
    { en: "kingdom", zh: "王国", pya: "left" },
    { en: "kingdom", zh: "王国", pya: "right" },
    { en: "month", zh: "月", pya: "mwas" },
    { en: "plus", zh: "加", pya: "plus" },
    { en: "may", zh: "五月", pya: "hmef" },
    { en: "father", zh: "父亲" },
    { en: "bread", zh: "面包", pya: "hpup" },
    { en: "temptation", zh: "诱惑", pya: "hyoc" },
    { en: "evil", zh: "邪恶", pya: "cwak" },
    { en: "glory", zh: "荣耀", pya: "nyam" }
  ];
}

function stemRows() {
  return [
    ["cyak", "天堂", 2, "paradise: day. hall.", ""],
    [null, "王国", 2, "kingdom: king. country.", ""],
    ["hmef", "五月", 2, "month-of-may: moon.", "mwas plus."],
    ["hmef", "五月", 2, "month-of-may: moon.", "mwas plus."],
    ["source-only", "甲", 1, "source-only target", ""]
  ];
}

test("hkestlat analysis is stable across source order and retains ambiguity", () => {
  const options = {
    dictionaryRows: dictionaryRows(),
    stemRows: stemRows(),
    sourceHashes: {
      "hkestlat/mwonkwon.json": "dictionary-hash",
      "hkestlat/chinese_dictionary_stems.json": "stem-hash"
    }
  };
  const first = analyzeHkestlatCompounds(options);
  const second = analyzeHkestlatCompounds({
    ...options,
    dictionaryRows: [...options.dictionaryRows].reverse(),
    stemRows: [...options.stemRows].reverse()
  });

  assert.deepEqual(first, second);
  assert.equal(first.format, HKESTLAT_COMPOUND_ANALYSIS_FORMAT);
  assert.equal(first.statusCounts.mapped, 1);
  assert.equal(first.statusCounts["mapped-compound"], 1);
  assert.equal(first.statusCounts["source-target-only"], 1);
  assert.equal(first.statusCounts["ambiguous-target"], 1);

  const may = first.records.find((record) => record.surface === "五月");
  assert.equal(may.status, "mapped-compound");
  assert.equal(may.targetPyash, "hmef");
  assert.deepEqual(may.componentPyash, ["mwas", "plus"]);
  assert.equal(may.sourceOccurrences, 2);

  const kingdom = first.records.find((record) => record.surface === "王国");
  assert.equal(kingdom.status, "ambiguous-target");
  assert.deepEqual(kingdom.targetEnglish, ["kingdom"]);
  assert.equal(kingdom.targetPyash, null);
});

test("hkestlat analysis reports malformed source rows with stable error codes", () => {
  assert.throws(
    () => analyzeHkestlatCompounds({ dictionaryRows: [{}], stemRows: [[null, "", 1, "", ""]] }),
    (error) => error.code === "invalid-stem-row"
  );
  assert.throws(
    () => analyzeHkestlatCompounds({ dictionaryRows: ["bad"], stemRows: [] }),
    (error) => error.code === "invalid-dictionary-row"
  );

  const mismatch = analyzeHkestlatCompounds({
    dictionaryRows: [{ en: "word", zh: "甲", pya: "word" }],
    stemRows: [["word", "甲", 2, "bad source length", ""]]
  });
  assert.equal(mismatch.records[0].status, "source-shape-mismatch");
});

test("Lord's Prayer analysis keeps the source clauses and explicit vocabulary gaps", () => {
  const analysis = buildLordPrayerAnalysis({
    dictionaryRows: dictionaryRows(),
    stemRows: stemRows(),
    sourceHashes: { "hkestlat/mwonkwon.json": "dictionary-hash" }
  });

  assert.equal(analysis.sourceEdition, "World English Bible");
  assert.equal(analysis.sourceReference, "Matthew 6:9-13");
  assert.deepEqual(analysis.clauses, WORLD_ENGLISH_BIBLE_MATTHEW_6_9_13);
  assert.equal(analysis.terms.length, 20);
  assert.equal(analysis.terms.find((term) => term.term === "heaven").status, "mapped");
  assert.equal(analysis.terms.find((term) => term.term === "bread").status, "mapped");
  assert.equal(analysis.terms.find((term) => term.term === "father").status, "unresolved");
  assert.equal(analysis.terms.find((term) => term.term === "kingdom").status, "ambiguous-target");
});

test("Lord's Prayer analysis renders as a parser-readable Pyash map", () => {
  const analysis = buildLordPrayerAnalysis({
    dictionaryRows: dictionaryRows(),
    stemRows: stemRows()
  });
  const source = renderLordPrayerAnalysisPya(analysis);
  const program = buildProgram(source);
  const header = program.sentences.find((sentence) => sentence?.mood === "def");
  const father = program.sentences.find((sentence) => sentence?.su?.text === "term:father");
  const clause = program.sentences.find((sentence) => sentence?.su?.text === "clause:Matthew 6:9");

  assert.equal(header.su.name, "translation_compound_analysis_lord_prayer");
  assert.ok(father);
  assert.equal(JSON.parse(father.ob.text).status, "unresolved");
  assert.equal(clause.ob.text, WORLD_ENGLISH_BIBLE_MATTHEW_6_9_13[0].text);
});

test("committed Lord's Prayer analysis preserves source hashes and mapped gaps", async () => {
  const source = await fs.readFile(
    new URL("../examples/pyash/lord-prayer-compound-analysis.pya", import.meta.url),
    "utf8"
  );
  const program = buildProgram(source);
  const rows = program.sentences.filter((sentence) => sentence?.mood === "ya");
  const heaven = rows.find((sentence) => sentence?.su?.text === "term:heaven");
  const father = rows.find((sentence) => sentence?.su?.text === "term:father");

  assert.ok(program.sentences.some((sentence) => sentence?.ob?.text === "Matthew 6:9-13"));
  assert.ok(program.sentences.some((sentence) => sentence?.su?.name === "hkestlat_mwonkwon_json"));
  assert.equal(rows.filter((sentence) => sentence?.su?.text?.startsWith("clause:")).length, 5);
  assert.equal(JSON.parse(heaven.ob.text).directTargets[0], "cyak");
  assert.equal(JSON.parse(father.ob.text).status, "unresolved");
});

test("Lord's Prayer source manifest separates canonical, critical, and YLT layers", async () => {
  const source = await fs.readFile(
    new URL("../program/verbs/exchange/translation/lord_prayer_sources.pya", import.meta.url),
    "utf8"
  );
  const program = buildProgram(source);
  const facts = new Map(
    program.sentences
      .filter((sentence) => sentence?.mood === "ya" && typeof sentence.su?.text === "string")
      .map((sentence) => [sentence.su.text, sentence.ob?.text ?? ""])
  );
  assert.equal(facts.get("format"), "lord-prayer-source-v1");
  assert.equal(facts.get("reference"), "Matthew 6:9-13");
  assert.equal(facts.get("canonical-text"), "Nestle-Aland 28 (NA28)");
  assert.equal(facts.get("critical-companion"), "SBL Greek New Testament (SBLGNT)");
  assert.equal(facts.get("ylt-source"), "Received Text (Textus Receptus tradition)");
  assert.match(facts.get("variant-policy"), /never merge readings silently/u);
});
