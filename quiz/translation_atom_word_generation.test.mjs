import assert from "node:assert/strict";
import test from "node:test";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  buildAtomWordProposal,
  buildGrammarWordProposal,
  buildPhoneticContributors,
  buildWeightedPhoneticProfile,
  generateGrammarCandidates,
  loadAtomWordGenerationInputs,
  normalizeIpaToLayer,
  parseAtomWordLists,
  parseLegacyPyashWords,
  parsePhoneticCatalog
} from "../program/library/translation/atom_word_generation.mjs";

test("atom phonetic projection follows the cumulative glyph layers", () => {
  assert.equal(normalizeIpaToLayer(" lˈʌv\n", 16), "luw");
  assert.equal(normalizeIpaToLayer(" lˈʌv\n", 19), "low");
  assert.equal(normalizeIpaToLayer(" lˈʌv\n", 24), "low");
  assert.equal(normalizeIpaToLayer(" lˈʌv\n", 28), "lov");
  assert.equal(normalizeIpaToLayer(" lˈʌv\n", 32), "lov");
});

test("atom phonetic profile keeps source language order and weighted evidence", () => {
  const profile = buildWeightedPhoneticProfile({
    en: "mas",
    zh: "mas"
  }, { layer: 16, weights: { en: 2, zh: 3 } });
  assert.deepEqual(profile.languages, ["en", "zh"]);
  assert.equal(profile.profile.initialConsonants.m, 5);
  assert.equal(profile.profile.vowels.a, 5);
  assert.equal(profile.profile.finalConsonants.s, 5);
});

test("atom candidates report the source languages for each generated glyph role", () => {
  const phonetic = buildWeightedPhoneticProfile({
    en: "fwuk",
    zh: "pwum"
  }, { layer: 16, weights: { en: 1, zh: 1 } });
  assert.deepEqual(buildPhoneticContributors("fwuk", phonetic.evidence), [
    { role: "initial", glyph: "f", languages: ["en"], languageCount: 1, populationWeight: 1 },
    { role: "middle", glyph: "w", languages: ["en", "zh"], languageCount: 2, populationWeight: 2 },
    { role: "vowel", glyph: "u", languages: ["en", "zh"], languageCount: 2, populationWeight: 2 },
    { role: "final", glyph: "k", languages: ["en"], languageCount: 1, populationWeight: 1 }
  ]);
  assert.deepEqual(buildPhoneticContributors("pwum", phonetic.evidence), [
    { role: "initial", glyph: "p", languages: ["zh"], languageCount: 1, populationWeight: 1 },
    { role: "middle", glyph: "w", languages: ["en", "zh"], languageCount: 2, populationWeight: 2 },
    { role: "vowel", glyph: "u", languages: ["en", "zh"], languageCount: 2, populationWeight: 2 },
    { role: "final", glyph: "m", languages: ["zh"], languageCount: 1, populationWeight: 1 }
  ]);

  const rankedPhonetic = buildWeightedPhoneticProfile({
    en: "fwuk",
    zh: "pwum"
  }, { layer: 16, weights: { en: 1, zh: 2 } });
  const proposal = buildAtomWordProposal({
    concept: "brain",
    phonetics: parsePhoneticCatalog(JSON.stringify({ Xbrain: { en: "fwuk", zh: "pwum" } })),
    frequency: { rows: [] },
    wordLists: { words: { 16: "fwuk\npwum\n", 19: "", 24: "", 28: "", 32: "" } },
    existingEntries: [],
    minLayer: 16,
    maxLayer: 16,
    weights: { en: 1, zh: 2 },
    candidateLimit: 2,
    candidateGenerator: () => [["fwuk", 2], ["pwum", 1]]
  });
  assert.equal(proposal.selected.word, "pwum");
  assert.deepEqual(proposal.selected.phoneticContributors, buildPhoneticContributors("pwum", rankedPhonetic.evidence));
  assert.deepEqual(proposal.layers[0].candidates[1].phoneticContributors, buildPhoneticContributors("fwuk", rankedPhonetic.evidence));
});

test("atom proposal is deterministic and reserves an existing word", () => {
  const phonetics = parsePhoneticCatalog(JSON.stringify({ Xmyas: { en: "myas" } }));
  const wordLists = { words: { 16: "hmis\nhmas\n", 19: "", 24: "", 28: "", 32: "" } };
  const frequency = { rows: [{ rank: 3, word: "myas", normalizedWord: "myas", score: 99 }] };
  const options = {
    concept: "myas",
    phonetics,
    frequency,
    wordLists,
    existingEntries: [],
    minLayer: 16,
    maxLayer: 16,
    weights: { en: 2 },
    candidateLimit: 2
  };
  const first = buildAtomWordProposal(options);
  const second = buildAtomWordProposal(options);
  assert.deepEqual(first, second);
  assert.equal(first.status, "candidate");
  assert.equal(first.selected.word, "hmis");
  assert.equal(first.selected.layer, 16);
  assert.equal(first.frequency.rank, 3);
  const reserved = buildAtomWordProposal({ ...options, existingEntries: [{ en: "old", pya: "hmis" }] });
  assert.equal(reserved.status, "candidate");
  assert.equal(reserved.selected.word, "hmas");
});

test("grammar candidate generation uses grammar word shapes", () => {
  const candidates = generateGrammarCandidates(buildWeightedPhoneticProfile({ en: "example" }, {
    layer: 16,
    weights: { en: 1 }
  }).profile);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(([word]) => word.length <= 3 || word.endsWith("h")));
});

test("example keeps its lexical root separate from its grammar word", () => {
  const roots = pyashWords.filter((entry) => entry.en === "example");
  const grammar = pyashWords.filter((entry) => entry.en === "example_");
  assert.deepEqual(roots.map((entry) => entry.pya), ["tlam"]);
  assert.deepEqual(grammar.map((entry) => entry.pya), ["fluh"]);
  assert.notEqual(roots[0].pya, grammar[0].pya);
  assert.ok(grammar[0].pya.endsWith("h"));
});

test("atom proposal rejects an algorithmic HNUC collision", () => {
  const phonetics = parsePhoneticCatalog(JSON.stringify({ Xmas: { en: "mas" } }));
  const proposal = buildAtomWordProposal({
    concept: "mas",
    phonetics,
    frequency: { rows: [] },
    wordLists: { words: { 16: "hmas\n", 19: "", 24: "", 28: "", 32: "" } },
    existingEntries: [{ en: "occupied", pya: "hmaz" }],
    minLayer: 16,
    maxLayer: 16,
    weights: { en: 1 }
  });
  assert.equal(proposal.status, "no-non-overlapping-candidate");
  assert.equal(proposal.rejectedHnuc, 1);
});

test("atom source parsers reject duplicate layer words and malformed phonetics", () => {
  assert.throws(
    () => parseAtomWordLists({ 16: "hmas\nhmas\n", 19: "", 24: "", 28: "", 32: "" }),
    /duplicate/
  );
  assert.throws(() => parsePhoneticCatalog("[]"), /must be an object/);
  assert.deepEqual(parseLegacyPyashWords("si\tinfinitive\ntsin\tneedle\n").entries, [
    { pya: "si", en: "infinitive" },
    { pya: "tsin", en: "needle" }
  ]);
  assert.throws(() => parseLegacyPyashWords("malformed"), /malformed/);
});

test("atom proposal reports a bounded missing-phonetic state", () => {
  const proposal = buildAtomWordProposal({
    concept: "unlisted",
    phonetics: parsePhoneticCatalog(JSON.stringify({ Xknown: { en: "mas" } })),
    frequency: { rows: [{ rank: 1, normalizedWord: "unlisted", score: 1 }] },
    wordLists: { words: { 16: "", 19: "", 24: "", 28: "", 32: "" } },
    existingEntries: []
  });
  assert.equal(proposal.status, "missing-phonetic-evidence");
  assert.equal(proposal.frequency.rank, 1);
});

test("real pyachso2n sources produce a non-overlapping proposal", async () => {
  const inputs = await loadAtomWordGenerationInputs();
  const proposal = buildAtomWordProposal({
    concept: "blueprint",
    ...inputs,
    existingEntries: pyashWords
  });
  assert.equal(proposal.status, "candidate");
  assert.equal(proposal.frequency.rank, 28770);
  assert.ok(proposal.selected.word);
  assert.equal(proposal.phoneticSourceHash.length, 64);
  assert.equal(proposal.frequencySourceHash.length, 64);
  assert.equal(Object.keys(proposal.layerSourceHashes).length, 5);
  assert.ok(!pyashWords.some((entry) => entry.pya === proposal.selected.word));
  assert.ok(!pyashWords.some((entry) => {
    try {
      return Number.parseInt(entry.hnuc, 16) === proposal.selected.hnuc;
    } catch {
      return false;
    }
  }));
});

test("grammar word proposal reuses source phonetics without colliding with the lexical root", async () => {
  const inputs = await loadAtomWordGenerationInputs();
  const existingEntries = pyashWords.filter((entry) => entry.en !== "example_");
  const proposal = buildGrammarWordProposal({
    concept: "example_",
    sourceConcept: "example",
    ...inputs,
    existingEntries
  });
  assert.equal(proposal.category, "grammar");
  assert.equal(proposal.concept, "example_");
  assert.equal(proposal.sourceConcept, "example");
  assert.equal(proposal.status, "candidate");
  assert.equal(proposal.reservedWordSourceHash.length, 64);
  assert.ok(proposal.selected.word);
  assert.equal(proposal.selected.word, "fluh");
  assert.notEqual(proposal.selected.word, "tsin");
  assert.ok(proposal.selected.word.length <= 3 || proposal.selected.word.endsWith("h"));
  assert.ok(!existingEntries.some((entry) => entry.pya === proposal.selected.word));
  assert.ok(!existingEntries.some((entry) => {
    try {
      return Number.parseInt(entry.hnuc, 16) === proposal.selected.hnuc;
    } catch {
      return false;
    }
  }));
});

