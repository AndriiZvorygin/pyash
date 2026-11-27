import assert from "node:assert/strict";
import test from "node:test";

import { buildAcceptedReferenceSource } from "../program/library/dictionary/build_reference_source.mjs";

const atoms = [
  { en: "question", pya: "hwas" },
  { en: "asking", pya: "hpun" }
];
const compoundEntries = [{ target: "question", pyashSequence: ["hpun", "hwas"] }];

function build({ bridgeEntries = [], compoundGlosses = [], render = false } = {}) {
  return buildAcceptedReferenceSource({
    atoms,
    bridgeCatalog: { entries: bridgeEntries },
    compoundEntries,
    compoundGlosses,
    render
  });
}

test("every unplaceable bridge sense is counted, with a reason and an example", () => {
  const built = build({
    bridgeEntries: [
      { source: "n:00000001-n", target: "question", gloss: "a question" },
      { source: "n:00000002-n", target: "unknown target", gloss: "an unknown target" },
      { source: "not-a-sense", target: "asking", gloss: "an invalid sense" }
    ],
    compoundGlosses: [
      {
        senseId: "not-a-sense",
        target: "question",
        pyashSequence: ["hwas"],
        definition: "a malformed compound sense"
      },
      {
        senseId: "n:00000003-n",
        target: "question",
        pyashSequence: ["hpun", "hwas"],
        definition: ""
      }
    ]
  });
  const { droppedSenseRows, droppedSenseExamples } = built.summary;
  const reasons = ["ambiguousTarget", "absentTarget", "malformedSense",
    "compoundNoSequence", "compoundNoDefinition"];

  assert.deepEqual(droppedSenseRows, Object.fromEntries(reasons.map((reason) => [reason, 1])));
  assert.deepEqual(Object.keys(droppedSenseExamples).sort(), [...reasons].sort());
  for (const reason of reasons) {
    assert.ok(droppedSenseExamples[reason].length > 0, `${reason} has a diagnostic example`);
  }
});

test("an ambiguous target is reported rather than resolved by guessing", () => {
  const senseId = "n:00000042-n";
  const built = build({
    bridgeEntries: [{ source: senseId, target: "question", gloss: "a question" }]
  });
  const examples = built.summary.droppedSenseExamples.ambiguousTarget ?? [];

  assert.equal(built.summary.droppedSenseRows.ambiguousTarget, 1);
  assert.ok(examples.length > 0, "ambiguous targets are sampled");
  const sample = examples[0];
  assert.equal(sample.target, "question");
  assert.deepEqual(new Set(sample.candidates), new Set(["hwas", "hpun hwas"]));
  assert.ok(built.entries.every((entry) =>
    entry.sourceLinks.every((link) => link.identifier !== senseId)),
  "the ambiguous sense is not linked to either candidate");
});

test("the build refuses to exceed its recorded drop ceiling", () => {
  const bridgeEntries = Array.from({ length: 4742 }, (_, index) => ({
    source: `n:${String(index).padStart(8, "0")}-n`,
    target: "question",
    gloss: "a question"
  }));

  assert.doesNotThrow(() => build({ bridgeEntries: bridgeEntries.slice(0, 4741), render: true }));
  assert.throws(() => build({ bridgeEntries, render: true }),
    /reference build now drops 4742 sense rows for ambiguousTarget/u);
});
