import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnglishWordNetBridgeIndex,
  loadEnglishWordNetBridges,
  parseEnglishWordNetBridgeCatalog
} from "../program/verbs/exchange/translation/english_wordnet_bridges.mjs";
import { analyzeEnglishSentence } from "../program/verbs/exchange/translation/english_sentence.mjs";
import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";

test("WordNet bridges use one native Pyash row per sense", async () => {
  const catalog = await loadEnglishWordNetBridges();
  assert.equal(catalog.entries.length, 1);
  assert.deepEqual(catalog.entries[0], {
    source: "v:01775456-v",
    target: "emotionally",
    targetPartOfSpeech: "v",
    certainty: "contextual",
    evidence: "Open English WordNet 2025 emotional-state sense"
  });
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
