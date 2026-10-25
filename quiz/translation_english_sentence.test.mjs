import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeDefaultEnglishSentence,
  analyzeEnglishSentence,
  applyEnglishSentenceCandidate,
  loadEnglishSentenceResources,
  resolveEnglishSentence
} from "../program/verbs/exchange/translation/english_sentence.mjs";
import { buildEnglishGrammarIndex, loadEnglishGrammarCatalog } from "../program/verbs/exchange/translation/english_grammar.mjs";
import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";
import {
  buildEnglishSentenceVerificationPrompt,
  createQueuedMindEnglishSentenceVerifier,
  parseEnglishSentenceVerificationResponse,
  verifyEnglishSentenceCandidates
} from "../program/verbs/exchange/translation/english_sentence_verification.mjs";

function fixtureResolver() {
  const rows = new Map([
    ["i", { coverageType: "grammar", pyashSequence: ["mi"] }],
    ["am", { coverageType: "unresolved" }],
    ["walking", {
      coverageType: "lemma",
      lemma: "walk",
      pyashSequence: ["pfin"],
      morphology: {
        kind: "progressive",
        markerNames: ["progressive_aspect_"],
        markerSequence: ["pfih"],
        certainty: "contextual",
        evidence: "fixture progressive form"
      }
    }],
    ["walked", {
      coverageType: "lemma",
      lemma: "walk",
      pyashSequence: ["pfin"],
      morphology: {
        kind: "finite-past",
        markerNames: ["past_tense_"],
        markerSequence: ["ki"],
        certainty: "deterministic",
        evidence: "fixture past form"
      }
    }]
  ]);
  return (word) => rows.get(word) ?? null;
}

test("English sentence resources expose a staged source index before full coverage", async () => {
  const resources = await loadEnglishSentenceResources();
  assert.equal(resources.coverage, undefined);
  assert.equal(resources.source.cutoff, 30000);
  assert.ok(resources.wordnet.rows.length > 4000);
  assert.equal(resources.sourceByVariant.get("walked").word, "walked");
  assert.deepEqual(resources.grammarIndex.resolve("our").pyashSequence, ["nyah", "ye"]);
});

test("sentence analysis selects simple past and emits the root plus tense particle", () => {
  const result = analyzeEnglishSentence("I walked", { resolveWord: fixtureResolver() });
  assert.equal(result.status, "resolved");
  assert.equal(result.pyash, "su name mi na be pfin ki ya");
  assert.deepEqual(result.verbPhrase.pyashSequence, ["pfin", "ki"]);
  assert.deepEqual(result.verbPhrase.markerNames, ["past_tense_"]);
});

test("sentence context selects progressive aspect plus present tense", () => {
  const result = analyzeEnglishSentence("I am walking", {
    resolveWord: fixtureResolver(),
    lemmaEntries: [{
      surface: "am",
      lemma: "be",
      kind: "irregular",
      status: "accepted-curated",
      evidence: "fixture present auxiliary",
      morphology: {
        kind: "finite-present",
        markerNames: ["present_tense_"],
        markerSequence: ["ra"],
        certainty: "deterministic",
        evidence: "fixture present auxiliary"
      }
    }]
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.pyash, "su name mi na be pfin pfih ra ya");
  assert.deepEqual(result.verbPhrase.markerNames, ["progressive_aspect_", "present_tense_"]);
});

test("sentence subjects compose possessive noun phrases and regular plurals", async () => {
  const result = await analyzeDefaultEnglishSentence("our houses walked");
  assert.equal(result.status, "resolved");
  assert.equal(result.pyash, "su name nyah ye hcas pu na be pfin ki ya");
  assert.deepEqual(result.subject.pyashSequence, ["nyah", "ye", "hcas", "pu", "na"]);
});

test("English surface grammar resolves pro-forms, demonstratives, and within as a case", async () => {
  const it = await analyzeDefaultEnglishSentence("it walked");
  assert.equal(it.status, "resolved");
  assert.equal(it.pyash, "su name ya na be pfin ki ya");

  const things = await analyzeDefaultEnglishSentence("things walked");
  assert.equal(things.status, "resolved");
  assert.equal(things.pyash, "su name ya pu na be pfin ki ya");

  const thisThing = await analyzeDefaultEnglishSentence("this walked");
  assert.equal(thisThing.status, "resolved");
  assert.equal(thisThing.pyash, "su name tsah na be pfin ki ya");

  const within = await analyzeDefaultEnglishSentence("I walked within houses");
  assert.equal(within.status, "resolved");
  assert.equal(within.pyash, "su name mi na ob name hcas pu lwah be pfin ki ya");
});

test("English example uses its generated non-overlapping grammar word", async () => {
  const resources = await loadEnglishSentenceResources();
  assert.deepEqual(resources.grammarIndex.resolve("example").pyashSequence, ["tfum"]);
  assert.equal(resources.grammarIndex.resolve("example").kind, "referential");

  const result = await analyzeDefaultEnglishSentence("this is an example");
  const example = result.tokens.find((token) => token.surface === "example");
  assert.equal(example.coverageType, "grammar");
  assert.deepEqual(example.pyashSequence, ["tfum"]);
  assert.deepEqual(example.grammar.components, ["example_"]);
});

test("English case surfaces cover the canonical grid and common aliases", async () => {
  const cases = [
    ["from", "so"],
    ["at", "ga"],
    ["to", "ma"],
    ["in", "lwah"],
    ["into", "twih"],
    ["on", "lwah"],
    ["onto", "sweh"],
    ["under", "lwah"],
    ["beneath", "bveh"],
    ["since", "tsi7h"],
    ["during", "myah"],
    ["until", "tweh"],
    ["as", "swih"],
    ["with", "mwah"],
    ["for", "yi"],
    ["among", "sa7"],
    ["inside", "lwah"],
    ["through", "lwah"],
    ["before", "tsi7h"],
    ["after", "tweh"],
    ["below", "bveh"],
    ["upon", "lwah"]
  ];
  for (const [surface, pya] of cases) {
    const result = await analyzeDefaultEnglishSentence(`I walked ${surface} houses`);
    assert.equal(result.status, "resolved", surface);
    assert.equal(result.tokens.find((token) => token.surface === surface).pyashSequence[0], pya, surface);
  }
});

test("English quantifier and article surfaces use existing grammar particles", async () => {
  const cases = [
    ["the", "dlih"],
    ["a", "tlih"],
    ["an", "tlih"],
    ["some", "tlih"],
    ["any", "tlah"],
    ["all", "wi"],
    ["every", "wi"],
    ["these", ["tsah", "pu"]],
    ["those", ["tsuh", "pu"]],
    ["or", "ba"]
  ];
  for (const [surface, pya] of cases) {
    const grammar = await loadEnglishGrammarCatalog();
    const entry = grammar.entries.find((candidate) => candidate.surface === surface);
    assert.deepEqual(entry?.pyashSequence, Array.isArray(pya) ? pya : [pya], surface);
  }
});

test("sentence objects preserve possessives, plural markers, and conjunction links", async () => {
  const result = await analyzeDefaultEnglishSentence("I walked our houses and your names");
  assert.equal(result.status, "resolved");
  assert.equal(result.pyash, "su name mi na ob name nyah ye hcas pu wa sa ye hnim pu ka be pfin ki ya");
});

test("English of-relations use genitive ti while possessive determiners keep ye", async () => {
  const grammar = await loadEnglishGrammarCatalog();
  const grammarIndex = buildEnglishGrammarIndex({ catalogEntries: grammar.entries });
  const base = fixtureResolver();
  const rows = new Map([
    ["house", { coverageType: "lemma", pyashSequence: ["hcas"] }],
    ["god", { coverageType: "lemma", pyashSequence: ["tlan"] }]
  ]);
  const result = analyzeEnglishSentence("I walked house of God", {
    grammarIndex,
    resolveWord: (word) => rows.get(word) ?? base(word)
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.pyash, "su name mi na ob name hcas tlan ti ka be pfin ki ya");
});

test("English compositional relations lower to phrase-final case markers", async () => {
  const into = await analyzeDefaultEnglishSentence("I walked into houses");
  assert.equal(into.status, "resolved");
  assert.equal(into.pyash, "su name mi na ob name hcas pu twih be pfin ki ya");
  assert.deepEqual(into.tokens.find((token) => token.surface === "into").pyashSequence, ["twih"]);

  const from = await analyzeDefaultEnglishSentence("I walked from houses");
  assert.equal(from.status, "resolved");
  assert.equal(from.pyash, "su name mi na ob name hcas pu so be pfin ki ya");
});

test("deterministic plural recovery uses an existing root and retains WordNet sense evidence", async () => {
  const result = await analyzeDefaultEnglishSentence("there are reactions");
  const reaction = result.tokens.find((token) => token.surface === "reactions");
  assert.deepEqual(reaction.pyashSequence, ["ryak", "pu"]);
  assert.equal(reaction.coverageType, "atomic");
  assert.deepEqual(reaction.wordnet.partsOfSpeech, ["n"]);
  assert.equal(reaction.wordnet.senses.length, 3);
});

test("sentence context distinguishes distal that from a relative-clause that", async () => {
  const distal = await analyzeDefaultEnglishSentence("that house walked");
  assert.deepEqual(distal.tokens.find((token) => token.surface === "that").pyashSequence, ["tsuh"]);
  assert.equal(distal.tokens.find((token) => token.surface === "that").grammar.kind, "pronoun");

  const relative = await analyzeDefaultEnglishSentence("brain that can be triggered");
  const that = relative.tokens.find((token) => token.surface === "that");
  assert.deepEqual(that.pyashSequence, ["la"]);
  assert.equal(that.grammar.kind, "dependent-clause");
  assert.match(that.evidence, /relative-clause/u);
  assert.equal(relative.tokens.find((token) => token.surface === "be").construction.kind, "passive-auxiliary");
  assert.equal(relative.tokens.find((token) => token.surface === "be").copula, true);
  assert.deepEqual(relative.unresolved, ["brain"]);
});

test("WordNet evidence yields bounded synonym candidates without auto-selecting a sense", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [{
      id: "v:fond%2:37:04::",
      pos: "v",
      synset: "fond%2:37:04::",
      senseKey: "fond%2:37:04::",
      lemma: "florp",
      gloss: "be fond of",
    }, {
      id: "v:fond%2:37:04::like",
      pos: "v",
      synset: "fond%2:37:04::",
      senseKey: "fond%2:37:04::",
      lemma: "like",
      gloss: "be fond of",
    }, {
      id: "v:fond%2:37:05::",
      pos: "v",
      synset: "fond%2:37:05::",
      senseKey: "fond%2:37:05::",
      lemma: "florp",
      gloss: "be attached to",
    }]
  });
  const result = analyzeEnglishSentence("I florp", {
    wordnetIndex: wordnet,
    resolveWord: (word) => word === "i"
      ? { coverageType: "grammar", pyashSequence: ["mi"] }
      : word === "like"
        ? { coverageType: "atomic", pyashSequence: ["pyan"] }
        : null
  });
  const token = result.tokens.find((candidate) => candidate.surface === "florp");
  assert.equal(result.status, "review");
  assert.equal(token.semanticCandidates.length, 1);
  assert.deepEqual(token.semanticCandidates[0].pyashSequence, ["pyan"]);
  assert.deepEqual(token.wordnet.partsOfSpeech, ["v"]);
});

test("WordNet auto-resolves only when every available sense agrees on one existing atom", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [{
      id: "v:fond%2:37:04::",
      pos: "v",
      synset: "fond%2:37:04::",
      senseKey: "fond%2:37:04::",
      lemma: "glorp",
      gloss: "be fond of"
    }, {
      id: "v:fond%2:37:04::like",
      pos: "v",
      synset: "fond%2:37:04::",
      senseKey: "fond%2:37:04::",
      lemma: "like",
      gloss: "be fond of"
    }]
  });
  const result = analyzeEnglishSentence("I glorp", {
    wordnetIndex: wordnet,
    resolveWord: (word) => word === "i"
      ? { coverageType: "grammar", pyashSequence: ["mi"] }
      : word === "like"
        ? { coverageType: "atomic", pyashSequence: ["pyan"] }
        : null
  });
  const token = result.tokens.find((candidate) => candidate.surface === "glorp");
  assert.equal(token.coverageType, "semantic-wordnet");
  assert.deepEqual(token.pyashSequence, ["pyan"]);
  assert.deepEqual(token.semanticCandidates, []);
});

test("such as is classified as an exemplifier construction", async () => {
  const result = await analyzeDefaultEnglishSentence("love includes things such as friendship");
  const such = result.tokens.find((token) => token.surface === "such");
  assert.equal(such.construction.kind, "exemplifier");
  assert.equal(such.construction.category, "exemplification");
  assert.match(such.evidence, /Pyash grammar mapping remains unresolved/u);
});

test("sentence grammar maps thy and negation while leaving the lexical predicate contextual", async () => {
  const result = await analyzeDefaultEnglishSentence("thy names lead us not into temptation");
  assert.equal(result.status, "review");
  assert.deepEqual(result.subject.pyashSequence, ["sa", "ye", "hnim", "pu", "na"]);
  assert.deepEqual(result.verbPhrase.pyashSequence, ["tyip", "ra", "no"]);
  assert.equal(result.unresolved.length, 0);
  const resolved = await resolveEnglishSentence("thy names lead us not into temptation", {
    analyze: async () => result,
    verify: async ({ candidates }) => ({ verdict: "accept", candidateId: candidates[0].id })
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.pyash, "su name sa ye hnim pu na ob name nyah hyoc twih be tyip ra no ya");
});

test("imperative Lord's Prayer clause supplies the second-person subject", async () => {
  const result = await analyzeDefaultEnglishSentence("lead us not into temptation");
  assert.equal(result.status, "review");
  assert.deepEqual(result.subject.pyashSequence, ["sa", "na"]);
  assert.equal(result.verbPhrase.phrase, "lead");
  assert.equal(result.unresolved.length, 0);
});

test("standalone participle remains a contextual candidate", async () => {
  const result = await analyzeDefaultEnglishSentence("walking");
  assert.equal(result.status, "review");
  assert.deepEqual(result.verbPhrase.pyashSequence, ["pfin", "pfih"]);
  assert.equal(result.verbPhrase.certainty, "contextual");
});

test("sentence verifier accepts only a supplied candidate and repairs once", async () => {
  const analysis = analyzeEnglishSentence("walking", { resolveWord: fixtureResolver() });
  const first = analysis.candidates[0];
  const calls = [];
  const result = await verifyEnglishSentenceCandidates({
    sourceText: "walking",
    analysis,
    candidates: [first],
    invoke: async (request) => {
      calls.push(request);
      if (request.phase === "verify") return "provider preface without json";
      return JSON.stringify({ verdict: "accept", candidateId: first.id, rationale: "context selects the participle reading" });
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.verdict, "accept");
  assert.equal(result.candidateId, first.id);
  assert.equal(result.candidates[0].verificationStatus, "accepted-llm");
  assert.equal(parseEnglishSentenceVerificationResponse("noise only", { candidates: [first] }).valid, false);
  assert.equal(parseEnglishSentenceVerificationResponse(JSON.stringify({ verdict: "accept", candidateId: "outside", rationale: "x" }), { candidates: [first] }).valid, false);
  assert.equal(parseEnglishSentenceVerificationResponse("x".repeat(12001), { candidates: [first] }).valid, false);
  const applied = applyEnglishSentenceCandidate({
    ...analysis,
    status: "review",
    subject: { pyashSequence: ["mi"] },
    tokens: [{ surface: "walking", pyashSequence: ["pfin"] }]
  }, first.id);
  assert.equal(applied.status, "resolved");
});

test("sentence resolution applies a Housekeeper-selected contextual candidate", async () => {
  const analysis = analyzeEnglishSentence("I walking", {
    resolveWord: fixtureResolver(),
    lemmaEntries: [{
      surface: "am",
      lemma: "be",
      kind: "irregular",
      status: "accepted-curated",
      evidence: "fixture present auxiliary",
      morphology: {
        kind: "finite-present",
        markerNames: ["present_tense_"],
        markerSequence: ["ra"],
        certainty: "deterministic",
        evidence: "fixture present auxiliary"
      }
    }]
  });
  const resolved = await resolveEnglishSentence("I walking", {
    analyze: async () => analysis,
    verify: async ({ candidates }) => ({ verdict: "accept", candidateId: candidates[0].id })
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.pyash, "su name mi na be pfin pfih ya");
});

test("queued sentence verifier uses the existing future GPU duty and await path", async () => {
  const calls = [];
  const parse = (sentence) => sentence;
  const interpret = async (sentence) => {
    calls.push(sentence);
    return calls.length === 1
      ? { ob: { text: "queued" } }
      : { ob: { text: "success" }, result: { text: '{"verdict":"accept"}' } };
  };
  const invoke = createQueuedMindEnglishSentenceVerifier({ interpret, parse, timeoutMs: 1000 });
  const result = await invoke({ sourceText: "walking", prompt: buildEnglishSentenceVerificationPrompt({
    sourceText: "walking",
    analysis: { status: "review", tokens: [] },
    candidates: [{ id: "candidate-1", phrase: "walking", pyashSequence: ["pfin", "pfih"] }]
  }) });
  assert.match(calls[0], /vyah start future be gpu mind do/u);
  assert.match(calls[1], /vyah await be gpu do/u);
  assert.match(result, /verdict/u);
});
