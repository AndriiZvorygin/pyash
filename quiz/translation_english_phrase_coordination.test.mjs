import assert from "node:assert/strict";
import test from "node:test";

import {
  findSharedPhraseHead,
  segmentEnglishPhraseList
} from "../program/verbs/exchange/translation/english_phrase_coordination.mjs";

function word(surface, sequence, { grammar = null, lemma = surface, sourceLemma = lemma } = {}) {
  return { surface, lemma, sourceLemma, pyashSequence: sequence, grammar };
}

function conjunction(surface, pya = "ba") {
  return word(surface, [pya], { grammar: { kind: "conjunction", position: "link" } });
}

function caseWord(surface, pya = "ma") {
  return word(surface, [pya], { grammar: { kind: "case-marker", position: "link" } });
}

test("phrase-list segmentation handles comma, Oxford, and unpunctuated conjunctions", () => {
  const commaSource = "alpha, beta, or gamma";
  const commaRecords = [word("alpha", ["a"]), word("beta", ["b"]), conjunction("or"), word("gamma", ["c"] )];
  const comma = segmentEnglishPhraseList({
    source: commaSource,
    records: commaRecords,
    startIndex: 0,
    endIndex: 4,
    role: "ob",
    scope: "object"
  });
  assert.equal(comma.role, "ob");
  assert.deepEqual(comma.items.map((item) => item.surface), ["alpha", "beta", "gamma"]);
  assert.deepEqual(comma.items.at(-1).connector, { surface: "or", pyashSequence: ["ba"] });

  const oxfordSource = "alpha, beta, and gamma";
  const oxford = segmentEnglishPhraseList({
    source: oxfordSource,
    records: [word("alpha", ["a"]), word("beta", ["b"]), conjunction("and", "wa"), word("gamma", ["c"])],
    startIndex: 0,
    endIndex: 4
  });
  assert.deepEqual(oxford.items.map((item) => item.surface), ["alpha", "beta", "gamma"]);
  assert.deepEqual(oxford.items.at(-1).connector, { surface: "and", pyashSequence: ["wa"] });

  const simpleSource = "alpha or beta";
  const simple = segmentEnglishPhraseList({
    source: simpleSource,
    records: [word("alpha", ["a"]), conjunction("or"), word("beta", ["b"])],
    startIndex: 0,
    endIndex: 3
  });
  assert.deepEqual(simple.items.map((item) => item.surface), ["alpha", "beta"]);
});

test("parenthetical and item-internal conjunctions remain within their list member", () => {
  const source = "friend (such as platonic love), or an object or idea";
  const records = [
    word("friend", ["friend"]), word("such", ["example"]), word("as", []),
    word("platonic", ["platonic"]), word("love", ["love"]), conjunction("or"),
    word("an", ["indefinite"]), word("object", ["object"]), conjunction("or"), word("idea", ["idea"])
  ];
  const list = segmentEnglishPhraseList({
    source,
    records,
    startIndex: 0,
    endIndex: records.length,
    role: "su"
  });
  assert.deepEqual(list.items.map((item) => item.surface), [
    "friend (such as platonic love)",
    "an object or idea"
  ]);
  assert.deepEqual(list.items.at(-1).internalConnectors.map(({ surface }) => surface), ["or"]);
});

test("shared head factors repeated nominal heads and case-led ellipsis generically", () => {
  const source = "self-love, love toward a friend, love in romance, toward family";
  const records = [
    word("self-love", ["love", "reflexive"], { lemma: "self-love" }),
    word("love", ["love"]), caseWord("toward"), word("a", ["indefinite"]), word("friend", ["friend"]),
    word("love", ["love"]), caseWord("in", "lwah"), word("romance", ["romance"]),
    caseWord("toward"), word("family", ["family"])
  ];
  const list = segmentEnglishPhraseList({
    source,
    records,
    startIndex: 0,
    endIndex: records.length,
    role: "su",
    scope: "existential-content"
  });
  const factored = findSharedPhraseHead(list, records);
  assert.equal(factored.head.lemma, "love");
  assert.deepEqual(factored.explicitItemIndexes, [1, 2]);
  assert.deepEqual(factored.reflexiveItemIndexes, [0]);
  assert.deepEqual(factored.inheritedItemIndexes, [3]);
  assert.equal(factored.placement, "after-list");
});

test("shared-head factoring does not depend on the love vocabulary", () => {
  const source = "respect in art, respect in work, in life";
  const records = [
    word("respect", ["respect"], { lemma: "respect" }),
    caseWord("in", "lwah"), word("art", ["art"]),
    word("respect", ["respect"], { lemma: "respect" }),
    caseWord("in", "lwah"), word("work", ["work"]),
    caseWord("in", "lwah"), word("life", ["life"])
  ];
  const list = segmentEnglishPhraseList({ source, records, startIndex: 0, endIndex: records.length });
  const factored = findSharedPhraseHead(list, records);
  assert.equal(factored.head.lemma, "respect");
  assert.deepEqual(factored.explicitItemIndexes, [0, 1]);
  assert.deepEqual(factored.inheritedItemIndexes, [2]);
});

test("shared-head factoring distinguishes source words with the same Pyash sequence", () => {
  const source = "love toward a friend, love in romance, or toward an object or idea";
  const records = [
    word("love", ["pyan"]), caseWord("toward"), word("a", ["tlih"], { grammar: { kind: "number-marker" } }), word("friend", ["pyat"]),
    word("love", ["pyan"]), caseWord("in", "lwah"), word("romance", ["hram"]),
    conjunction("or"), caseWord("toward"), word("an", ["tlih"], { grammar: { kind: "number-marker" } }),
    word("object", ["pyan"], { lemma: "love", sourceLemma: "object" }),
    conjunction("or"), word("idea", ["tli"])
  ];
  const list = segmentEnglishPhraseList({ source, records, startIndex: 0, endIndex: records.length });
  const factored = findSharedPhraseHead(list, records);

  assert.deepEqual(factored.explicitItemIndexes, [0, 1]);
  assert.deepEqual(factored.inheritedItemIndexes, [2]);
  assert.equal(factored.itemHeadIndexes[2], undefined);
});

test("shared-head factoring declines unrelated lists and lists without omitted case phrases", () => {
  const source = "alpha, beta, gamma";
  const records = [word("alpha", ["x"]), word("beta", ["x"]), word("gamma", ["y"])];
  const list = segmentEnglishPhraseList({ source, records, startIndex: 0, endIndex: 3, role: "ob" });
  assert.equal(findSharedPhraseHead(list, records), null);
});
