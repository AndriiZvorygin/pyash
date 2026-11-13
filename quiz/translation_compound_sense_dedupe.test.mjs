import test from "node:test";
import assert from "node:assert/strict";

import {
  deduplicateCompoundSenseRecords,
  retireCompoundRecordsAboveMaximum
} from "../program/library/translation/compound_sense_dedupe.mjs";

test("compound sense dedupe keeps the shortest sequence and preserves target aliases", () => {
  const records = [
    {
      target: "natural law",
      senseId: "n:1",
      aliases: ["nature law"],
      pyashSequence: ["tyic", "hfaf"],
      verificationDecisionId: "short-decision",
      status: "accepted-llm"
    },
    {
      target: "law",
      senseId: "n:1",
      aliases: [],
      pyashSequence: ["tyic", "psip", "hfaf"],
      verificationDecisionId: "long-decision",
      status: "accepted-llm"
    }
  ];

  const result = deduplicateCompoundSenseRecords(records);

  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].pyashSequence, ["tyic", "hfaf"]);
  assert.deepEqual(result.records[0].aliases, ["nature law", "law"]);
  assert.deepEqual(result.records[0].verificationDecisionIds, ["short-decision"]);
  assert.equal(result.report.shorterSenseCount, 1);
  assert.equal(result.report.directTrimSenseCount, 1);
  assert.equal(result.report.removedRecordCount, 1);
  assert.deepEqual(result.removals[0].decisionIds, ["long-decision"]);
  assert.equal(records[1].aliases.length, 0);
});

test("compound sense dedupe breaks equal-length ties by the most primitive VLIW layers", () => {
  const records = [
    {
      target: "round dance",
      senseId: "n:2",
      aliases: [],
      pyashSequence: ["hyuc", "hdas"],
      componentLayers: [16, 16],
      status: "accepted-llm"
    },
    {
      target: "ring dance",
      senseId: "n:2",
      aliases: [],
      pyashSequence: ["clic", "hdas"],
      componentLayers: [19, 19],
      status: "accepted-llm"
    }
  ];

  const result = deduplicateCompoundSenseRecords(records);

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].target, "round dance");
  assert.deepEqual(result.records[0].pyashSequence, ["hyuc", "hdas"]);
  assert.deepEqual(result.records[0].aliases, ["ring dance"]);
  assert.equal(result.report.equalLengthTieSenseCount, 1);
});

test("compound sense dedupe leaves non-sense rows independent", () => {
  const row = {
    target: "cluster compress",
    aliases: [],
    pyashSequence: ["ksus", "hzip"],
    status: "accepted-curated"
  };

  const result = deduplicateCompoundSenseRecords([row, { ...row }]);

  assert.equal(result.records.length, 2);
  assert.equal(result.report.duplicateSenseCount, 0);
});

test("compound retirement releases overlength WordNet senses for replacement", () => {
  const twoPart = {
    target: "computer program",
    senseId: "n:1",
    pyashSequence: ["kyut", "hrom"]
  };
  const threePart = {
    target: "autism spectrum disorder",
    senseId: "n:2",
    pyashSequence: ["ht6s", "hwem", "drak"],
    componentLayers: [28, 19, 24],
    verificationDecisionId: "decision-2"
  };

  const result = retireCompoundRecordsAboveMaximum([twoPart, threePart], 2);

  assert.deepEqual(result.records, [twoPart]);
  assert.deepEqual(result.retirements, [{
    senseId: "n:2",
    target: "autism spectrum disorder",
    pyashSequence: ["ht6s", "hwem", "drak"],
    componentLayers: [28, 19, 24],
    decisionIds: ["decision-2"]
  }]);
  assert.equal(result.report.retiredRecordCount, 1);
  assert.equal(result.report.retiredSenseCount, 1);
});

