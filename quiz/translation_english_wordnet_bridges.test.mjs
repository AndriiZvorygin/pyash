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

test("WordNet bridge rows have a lightweight gloss and lemma lookup", async () => {
  const catalog = await loadEnglishWordNetBridges();
  assert.ok(catalog.entries.length > 6000);
  assert.equal(catalog.entries.filter((entry) => entry.evidence.includes("active through sweep wordnet-sense-sweep-4c07194f363e-81b5bbefa3b0-d1")).length, 722);
  assert.equal(catalog.entries.filter((entry) => entry.evidence.includes("sense-link sweep wordnet-sense-sweep-4c07194f363e-9059730cda6d-d1-model-qwen3-5-9b-definition-anchor-v1")).length, 956);
  assert.ok(catalog.entries.filter((entry) => entry.evidence.startsWith("frequency-first anchor allocation")).length > 1000);
  assert.equal(catalog.entries.find((entry) => entry.source === "n:06850196-n"), undefined);
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "a:00005204-a"), {
    source: "a:00005204-a",
    target: "inevitable",
    targetPartOfSpeech: "a",
    certainty: "deterministic",
    evidence: "frequency-first anchor allocation: exact lemma absolute at English30k rank 2099; Princeton WordNet 3.1 tag count 11 (sense key absolute%3:00:00::)",
    gloss: "perfect or complete or pure; absolute loyalty; absolute silence; absolute truth; absolute alcohol",
    lemmas: ["absolute"]
  });
  assert.equal(catalog.entries.find((entry) => entry.source === "n:05818974-n"), undefined);
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "v:01775456-v"), {
    source: "v:01775456-v",
    target: "emotionally",
    targetPartOfSpeech: "v",
    certainty: "contextual",
    evidence: "Open English WordNet 2025 emotional-state sense",
    gloss: "undergo an emotional sensation or be in a particular state of mind; She felt resentful; He felt regret",
    lemmas: ["experience", "feel"]
  });
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "v:00621282-v"), {
    source: "v:00621282-v",
    target: "identity-confusion",
    targetPartOfSpeech: "v",
    certainty: "contextual",
    evidence: "Open English WordNet 2025 mistake-one-thing-for-another sense; Chinese 混同 treats distinct things as the same; Pyash compound identity-confusion uses hdif hbun",
    gloss: "mistake one thing for another; you are confusing me with the other candidate",
    lemmas: ["confound", "confuse"]
  });
  assert.equal(catalog.entries.find((entry) => entry.source === "v:00761702-v")?.target, "entreat");
  assert.equal(catalog.entries.find((entry) => entry.source === "v:00761702-v")?.certainty, "deterministic");
  assert.equal(catalog.entries.find((entry) => entry.source === "r:00111558-r"), undefined);
  assert.ok(catalog.entries.every((entry) => entry.gloss && entry.lemmas.length > 0));
  assert.equal(catalog.entries.find((entry) => entry.source === "n:00856168-n")?.lemmas.includes("feel"), true);
  assert.equal(catalog.entries.find((entry) => entry.source === "n:04609402-n"), undefined);
  assert.deepEqual(catalog.entries.find((entry) => entry.source === "s:01868647-s"), {
    source: "s:01868647-s",
    target: "only",
    targetPartOfSpeech: "s",
    certainty: "contextual",
    evidence: "atom-target sense selection; model qwen3.5:9b; run wordnet-atom-pos-live-pilot-be2e7b247a-1d04b32e5da4; rationale: Sense s:01868647-s defines 'only' as 'exclusive of anyone or anything else', which directly matches the label 'only' without implying solitude, whereas s:02222405-s implies being the single one.",
    gloss: "exclusive of anyone or anything else",
    lemmas: ["alone", "only"]
  });
});

test("WordNet bridge catalog joins its linked sense gloss and lemmas", () => {
  const catalog = parseEnglishWordNetBridgeCatalog([
    "su name translation_english_wordnet_bridges be map def",
    'su text "format" ob text "english-wordnet-bridge-v1" ya',
    'su text "source" ob text "fixture" ya',
    'su text "n:00000001-n" ob name anchor as text "n" with text "contextual" via text "fixture evidence" ya',
    'su text "sense-gloss:n:00000001-n" ob text "a gloss; an example" ya',
    'su text "sense-lemma:n:00000001-n:1" ob text "sample" ya',
    'su text "sense-lemma:n:00000001-n:2" ob text "sample word" ya',
    "prah",
    ""
  ].join("\n"));
  assert.deepEqual(catalog.entries[0], {
    source: "n:00000001-n",
    target: "anchor",
    targetPartOfSpeech: "n",
    certainty: "contextual",
    evidence: "fixture evidence",
    gloss: "a gloss; an example",
    lemmas: ["sample", "sample word"]
  });
});

test("WordNet bridge catalog rejects incomplete or orphaned gloss metadata", () => {
  const fixture = (rows) => [
    "su name translation_english_wordnet_bridges be map def",
    'su text "format" ob text "english-wordnet-bridge-v1" ya',
    'su text "source" ob text "fixture" ya',
    'su text "n:00000001-n" ob name anchor as text "n" with text "contextual" via text "fixture evidence" ya',
    ...rows,
    "prah"
  ].join("\n");
  assert.throws(
    () => parseEnglishWordNetBridgeCatalog(fixture(['su text "sense-gloss:n:00000001-n" ob text "gloss only" ya'])),
    (error) => error.code === "invalid-english-wordnet-bridge"
  );
  assert.throws(
    () => parseEnglishWordNetBridgeCatalog(fixture([
      'su text "sense-lemma:n:00000001-n:0" ob text "anchor" ya'
    ])),
    (error) => error.code === "invalid-english-wordnet-bridge"
  );
  assert.throws(
    () => parseEnglishWordNetBridgeCatalog(fixture([
      'su text "sense-gloss:n:00000002-n" ob text "orphan gloss" ya',
      'su text "sense-lemma:n:00000002-n:1" ob text "orphan" ya'
    ])),
    (error) => error.code === "invalid-english-wordnet-bridge"
  );
});

test("the selected sense projects identity-confusion beside mood and preserves its Pyac sequence", async () => {
  const bridges = buildEnglishWordNetSenseBridgeIndex([{
    id: "english-wordnet-sense-confuse-identity-confusion",
    pos: "v",
    synset: "00621282-v",
    status: "accepted-llm",
    link: {
      target: "identity-confusion",
      pyashSequence: ["hdif", "hbun"],
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
  assert.equal(token?.lemma, "identity confusion");
  assert.deepEqual(token?.pyashSequence, ["hdif", "hbun"]);
  assert.deepEqual(result.verbPhrase.pyashSequence, ["hdif", "hbun", "pyoh", "ra2"]);
  assert.equal(result.verbPhrase.mood, "tseh");

  const lowered = lowerSentencePhraseVliw(result.sentence);
  assert.deepEqual(
    decodePhraseVliw(lowered.vectors).tokens.slice(-5).map((part) => part.pya),
    ["hdif", "hbun", "pyoh", "ra2", "tseh"]
  );
  assert.equal(
    renderEnglishFromVliw(lowered.vectors).englishPyash,
    "can often su love be identity-confusion with other emotion."
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

test("one lexical atom may anchor distinct parts of speech independently", () => {
  const index = buildEnglishWordNetBridgeIndex({
    entries: ["n:first", "v:second"].map((source) => ({
      source,
      target: "lead",
      pyashSequence: ["cyuk"],
      targetPartOfSpeech: source[0],
      certainty: "contextual",
      evidence: `${source} meaning`
    }))
  });

  assert.equal(index.lookup("n:first")?.targetId, "atom:cyuk:n");
  assert.equal(index.lookup("v:second")?.targetId, "atom:cyuk:v");
  assert.deepEqual(index.ambiguousTargets, []);
});

test("WordNet adjective satellites keep a distinct satellite target slot", () => {
  const index = buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "s:satellite",
      target: "becoming",
      pyashSequence: ["hbin"],
      targetPartOfSpeech: "s",
      evidence: "satellite adjective"
    }]
  });

  assert.equal(index.lookup("s:satellite")?.targetPartOfSpeech, "s");
  assert.equal(index.lookup("s:satellite")?.targetId, "atom:hbin:s");
});

test("bridge index excludes grammar words even when they have Pyash sequences", () => {
  const index = buildEnglishWordNetBridgeIndex({
    entries: [{
      source: "n:grammar-target",
      target: "days",
      pyashSequence: ["dlet"],
      targetPartOfSpeech: "n",
      evidence: "stale grammar bridge"
    }, {
      source: "n:lexical-target",
      target: "duration",
      pyashSequence: ["dlet"],
      targetPartOfSpeech: "n",
      evidence: "lexical anchor"
    }],
    resolveTarget: (target) => target === "days"
      ? { coverageType: "grammar", pyashSequence: ["dlet"] }
      : { coverageType: "atomic", pyashSequence: ["dlet"] }
  });

  assert.equal(index.entries.length, 2);
  assert.equal(index.lookup("n:grammar-target"), null);
  assert.equal(index.lookup("n:lexical-target")?.targetId, "atom:dlet:n");
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
