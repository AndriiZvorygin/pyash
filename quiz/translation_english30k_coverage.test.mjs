import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { runVocabSuggest } from "../command/vocab_suggest.mjs";
import {
  ENGLISH30K_DEFAULT_PATH,
  buildEnglish30kCompoundCoverage,
  buildEnglish30kCoverage,
  loadEnglish30k,
  lookupEnglish30kCoverage,
  parseEnglish30kText,
  renderEnglish30kCoveragePya,
  summarizeEnglish30kCoverage
} from "../program/verbs/exchange/translation/english30k_coverage.mjs";

test("English30k parser preserves rank, score, and missing source ranks", () => {
  const source = parseEnglish30kText([
    "1\tthe\t100",
    "2   blue-print   80.5",
    "4\tGutenberg\t12"
  ].join("\n"), { cutoff: 4 });
  assert.equal(source.rows.length, 3);
  assert.deepEqual(source.missingRanks, [3]);
  assert.deepEqual(source.rows[1], {
    rank: 2,
    word: "blue-print",
    normalizedWord: "blue-print",
    score: 80.5
  });
  assert.throws(
    () => parseEnglish30kText("1\tbroken", { cutoff: 1 }),
    (error) => error.code === "invalid-english30k-coverage"
  );
});

test("English30k coverage classifies atoms, aliases, grammar, and compounds", () => {
  const source = parseEnglish30kText([
    "1\tblue-print\t100",
    "2\trunning\t90",
    "3\tto\t80",
    "4\tblue\t70",
    "5\tunknown\t60"
  ].join("\n"), { cutoff: 5 });
  const coverage = buildEnglish30kCoverage({
    source,
    atomicEntries: [
      { en: "blue", pya: "plun", hnuc: "0x0001" },
      { en: "run", pya: "hkin", hnuc: "0x0002" }
    ],
    aliases: new Map([["running", "run"]]),
    grammarMappings: new Map([["to", ["htac"]]]),
    compoundRecords: [{
      target: "blue-print",
      componentGlosses: ["blue", "print"],
      pyashSequence: ["plun", "trat"],
      status: "accepted-curated",
      provenance: "fixture"
    }]
  });
  assert.deepEqual(coverage.counts, {
    atomic: 1,
    alias: 1,
    grammar: 1,
    compound: 1,
    unresolved: 1
  });
  assert.equal(lookupEnglish30kCoverage(coverage.records, "blue_print").coverageType, "compound");
  assert.equal(coverage.records.find((record) => record.word === "unknown").status, "unresolved");
  assert.match(renderEnglish30kCoveragePya(coverage), /english30k-coverage-v1/u);
  assert.equal(summarizeEnglish30kCoverage(coverage).targetRows, 5);
});

test("repository English30k source is ranked and measurable", async (t) => {
  let source;
  try {
    source = await loadEnglish30k();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip(`source unavailable: ${ENGLISH30K_DEFAULT_PATH}`);
      return;
    }
    throw error;
  }
  assert.equal(source.rows.length, 29999);
  assert.deepEqual(source.missingRanks, [6897]);
  assert.equal(source.rows[0].rank, 1);
  assert.equal(source.rows[0].word, "the");
  assert.equal(source.rows.at(-1).rank, 30000);
  const coverage = buildEnglish30kCoverage({ source, atomicEntries: pyashWords });
  assert.ok(coverage.counts.atomic > 5000);
  assert.ok(coverage.unresolved.length > 20000);
  assert.equal(lookupEnglish30kCoverage(coverage.records, "the").rank, 1);
});

test("English30k compound generation feeds accepted and uncertain records separately", async (t) => {
  let source;
  try {
    source = await loadEnglish30k();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip(`source unavailable: ${ENGLISH30K_DEFAULT_PATH}`);
      return;
    }
    throw error;
  }
  const generated = await buildEnglish30kCompoundCoverage({
    source,
    atomicEntries: pyashWords
  });
  assert.ok(generated.records.length > 0);
  assert.ok(generated.accepted.length > 0);
  assert.ok(generated.candidates.length > 0);
  assert.equal(generated.records.every((record) => Array.isArray(record.pyashSequence)), true);
  assert.equal(generated.records.every((record) => record.status !== "accepted-llm"), true);
});

test("vocab_suggest reports ranked unresolved coverage without losing existing compounds", async () => {
  const compoundLines = [];
  const compoundResult = await runVocabSuggest(["blueprint"], {
    report: (line) => compoundLines.push(String(line))
  });
  assert.equal(compoundResult.exitCode, 0);
  assert.match(compoundLines.join("\n"), /blueprint: found compound blue \+ print -> plun trat/u);

  const unresolvedLines = [];
  const unresolvedResult = await runVocabSuggest(["the"], {
    report: (line) => unresolvedLines.push(String(line))
  });
  assert.equal(unresolvedResult.exitCode, 1);
  assert.match(unresolvedLines.join("\n"), /the: .*English30k rank 1 remains unresolved/u);
});

test("durable English30k manifest records the source contract", async () => {
  const manifest = await fs.readFile(
    new URL("../program/verbs/exchange/translation/english30k_coverage.pya", import.meta.url),
    "utf8"
  );
  assert.match(manifest, /english30k-coverage-v1/u);
  assert.match(manifest, /source-hash/u);
  assert.match(manifest, /cutoff.*30000/u);
  assert.match(manifest, /missing-rank.*6897/u);
});
