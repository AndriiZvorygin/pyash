import test from "node:test";
import assert from "node:assert/strict";

import { buildAcceptedReferenceSource } from "../program/library/dictionary/build_reference_source.mjs";

const atoms = [
  { en: "question", pya: "hwas" },
  { en: "asking", pya: "hpun" }
];
const bridgeCatalog = {
  entries: [{
    source: "n:07208256-n",
    target: "question",
    targetPartOfSpeech: "n",
    gloss: "an instance of questioning",
    lemmas: ["query", "question"]
  }]
};
const compoundEntries = [{ target: "question", pyashSequence: ["hpun", "hwas"] }];
const acceptedQueryReview = {
  senseId: "n:07208256-n",
  target: "question",
  coverageTarget: "question",
  targetPartOfSpeech: "n",
  pyashSequence: ["hwas"],
  reviewStatus: "accepted-curated"
};

function build(vocabularyReviews = []) {
  return buildAcceptedReferenceSource({
    atoms,
    bridgeCatalog,
    compoundEntries,
    vocabularyReviews,
    englishRows: [],
    wordNetFrequencyEntries: [],
    render: false
  });
}

test("ambiguous WordNet targets remain unlinked without an explicit vocabulary review", () => {
  const built = build();
  assert.equal(built.entries.some(({ sequence }) => sequence === "hwas"), true);
  assert.equal(built.entries.find(({ sequence }) => sequence === "hwas").sourceLinks.length, 0);
});

test("accepted sense review links only its exact WordNet sense to the reviewed atom", () => {
  const built = build([acceptedQueryReview]);
  const atom = built.entries.find(({ sequence }) => sequence === "hwas");
  assert.ok(atom, "the canonical question atom is present");
  assert.ok(atom.sourceLinks.some(({ identifier }) => identifier === "n:07208256-n"));
  assert.ok(atom.forms.some(({ surface }) => surface === "query"));
  assert.equal(built.entries.find(({ sequence }) => sequence === "hpun hwas").sourceLinks.length, 0);
});

test("accepted review cannot override a conflicting WordNet bridge target", () => {
  assert.throws(() => build([{ ...acceptedQueryReview, coverageTarget: "inquiry" }]), /conflicts with WordNet bridge/u);
});
