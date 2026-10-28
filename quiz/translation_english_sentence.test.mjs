import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeDefaultEnglishSentence,
  analyzeEnglishSentence,
  applyEnglishSentenceCandidate,
  loadEnglishSentenceResources,
  resolveEnglishSentence,
  selectEnglishWordNetSenses
} from "../program/verbs/exchange/translation/english_sentence.mjs";
import { buildEnglishGrammarIndex, loadEnglishGrammarCatalog } from "../program/verbs/exchange/translation/english_grammar.mjs";
import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";
import {
  buildEnglishSentenceVerificationPrompt,
  createQueuedMindEnglishSentenceVerifier,
  parseEnglishSentenceVerificationResponse,
  verifyEnglishSentenceCandidates
} from "../program/verbs/exchange/translation/english_sentence_verification.mjs";
import {
  decodePhraseVliw,
  lowerSentencePhraseVliw,
  renderVliwPyac
} from "../program/library/vliw/phrase.mjs";
import { renderEnglishPyash } from "../program/verbs/exchange/translation/pyac_to_english_pyash.mjs";

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

test("English sentence resources expose one shared full coverage index", async () => {
  const resources = await loadEnglishSentenceResources();
  assert.equal(resources.coverage.counts.compound, 22);
  assert.deepEqual(resources.coverage.byVariant.get("involve").pyashSequence, ["lwak", "hzan"]);
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
  assert.deepEqual(resources.grammarIndex.resolve("example").pyashSequence, ["fluh"]);
  assert.equal(resources.grammarIndex.resolve("example").kind, "referential");

  const result = await analyzeDefaultEnglishSentence("this is an example");
  assert.equal(result.status, "resolved");
  assert.equal(result.construction, "zero-copula");
  assert.equal(result.sentence.be, undefined);
  const example = result.tokens.find((token) => token.surface === "example");
  assert.equal(example.coverageType, "grammar");
  assert.deepEqual(example.pyashSequence, ["fluh"]);
  assert.deepEqual(example.grammar.components, ["example_"]);
});

test("English zero-copula analysis records subject and object phrase evidence", async () => {
  const result = await analyzeDefaultEnglishSentence("Love is a mix of feelings and actions.");
  assert.equal(result.status, "resolved");
  assert.equal(result.construction, "zero-copula");
  assert.equal(result.sentence.be, undefined);
  assert.equal(result.sentence.su.name, "pyan na");
  assert.equal(result.sentence.ob.name, "tlih mrat ka xyek pu wa twot ti");
  assert.deepEqual(result.phrases.map((phrase) => ({
    slot: phrase.slot,
    start: phrase.start,
    end: phrase.end,
    surface: phrase.surface
  })), [
    { slot: "su", start: 0, end: 1, surface: "Love" },
    { slot: "ob", start: 2, end: 8, surface: "a mix of feelings and actions" }
  ]);
});

test("English passive participles remain separate from zero-copula actions", async () => {
  const result = await analyzeDefaultEnglishSentence("Love is expressed.");
  assert.equal(result.construction, undefined);
  assert.equal(result.status, "review");
  assert.deepEqual(result.unresolved, ["expressed"]);
});

test("English lexical equivalence maps mix surfaces to the existing mixed atom", async () => {
  const present = await analyzeDefaultEnglishSentence("I mix");
  assert.equal(present.status, "review");
  assert.deepEqual(present.unresolved, []);
  assert.equal(present.pyash, "mrat ra");

  const past = await analyzeDefaultEnglishSentence("I mixed");
  assert.equal(past.status, "resolved");
  assert.equal(past.pyash, "su name mi na be mrat ki ya");

  const progressive = await analyzeDefaultEnglishSentence("I am mixing");
  assert.equal(progressive.status, "resolved");
  assert.equal(progressive.pyash, "su name mi na be mrat pfih ra ya");

  const noun = await analyzeDefaultEnglishSentence("a mix");
  assert.equal(noun.tokens.find((token) => token.surface === "mix").coverageType, "lemma");
  assert.deepEqual(noun.tokens.find((token) => token.surface === "mix").pyashSequence, ["mrat"]);
});

test("emotion equivalences reuse emotionally and attach number or adjective grammar", async () => {
  const emotion = await analyzeDefaultEnglishSentence("emotions");
  assert.deepEqual(emotion.tokens[0].pyashSequence, ["xyek", "pu"]);

  const emotional = await analyzeDefaultEnglishSentence("emotional");
  assert.deepEqual(emotional.tokens[0].pyashSequence, ["xyek", "ci"]);

  const feelings = await analyzeDefaultEnglishSentence("feelings");
  assert.deepEqual(feelings.tokens[0].pyashSequence, ["xyek", "pu"]);

  const feel = await analyzeDefaultEnglishSentence("feel");
  assert.equal(feel.tokens[0].coverageType, "unresolved");
  assert.ok(feel.tokens[0].wordnet.senses.length > 1);
  assert.ok(feel.tokens[0].semanticCandidates.some((candidate) => (
    candidate.lemma === "emotionally" && candidate.pyashSequence.join(" ") === "xyek"
  )));
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
    ["for", "pwah"],
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
  assert.equal(result.pyash, "su name mi na ob name hcas ka tlan ti be pfin ki ya");
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

test("English object and benefactive phrases keep separate Pyac suffixes", async () => {
  const result = await analyzeDefaultEnglishSentence("I walked a house for someone");
  assert.equal(result.status, "resolved");
  assert.equal(result.sentence.ob.name, "tlih hcas ka cyah tlih pwah");
  assert.match(result.pyash, /ob name tlih hcas ka cyah tlih pwah/u);
});

test("deterministic plural recovery uses an existing root and retains WordNet sense evidence", async () => {
  const result = await analyzeDefaultEnglishSentence("there are reactions");
  const reaction = result.tokens.find((token) => token.surface === "reactions");
  assert.deepEqual(reaction.pyashSequence, ["ryak", "pu"]);
  assert.equal(reaction.coverageType, "atomic");
  assert.deepEqual(reaction.wordnet.partsOfSpeech, ["n"]);
  assert.ok(reaction.wordnet.senses.length >= 3);
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
  assert.deepEqual(relative.unresolved, []);
});

test("relative-clause context keeps a mixed-part-of-speech noun nominal", async () => {
  const result = await analyzeDefaultEnglishSentence("feelings and actions that shows");
  const actions = result.tokens.find((token) => token.surface === "actions");
  const resources = await loadEnglishSentenceResources();
  const selection = selectEnglishWordNetSenses(
    actions,
    result.tokens,
    result.tokens.indexOf(actions),
    resources.wordnet.index
  );
  assert.ok(selection.senses.length > 0);
  assert.ok(selection.senses.every((sense) => sense.pos === "n"));
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

test("WordNet context selects the matching sense before deterministic agreement", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [{
      id: "n:river:bank",
      pos: "n",
      synset: "river",
      senseKey: "river",
      lemma: "bank",
      gloss: "sloping land beside a river"
    }, {
      id: "n:river:riverbank",
      pos: "n",
      synset: "river",
      senseKey: "river",
      lemma: "riverbank",
      gloss: "sloping land beside a river"
    }, {
      id: "n:finance:bank",
      pos: "n",
      synset: "finance",
      senseKey: "finance",
      lemma: "bank",
      gloss: "financial institution handling an account"
    }, {
      id: "n:finance:financial",
      pos: "n",
      synset: "finance",
      senseKey: "finance",
      lemma: "financial",
      gloss: "financial institution handling an account"
    }]
  });
  const resolveWord = (word) => ({
    riverbank: { coverageType: "atomic", pyashSequence: ["tlap"] },
    financial: { coverageType: "atomic", pyashSequence: ["hrit"] }
  }[word] ?? null);

  const river = analyzeEnglishSentence("river bank", { wordnetIndex: wordnet, resolveWord });
  const riverBank = river.tokens.find((token) => token.surface === "bank");
  assert.equal(riverBank.coverageType, "semantic-wordnet");
  assert.deepEqual(riverBank.pyashSequence, ["tlap"]);
  assert.match(riverBank.evidence, /context matched river/u);

  const finance = analyzeEnglishSentence("bank account", { wordnetIndex: wordnet, resolveWord });
  const financeBank = finance.tokens.find((token) => token.surface === "bank");
  assert.equal(financeBank.coverageType, "semantic-wordnet");
  assert.deepEqual(financeBank.pyashSequence, ["hrit"]);
  assert.match(financeBank.evidence, /context matched account/u);
});

test("WordNet keeps broad modifiers from collapsing a type sense", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [{
      id: "n:symbol:type",
      pos: "n",
      synset: "symbol",
      senseKey: "symbol",
      lemma: "type",
      gloss: "all of the tokens of the same symbol; different types of character"
    }, {
      id: "n:kind:type",
      pos: "n",
      synset: "kind",
      senseKey: "kind",
      lemma: "type",
      gloss: "a subdivision of a particular kind of thing"
    }]
  });
  const records = [{
    surface: "different",
    lemma: "different",
    wordnet: { partsOfSpeech: ["a"], senses: [] }
  }, {
    surface: "types",
    lemma: "type",
    wordnet: {
      partsOfSpeech: ["n"],
      senses: [{
        pos: "n",
        synset: "symbol",
        lemma: "type",
        lemmas: ["type"],
        gloss: "all of the tokens of the same symbol; different types of character"
      }, {
        pos: "n",
        synset: "kind",
        lemma: "type",
        lemmas: ["type"],
        gloss: "a subdivision of a particular kind of thing"
      }]
    }
  }, {
    surface: "of",
    lemma: "",
    wordnet: { partsOfSpeech: [], senses: [] }
  }, {
    surface: "love",
    lemma: "love",
    wordnet: { partsOfSpeech: ["n"], senses: [] }
  }];
  const selection = selectEnglishWordNetSenses(records[1], records, 1, wordnet);
  assert.equal(selection.senses.length, 2);
  assert.equal(selection.evidence, "");
});

test("WordNet graph relations rank a connected sense when glosses provide no overlap", () => {
  const wordnet = buildEnglishWordNetIndex({
    rows: [{
      id: "n:river:bank",
      pos: "n",
      synset: "river",
      senseKey: "river",
      lemma: "bank",
      gloss: "edge of terrain"
    }, {
      id: "n:river:riverbank",
      pos: "n",
      synset: "river",
      senseKey: "river",
      lemma: "riverbank",
      gloss: "edge of terrain"
    }, {
      id: "n:finance:bank",
      pos: "n",
      synset: "finance",
      senseKey: "finance",
      lemma: "bank",
      gloss: "financial institution"
    }, {
      id: "n:finance:financial",
      pos: "n",
      synset: "finance",
      senseKey: "finance",
      lemma: "financial",
      gloss: "financial institution"
    }, {
      id: "n:water:water",
      pos: "n",
      synset: "water",
      senseKey: "water",
      lemma: "water",
      gloss: "liquid"
    }],
    relations: [{
      source: "n:river",
      target: "n:water",
      relation: "related"
    }]
  });
  const result = analyzeEnglishSentence("water bank", {
    wordnetIndex: wordnet,
    resolveWord: (word) => ({
      riverbank: { coverageType: "atomic", pyashSequence: ["tlap"] },
      financial: { coverageType: "atomic", pyashSequence: ["hrit"] }
    }[word] ?? null)
  });
  const bank = result.tokens.find((token) => token.surface === "bank");
  assert.equal(bank.coverageType, "semantic-wordnet");
  assert.deepEqual(bank.pyashSequence, ["tlap"]);
  assert.match(bank.evidence, /graph:water \(0\.5\)/u);
});

test("WordNet leaves a graph-only near tie for the focused sense selector", async () => {
  const result = await analyzeDefaultEnglishSentence(
    "Romantic love can lead to things such as dating and marriage, but a person can also feel for friends, such as platonic love, or family."
  );
  const feel = result.tokens.find((token) => token.surface === "feel");
  assert.notEqual(feel?.coverageType, "semantic-wordnet");
  assert.ok((feel?.semanticCandidates?.length ?? 0) > 1);
});

test("modal capacity keeps the full action phrase and preceding noun phrase together", async () => {
  const source = "Romantic love can lead to dating.";
  const analysis = await analyzeDefaultEnglishSentence(source);

  assert.equal(analysis.subject.surface, "romantic love");
  assert.equal(analysis.verbPhrase.phrase, "can lead");
  assert.equal(analysis.verbPhrase.mood, "tseh");
  assert.equal(analysis.verbPhrase.moodSurface, "can");
  assert.equal(analysis.verbPhrase.certainty, "contextual");
  assert.deepEqual(analysis.phrases.map((phrase) => [phrase.slot, phrase.surface]), [
    ["su", "Romantic love"],
    ["be", "can lead"],
    ["ob", "to dating"]
  ]);
  assert.deepEqual(analysis.tokens[2].pyashSequence, ["can"]);
  assert.equal(analysis.pyash, "tyip can");

  const resolved = await resolveEnglishSentence(source, {
    analyze: async () => analysis,
    verify: async ({ candidates }) => ({
      verdict: "accept",
      candidateId: candidates[0].id,
      rationale: "fixture accepts the selected lexical action"
    })
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.sentence.mood, "tseh");
  assert.equal(resolved.sentence.be, "tyip");
  assert.match(resolved.pyash, / tseh$/u);
  const lowered = lowerSentencePhraseVliw(resolved.sentence);
  const decoded = decodePhraseVliw(lowered.vectors);
  assert.equal(renderVliwPyac(decoded), "hram pyanna dxekma tyiptseh");
  assert.equal(
    renderEnglishPyash(resolved.sentence, [], decoded, new Map()),
    "can su romantic love be lead to dating."
  );
});

test("such as is classified as an exemplifier construction", async () => {
  const result = await analyzeDefaultEnglishSentence("love includes things such as friendship");
  const such = result.tokens.find((token) => token.surface === "such");
  assert.equal(such.construction.kind, "exemplifier");
  assert.equal(such.construction.category, "exemplification");
  assert.deepEqual(such.pyashSequence, ["fluh", "ga"]);
  assert.equal(such.grammar.kind, "exemplifier");
  const as = result.tokens.find((token) => token.surface === "as");
  assert.equal(as.consumedBy, "such as");
  assert.deepEqual(as.pyashSequence, []);
});

test("sentence grammar maps thy and negation while leaving the lexical action contextual", async () => {
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
  assert.equal(resolved.pyash, "su name sa ye hnim pu na ob name nyah ka hyoc twih be tyip ra no ya");
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
