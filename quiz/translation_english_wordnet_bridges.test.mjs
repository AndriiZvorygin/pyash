import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnglishWordNetBridgeIndex,
  loadEnglishWordNetBridges,
  parseEnglishWordNetBridgeCatalog
} from "../program/library/translation/english_wordnet_bridges.mjs";
import { buildEnglishWordNetSenseBridgeIndex } from "../program/library/translation/english_wordnet_linker.mjs";
import {
  analyzeDefaultEnglishSentence,
  analyzeEnglishSentence
} from "../program/library/translation/english_sentence.mjs";
import { buildEnglishGrammarIndex, loadEnglishGrammarCatalog } from "../program/library/translation/english_grammar.mjs";
import { buildEnglishWordNetIndex } from "../program/library/translation/english_wordnet.mjs";
import { decodePhraseVliw, lowerSentencePhraseVliw } from "../program/library/vliw/phrase.mjs";
import { renderEnglishFromVliw } from "../program/library/translation/pyac_to_english_pyash.mjs";

test("WordNet bridges use one native Pyash row per sense", async () => {
  const catalog = await loadEnglishWordNetBridges();
  assert.equal(catalog.entries.length, 19);
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "n:05818974-n"), {
    source: "n:05818974-n",
    target: "thing",
    targetPartOfSpeech: "n",
    certainty: "contextual",
    evidence: "Open English WordNet 2025 object-of-thought or feeling sense; generic Pyash thing anchor"
  });
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "v:01775456-v"), {
    source: "v:01775456-v",
    target: "emotionally",
    targetPartOfSpeech: "v",
    certainty: "contextual",
    evidence: "Open English WordNet 2025 emotional-state sense"
  });
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "v:00621282-v"), {
    source: "v:00621282-v",
    target: "identity-mix",
    targetPartOfSpeech: "v",
    certainty: "contextual",
    evidence: "Open English WordNet 2025 mistake-one-thing-for-another sense; Chinese 混同 treats distinct things as the same; Pyash compound identity-mix uses hdif mrat"
  });
});

test("the selected sense projects identity-mix beside mood and preserves its Pyac sequence", async () => {
  const bridges = buildEnglishWordNetSenseBridgeIndex([{
    id: "english-wordnet-sense-confuse-identity-mix",
    pos: "v",
    synset: "00621282-v",
    status: "accepted-llm",
    link: {
      target: "identity-mix",
      pyashSequence: ["hdif", "mrat"],
      targetPartOfSpeech: "v",
      certainty: "contextual",
      evidence: "Chinese 混同 describes treating distinct things as the same"
    }
  }]);
  const result = await analyzeDefaultEnglishSentence(
    "Often love can be confused with other feelings.",
    { wordnetBridges: bridges }
  );
  const token = result.tokens.find((candidate) => candidate.surface === "confused");
  assert.equal(token?.coverageType, "semantic-wordnet");
  assert.equal(token?.lemma, "identity mix");
  assert.deepEqual(token?.pyashSequence, ["hdif", "mrat"]);
  assert.deepEqual(result.verbPhrase.pyashSequence, ["hdif", "mrat", "pyoh", "ra2"]);
  assert.equal(result.verbPhrase.mood, "tseh");

  const lowered = lowerSentencePhraseVliw(result.sentence);
  assert.deepEqual(
    decodePhraseVliw(lowered.vectors).tokens.slice(-5).map((part) => part.pya),
    ["hdif", "mrat", "pyoh", "ra2", "tseh"]
  );
  assert.equal(
    renderEnglishFromVliw(lowered.vectors).englishPyash,
    "can often su love be identity-mix with other emotion."
  );
});

test("object of thought or feeling maps to the generic thing anchor", async () => {
  const grammar = await loadEnglishGrammarCatalog();
  const result = analyzeEnglishSentence("There can be love toward an object or idea.", {
    grammarIndex: buildEnglishGrammarIndex({ catalogEntries: grammar.entries }),
    wordnetIndex: buildEnglishWordNetIndex({
      rows: [{
        id: "n:05818974-n:object",
        pos: "n",
        synset: "05818974-n",
        senseKey: "05818974-n",
        lemma: "object",
        gloss: "the focus of cognitions or feelings; objects of thought; the object of my affection"
      }]
    }),
    wordnetBridges: buildEnglishWordNetBridgeIndex({
      entries: [{
        source: "n:05818974-n",
        target: "thing",
        targetPartOfSpeech: "n",
        certainty: "contextual",
        evidence: "generic Pyash thing anchor"
      }]
    }).bySense,
    resolveWord: (word) => ({
      love: { coverageType: "atomic", pyashSequence: ["pyan"] },
      thing: { coverageType: "grammar", pyashSequence: ["ya"] },
      idea: { coverageType: "atomic", pyashSequence: ["hcik"] }
    })[word] ?? null
  });
  const object = result.tokens.find((candidate) => candidate.surface === "object");
  const article = result.tokens.find((candidate) => candidate.surface === "an");
  assert.equal(object?.coverageType, "semantic-wordnet");
  assert.equal(object?.lemma, "thing");
  assert.deepEqual(object?.pyashSequence, ["ya"]);
  assert.deepEqual(article?.pyashSequence, ["tlih"]);
  assert.match(object?.evidence ?? "", /bridge thing/u);
});

test("feel contexts select unique bridges and retain collisions as unresolved", async () => {
  const cases = [
    ["a feel for animals", "feel", "awareness", "hyes"],
    ["the feel of the city", "feel", "air", "cwat"],
    ["I feel he believes me", "feel", "believe", "kcan"],
    ["I feel the soft cloth", "feel", "finger", "hjit"]
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

test("WordNet bridges with colliding non-equivalent targets remain unresolved", async () => {
  for (const source of [
    "a feel for sexual pleasure",
    "I feel tired",
    "I feel small",
    "I feel for my wallet",
    "It feels nice to be home"
  ]) {
    const result = await analyzeDefaultEnglishSentence(source);
    const token = result.tokens.find((candidate) => ["feel", "feels"].includes(candidate.surface));
    assert.notEqual(token?.coverageType, "semantic-wordnet", source);
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

test("bridge index withholds a shared target across senses without declared equivalence", () => {
  const index = buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "n:first",
      target: "touch",
      targetPartOfSpeech: "n",
      certainty: "contextual",
      evidence: "first sense"
    }, {
      source: "n:second",
      target: "touch",
      targetPartOfSpeech: "n",
      certainty: "contextual",
      evidence: "second sense"
    }]
  });
  assert.deepEqual(index.ambiguousTargets, ["touch"]);
  assert.equal(index.lookup("n:first"), null);
  assert.equal(index.lookup("n:second"), null);
  assert.equal(index.entries.length, 2);
});

test("bridge index also withholds different glosses that resolve to the same atom", () => {
  const index = buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "n:first",
      target: "touch",
      targetPartOfSpeech: "n",
      evidence: "first"
    }, {
      source: "n:second",
      target: "contact",
      targetPartOfSpeech: "n",
      evidence: "second"
    }],
    resolveTarget: () => ({ coverageType: "atomic", pyashSequence: ["tcum"] })
  });
  assert.equal(index.lookup("n:first"), null);
  assert.equal(index.lookup("n:second"), null);
  assert.deepEqual(index.ambiguousTargets, ["contact", "touch"]);
});

test("bridge index allows shared targets only inside a declared equivalence group", () => {
  const index = buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "n:first",
      target: "touch",
      targetPartOfSpeech: "n",
      certainty: "contextual",
      evidence: "first equivalent sense",
      equivalenceGroup: "same-touch",
      equivalenceEvidence: "the synset glosses name the same tactile contact"
    }, {
      source: "n:second",
      target: "touch",
      targetPartOfSpeech: "n",
      certainty: "contextual",
      evidence: "second equivalent sense",
      equivalenceGroup: "same-touch",
      equivalenceEvidence: "the synset glosses name the same tactile contact"
    }]
  });
  assert.equal(index.lookup("n:first").equivalenceGroup, "same-touch");
  assert.equal(index.lookup("n:first").equivalenceEvidence, "the synset glosses name the same tactile contact");
  assert.equal(index.lookup("n:second").equivalenceGroup, "same-touch");
  assert.deepEqual(index.ambiguousTargets, []);
});

test("equivalence evidence cannot merge different atom identities", () => {
  assert.throws(() => buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "n:first",
      target: "touch",
      pyashSequence: ["tcum"],
      targetKind: "atom",
      targetId: "atom:tcum",
      targetPartOfSpeech: "n",
      equivalenceGroup: "same-touch",
      equivalenceEvidence: "same tactile meaning"
    }, {
      source: "n:second",
      target: "touch",
      pyashSequence: ["hjit"],
      targetKind: "atom",
      targetId: "atom:hjit",
      targetPartOfSpeech: "n",
      equivalenceGroup: "same-touch",
      equivalenceEvidence: "same tactile meaning"
    }]
  }), /shared target, part of speech, and evidence/u);
});

test("bridge index rejects an equivalence group without shared evidence", () => {
  assert.throws(() => buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "n:first",
      target: "touch",
      targetPartOfSpeech: "n",
      equivalenceGroup: "same-touch"
    }, {
      source: "n:second",
      target: "touch",
      targetPartOfSpeech: "n",
      equivalenceGroup: "same-touch"
    }]
  }), /shared target, part of speech, and evidence/u);
});

test("dynamic accepted links do not share one atom across distinct senses", () => {
  const records = ["n:first", "n:second"].map((source) => ({
    status: "accepted-llm",
    pos: "n",
    synset: source.slice(2),
    link: {
      target: "touch",
      pyashSequence: ["tcum"],
      targetKind: "atom",
      targetId: "atom:tcum",
      targetPartOfSpeech: "n",
      evidence: "same model-selected atom"
    }
  }));
  assert.equal(buildEnglishWordNetSenseBridgeIndex(records).size, 0);
});

test("bridge catalog persists equivalence evidence as native Pyash rows", () => {
  const parsed = parseEnglishWordNetBridgeCatalog([
    "su name translation_english_wordnet_bridges be map def",
    'su text "format" ob text "english-wordnet-bridge-v1" ya',
    'su text "source" ob text "fixture" ya',
    'su text "equivalence:touch-kind" ob text "n:first n:second" via text "same tactile meaning" ya',
    'su text "n:first" ob name touch as text "n" with text "contextual" via text "first gloss" ya',
    'su text "n:second" ob name touch as text "n" with text "contextual" via text "second gloss" ya',
    "prah"
  ].join("\n"));
  assert.deepEqual(parsed.entries.map((entry) => entry.equivalenceGroup), ["touch-kind", "touch-kind"]);
});
