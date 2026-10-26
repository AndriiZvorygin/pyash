import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnglishWordNetBridgeIndex,
  loadEnglishWordNetBridges,
  parseEnglishWordNetBridgeCatalog
} from "../program/verbs/exchange/translation/english_wordnet_bridges.mjs";
import { buildEnglishWordNetSenseBridgeIndex } from "../program/verbs/exchange/translation/english_wordnet_linker.mjs";
import {
  analyzeDefaultEnglishSentence,
  analyzeEnglishSentence
} from "../program/verbs/exchange/translation/english_sentence.mjs";
import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";

test("WordNet bridges use one native Pyash row per sense", async () => {
  const catalog = await loadEnglishWordNetBridges();
  assert.equal(catalog.entries.length, 17);
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "v:01775456-v"), {
    source: "v:01775456-v",
    target: "emotionally",
    targetPartOfSpeech: "v",
    certainty: "contextual",
    evidence: "Open English WordNet 2025 emotional-state sense"
  });
});

test("feel contexts select the bridge for the matching WordNet sense", async () => {
  const cases = [
    ["a feel for sexual pleasure", "feel", "touch", "tcum"],
    ["the feel of touch", "feel", "touch", "tcum"],
    ["a feel for animals", "feel", "awareness", "hyes"],
    ["the feel of the city", "feel", "air", "cwat"],
    ["I feel tired", "feel", "experience", "tyap"],
    ["I feel small", "feel", "emotionally", "xyek"],
    ["I feel he believes me", "feel", "believe", "kcan"],
    ["I feel the soft cloth", "feel", "finger", "hjit"],
    ["He felt the girl in the movie theater", "felt", "touch", "tcum"],
    ["I feel my pulse", "feel", "touch", "tcum"],
    ["I feel resentful", "feel", "emotionally", "xyek"],
    ["I feel the wind", "feel", "touch", "tcum"],
    ["I feel the effects of inflation", "feel", "experience", "tyap"],
    ["I feel for my wallet", "feel", "searching", "tsoc"],
    ["It feels nice to be home", "feels", "appear", "tcuc"],
    ["He felt his way around the dark room", "felt", "searching", "tsoc"],
    ["The ground feels shaky", "feels", "appear", "tcuc"]
  ];
  for (const [source, surface, lemma, pya] of cases) {
    const result = await analyzeDefaultEnglishSentence(source);
    const token = result.tokens.find((candidate) => candidate.surface === surface);
    assert.equal(token?.coverageType, "semantic-wordnet", source);
    assert.equal(token?.lemma, lemma, source);
    assert.deepEqual(token?.pyashSequence, [pya], source);
    assert.match(token?.evidence ?? "", /sentence context matched/u, source);
  }
});

test("WordNet bridge parser rejects duplicate sense rows and JSON-shaped rows", () => {
  const row = "su text \"v:example-v\" ob name emotionally as text \"v\" with text \"contextual\" via text \"catalog\" ya";
  const source = [
    "su name translation_english_wordnet_bridges be map def",
    "su text \"format\" ob text \"english-wordnet-bridge-v1\" ya",
    "su text \"source\" ob text \"fixture\" ya",
    row,
    row,
    "prah"
  ].join("\n");
  assert.throws(
    () => parseEnglishWordNetBridgeCatalog(source),
    (error) => error.code === "invalid-english-wordnet-bridge"
  );
  assert.throws(
    () => parseEnglishWordNetBridgeCatalog([
      "su name translation_english_wordnet_bridges be map def",
      "su text \"format\" ob text \"english-wordnet-bridge-v1\" ya",
      "su text \"source\" ob text \"fixture\" ya",
      "su text \"v:example-v\" ob text \"{\\\"target\\\":\\\"emotionally\\\"}\" ya",
      "prah"
    ].join("\n")),
    (error) => error.code === "invalid-english-wordnet-bridge"
  );
});

test("a sense bridge contributes a bounded existing-vocabulary candidate", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [{
      id: "v:example-v:florp",
      pos: "v",
      synset: "example-v",
      senseKey: "example-v",
      lemma: "florp",
      gloss: "undergo an emotional sensation"
    }],
    bridges: [{
      source: "v:example-v",
      target: "emotionally",
      targetPartOfSpeech: "v",
      certainty: "contextual",
      evidence: "fixture sense bridge"
    }]
  });
  const result = analyzeEnglishSentence("I florp", {
    wordnetIndex: wordnet,
    resolveWord: (word) => word === "i"
      ? { coverageType: "grammar", pyashSequence: ["mi"] }
      : word === "emotionally"
        ? { coverageType: "atomic", pyashSequence: ["xyek"] }
        : null
  });
  const token = result.tokens.find((candidate) => candidate.surface === "florp");
  assert.equal(token.coverageType, "semantic-wordnet");
  assert.deepEqual(token.pyashSequence, ["xyek"]);
  assert.match(token.evidence, /bridge emotionally/u);
});

test("a reconciled Qwen sense link can be fed back as a dynamic bridge", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [{
      id: "v:dynamic-v:florp",
      pos: "v",
      synset: "dynamic-v",
      senseKey: "dynamic-v",
      lemma: "florp",
      gloss: "express an emotional state"
    }]
  });
  const bridges = buildEnglishWordNetSenseBridgeIndex([{
    id: "english-wordnet-sense-dynamic",
    source: "v:dynamic-v",
    pos: "v",
    synset: "dynamic-v",
    status: "accepted-llm",
    link: {
      target: "emotionally",
      pyashSequence: ["xyek"],
      targetPartOfSpeech: "v",
      certainty: "contextual",
      evidence: "fixture Qwen decision"
    }
  }]);
  const result = analyzeEnglishSentence("I florp", {
    wordnetIndex: wordnet,
    wordnetBridges: bridges,
    resolveWord: (word) => word === "i"
      ? { coverageType: "grammar", pyashSequence: ["mi"] }
      : word === "emotionally"
        ? { coverageType: "atomic", pyashSequence: ["xyek"] }
        : null
  });
  const token = result.tokens.find((candidate) => candidate.surface === "florp");
  assert.equal(token.coverageType, "semantic-wordnet");
  assert.equal(token.lemma, "emotionally");
  assert.deepEqual(token.pyashSequence, ["xyek"]);
  assert.match(token.evidence, /fixture Qwen decision/u);
});

test("an accepted Qwen sense wins over the deterministic alternatives for that surface", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [
      {
        id: "v:dynamic-like:florp",
        pos: "v",
        synset: "dynamic-like",
        senseKey: "dynamic-like",
        lemma: "florp",
        gloss: "like something"
      },
      {
        id: "v:dynamic-dislike:florp",
        pos: "v",
        synset: "dynamic-dislike",
        senseKey: "dynamic-dislike",
        lemma: "florp",
        gloss: "dislike something"
      }
    ]
  });
  const bridges = buildEnglishWordNetSenseBridgeIndex([{
    id: "english-wordnet-sense-dynamic-dislike",
    pos: "v",
    synset: "dynamic-dislike",
    status: "accepted-llm",
    link: {
      target: "dislike",
      pyashSequence: ["twin"],
      targetPartOfSpeech: "v",
      certainty: "contextual",
      evidence: "fixture Qwen decision for the selected sense"
    }
  }]);
  const result = analyzeEnglishSentence("I florp", {
    wordnetIndex: wordnet,
    wordnetBridges: bridges,
    resolveWord: (word) => word === "i"
      ? { coverageType: "grammar", pyashSequence: ["mi"] }
      : word === "like"
        ? { coverageType: "atomic", pyashSequence: ["pyan"] }
        : word === "dislike"
          ? { coverageType: "atomic", pyashSequence: ["twin"] }
          : null
  });
  const token = result.tokens.find((candidate) => candidate.surface === "florp");
  assert.equal(token.coverageType, "semantic-wordnet");
  assert.equal(token.lemma, "dislike");
  assert.deepEqual(token.pyashSequence, ["twin"]);
  assert.match(token.evidence, /fixture Qwen decision for the selected sense/u);
});

test("bridge index preserves one entry for each source sense", () => {
  const index = buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "v:example-v",
      target: "emotionally",
      targetPartOfSpeech: "v",
      certainty: "contextual",
      evidence: "fixture"
    }]
  });
  assert.equal(index.lookup("V:EXAMPLE-V").target, "emotionally");
  assert.equal(index.entries.length, 1);
});
