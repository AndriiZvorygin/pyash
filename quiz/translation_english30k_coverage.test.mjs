import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { runVocabSuggest } from "../command/vocab_suggest.mjs";
import {
  ENGLISH30K_DEFAULT_PATH,
  buildEnglish30kCompoundCoverage,
  buildEnglish30kCoverage,
  loadDefaultEnglish30kCoverage,
  loadEnglish30k,
  lookupEnglish30kCoverage,
  parseEnglish30kText,
  renderEnglish30kCoveragePya,
  summarizeEnglish30kCoverage
} from "../program/verbs/exchange/translation/english30k_coverage.mjs";
import {
  buildEnglishLemmaCandidates,
  buildEnglishLemmaIndex,
  loadEnglishLemmaCatalog,
  parseEnglishLemmaCatalog
} from "../program/verbs/exchange/translation/english_lemmas.mjs";
import {
  buildEnglishDictionaryAliases,
  parseEnglishDictionaryBlacklist
} from "../program/verbs/exchange/translation/english_dictionary_aliases.mjs";
import {
  buildEnglishGrammarIndex,
  composeEnglishNounPhrase,
  loadEnglishGrammarCatalog
} from "../program/verbs/exchange/translation/english_grammar.mjs";

test("English30k parser preserves rank, score, and missing source ranks", () => {
  const source = parseEnglish30kText([
    "1\tthe\t100",
    "2   blue-print   80.5",
    "4\tGutenberg\t12"
  ].join("\n"), { cutoff: 4 });
  assert.equal(source.rows.length, 3);
  assert.deepEqual(source.missingRanks, [3]);
  assert.deepEqual(source.rows[1], {
    rank: 2,
    word: "blue-print",
    normalizedWord: "blue-print",
    score: 80.5
  });
  assert.throws(
    () => parseEnglish30kText("1\tbroken", { cutoff: 1 }),
    (error) => error.code === "invalid-english30k-coverage"
  );
});

test("English30k coverage classifies atoms, aliases, grammar, and compounds", () => {
  const source = parseEnglish30kText([
    "1\tblue-print\t100",
    "2\trunning\t90",
    "3\tto\t80",
    "4\tblue\t70",
    "5\tunknown\t60"
  ].join("\n"), { cutoff: 5 });
  const coverage = buildEnglish30kCoverage({
    source,
    atomicEntries: [
      { en: "blue", pya: "plun", hnuc: "0x0001" },
      { en: "run", pya: "hkin", hnuc: "0x0002" }
    ],
    aliases: new Map([["running", "run"]]),
    grammarMappings: new Map([["to", ["htac"]]]),
    compoundRecords: [{
      target: "blue-print",
      componentGlosses: ["blue", "print"],
      pyashSequence: ["plun", "trat"],
      status: "accepted-curated",
      provenance: "fixture"
    }]
  });
  assert.deepEqual(coverage.counts, {
    atomic: 1,
    alias: 1,
    grammar: 1,
    compound: 1,
    "dictionary-alias": 0,
    lemma: 0,
    unresolved: 1
  });
  assert.equal(lookupEnglish30kCoverage(coverage.records, "blue_print").coverageType, "compound");
  assert.equal(coverage.records.find((record) => record.word === "unknown").status, "unresolved");
  assert.match(renderEnglish30kCoveragePya(coverage), /english30k-coverage-v1/u);
  assert.equal(summarizeEnglish30kCoverage(coverage).targetRows, 5);
  assert.equal(summarizeEnglish30kCoverage(coverage).uniqueCanonicalLemmas, 3);
});

test("explicit grammar catalog mappings override same-surface lexical roots", () => {
  const source = parseEnglish30kText("1\tus\t100\n2\tand\t90", { cutoff: 2 });
  const coverage = buildEnglish30kCoverage({
    source,
    atomicEntries: [
      { en: "us", pya: "hwam" },
      { en: "and", pya: "hwan" }
    ],
    grammarMappings: new Map([
      ["us", ["nyah"]],
      ["and", ["wa"]]
    ]),
    grammarOverrides: new Map([
      ["us", ["nyah"]],
      ["and", ["wa"]]
    ])
  });
  assert.equal(coverage.records[0].coverageType, "grammar");
  assert.deepEqual(coverage.records[0].pyashSequence, ["nyah"]);
  assert.equal(coverage.records[1].coverageType, "grammar");
  assert.deepEqual(coverage.records[1].pyashSequence, ["wa"]);
});

test("repository English30k source is ranked and measurable", async (t) => {
  let source;
  try {
    source = await loadEnglish30k();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip(`source unavailable: ${ENGLISH30K_DEFAULT_PATH}`);
      return;
    }
    throw error;
  }
  assert.equal(source.rows.length, 29999);
  assert.deepEqual(source.missingRanks, [6897]);
  assert.equal(source.rows[0].rank, 1);
  assert.equal(source.rows[0].word, "the");
  assert.equal(source.rows.at(-1).rank, 30000);
  const coverage = buildEnglish30kCoverage({ source, atomicEntries: pyashWords });
  assert.ok(coverage.counts.atomic > 5000);
  assert.ok(coverage.unresolved.length > 20000);
  assert.equal(lookupEnglish30kCoverage(coverage.records, "the").rank, 1);
});

test("English30k compound generation feeds accepted and uncertain records separately", async (t) => {
  let source;
  try {
    source = await loadEnglish30k();
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip(`source unavailable: ${ENGLISH30K_DEFAULT_PATH}`);
      return;
    }
    throw error;
  }
  const generated = await buildEnglish30kCompoundCoverage({
    source,
    atomicEntries: pyashWords
  });
  assert.ok(generated.records.length > 0);
  assert.ok(generated.accepted.length > 0);
  assert.ok(generated.candidates.length > 0);
  assert.equal(generated.records.every((record) => Array.isArray(record.pyashSequence)), true);
  assert.equal(generated.records.every((record) => record.status !== "accepted-llm"), true);
});

test("vocab_suggest reports ranked unresolved coverage without losing existing compounds", async () => {
  const compoundLines = [];
  const compoundResult = await runVocabSuggest(["blueprint"], {
    report: (line) => compoundLines.push(String(line))
  });
  assert.equal(compoundResult.exitCode, 0);
  assert.match(compoundLines.join("\n"), /blueprint: found compound blue \+ print -> plun trat/u);

  const unresolvedLines = [];
  const unresolvedResult = await runVocabSuggest(["the"], {
    report: (line) => unresolvedLines.push(String(line))
  });
  assert.equal(unresolvedResult.exitCode, 1);
  assert.match(unresolvedLines.join("\n"), /the: .*English30k rank 1 remains unresolved/u);
});

test("durable English30k manifest records the source contract", async () => {
  const manifest = await fs.readFile(
    new URL("../program/verbs/exchange/translation/english30k_coverage.pya", import.meta.url),
    "utf8"
  );
  assert.match(manifest, /english30k-coverage-v1/u);
  assert.match(manifest, /source-hash/u);
  assert.match(manifest, /cutoff.*30000/u);
  assert.match(manifest, /missing-rank.*6897/u);
});

test("lemma index resolves regular forms only to existing atoms", () => {
  const index = buildEnglishLemmaIndex({
    atomicEntries: [
      { en: "run", pya: "hkin" },
      { en: "story", pya: "ksis" },
      { en: "walking", pya: "pfin" }
    ],
    catalogEntries: [{
      surface: "walked",
      lemma: "walk",
      canonicalEnglish: "walking",
      kind: "inflectional",
      status: "accepted-curated",
      evidence: "fixture surface mapped to the existing walking atom"
    }]
  });

  assert.equal(index.resolve("running").lemma, "run");
  assert.equal(index.resolve("running").rule, "present-participle-ing-doubled");
  assert.equal(index.resolve("stories").lemma, "story");
  assert.equal(index.resolve("walked").lemma, "walk");
  assert.equal(index.resolve("walked").pyashSequence[0], "pfin");
  assert.equal(index.resolve("acceptant"), null);
  assert.equal(index.resolve("zincking"), null);
});

test("durable lemma catalog parses source metadata and explicit irregular forms", async () => {
  const catalog = await loadEnglishLemmaCatalog();
  assert.equal(catalog.format, "english-lemma-v1");
  assert.equal(catalog.cutoff, 30000);
  assert.equal(catalog.sourceHash, "436ba126fe7cab2e12c860ce89832ce0d3c1fceb4505cb2ff353bdc1b2124b88");
  assert.equal(catalog.entries.some((entry) => entry.surface === "went" && entry.lemma === "go"), true);
  assert.equal(catalog.entries.find((entry) => entry.surface === "children")?.grammaticalNumber, "plural");
  assert.throws(
    () => parseEnglishLemmaCatalog([
      "su name translation_english30k_lemmas be map def",
      "su text \"format\" ob text \"english-lemma-v1\" ya",
      "su text \"went\" ob text \"{\\\"surface\\\":\\\"other\\\",\\\"lemma\\\":\\\"go\\\",\\\"kind\\\":\\\"irregular\\\",\\\"evidence\\\":\\\"fixture\\\"}\" ya",
      "prah"
    ].join("\n")),
    (error) => error.code === "invalid-english-lemma"
  );
  assert.throws(
    () => parseEnglishLemmaCatalog([
      "su name translation_english30k_lemmas be map def",
      "su text \"format\" ob text \"english-lemma-v1\" ya",
      "su text \"walked\" ob text \"{\\\"surface\\\":\\\"walked\\\",\\\"lemma\\\":\\\"walk\\\",\\\"kind\\\":\\\"inflectional\\\",\\\"status\\\":\\\"accepted-curated\\\",\\\"morphology\\\":{\\\"kind\\\":\\\"finite-past\\\",\\\"markerNames\\\":[],\\\"markerSequence\\\":[],\\\"evidence\\\":\\\"fixture\\\"},\\\"evidence\\\":\\\"fixture\\\"}\" ya",
      "prah"
    ].join("\n")),
    (error) => error.code === "invalid-english-lemma"
  );
  assert.throws(
    () => parseEnglishLemmaCatalog([
      "su name translation_english30k_lemmas be map def",
      "su text \"format\" ob text \"english-lemma-v1\" ya",
      "su text \"children\" ob text \"{\\\"surface\\\":\\\"children\\\",\\\"lemma\\\":\\\"child\\\",\\\"kind\\\":\\\"irregular\\\",\\\"grammaticalNumber\\\":\\\"dual\\\",\\\"evidence\\\":\\\"fixture\\\"}\" ya",
      "prah"
    ].join("\n")),
    (error) => error.code === "invalid-english-lemma"
  );
});

test("lemma coverage remains separate from atomic and compound coverage", () => {
  const source = parseEnglish30kText([
    "1\trunning\t100",
    "2\twent\t90",
    "3\tblue-print\t80",
    "4\tunknown\t70"
  ].join("\n"), { cutoff: 4 });
  const coverage = buildEnglish30kCoverage({
    source,
    atomicEntries: [
      { en: "run", pya: "hkin" },
      { en: "go", pya: "hkat" },
      { en: "blue", pya: "plun" },
      { en: "print", pya: "trat" }
    ],
    compoundRecords: [{
      target: "blue-print",
      componentGlosses: ["blue", "print"],
      pyashSequence: ["plun", "trat"],
      status: "accepted-curated",
      provenance: "fixture"
    }],
    lemmaEntries: [{
      surface: "went",
      lemma: "go",
      kind: "irregular",
      status: "accepted-curated",
      evidence: "fixture irregular form"
    }]
  });
  assert.equal(coverage.records.find((record) => record.word === "running").coverageType, "lemma");
  assert.equal(coverage.records.find((record) => record.word === "running").lemma, "run");
  assert.equal(coverage.records.find((record) => record.word === "went").coverageType, "lemma");
  assert.equal(coverage.records.find((record) => record.word === "blue-print").coverageType, "compound");
  assert.equal(coverage.records.find((record) => record.word === "unknown").coverageType, "unresolved");
  assert.equal(coverage.counts.lemma, 2);
});

test("vocab_suggest reports a ranked surface form through its lemma", async () => {
  const lines = [];
  const result = await runVocabSuggest(["walked"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.match(lines.join("\n"), /walked: lemma walk -> pfin \(English30k rank 647\)/u);
  assert.match(lines.join("\n"), /walked: morphology walk \+ past_tense_ -> pfin ki \(deterministic; English30k rank 647\)/u);
});

test("durable lemma morphology keeps lexical roots separate from particles", async () => {
  const catalog = await loadEnglishLemmaCatalog();
  const index = buildEnglishLemmaIndex({ atomicEntries: pyashWords, catalogEntries: catalog.entries });
  assert.deepEqual(index.resolve("walked")?.pyashSequence, ["pfin"]);
  assert.deepEqual(index.resolve("walked")?.morphology?.markerNames, ["past_tense_"]);
  assert.deepEqual(index.resolve("walked")?.morphology?.markerSequence, ["ki"]);
  assert.equal(index.resolve("walked")?.morphology?.certainty, "deterministic");
  assert.deepEqual(index.resolve("walking")?.morphology?.markerSequence, ["pfih"]);
  assert.equal(index.resolve("walking")?.morphology?.certainty, "contextual");
});

test("dictionary blacklist aliases accept only one existing Pyash target", () => {
  const dictionary = parseEnglishDictionaryBlacklist({
    en: {
      blacklist: {
        Xalpha: "one",
        Xambiguous: "one, two",
        Xgrammar: "conditional_mood_"
      }
    }
  });
  const resolved = buildEnglishDictionaryAliases({
    dictionary,
    atomicEntries: [
      { en: "one", pya: "hyik" },
      { en: "two", pya: "hwi7" },
      { en: "conditional_mood_", pya: "cu" }
    ]
  });
  assert.equal(resolved.aliases.get("alpha"), "one");
  assert.equal(resolved.aliases.get("grammar"), "conditional_mood_");
  assert.equal(resolved.aliases.has("ambiguous"), false);
  assert.equal(resolved.records.length, 2);
});

test("dictionary alias coverage is distinct from ordinary anchors", () => {
  const source = parseEnglish30kText([
    "1\the\t100",
    "2\tthe\t90"
  ].join("\n"), { cutoff: 2 });
  const coverage = buildEnglish30kCoverage({
    source,
    atomicEntries: [{ en: "it", pya: "htit" }],
    dictionaryAliases: new Map([["he", "it"]])
  });
  assert.equal(coverage.records[0].coverageType, "dictionary-alias");
  assert.equal(coverage.records[0].aliasOf, "it");
  assert.equal(coverage.records[1].coverageType, "unresolved");
});

test("default English30k coverage uses the repository dictionary blacklist", async () => {
  const coverage = await loadDefaultEnglish30kCoverage({ atomicEntries: pyashWords });
  const he = lookupEnglish30kCoverage(coverage, "he");
  assert.equal(he.coverageType, "dictionary-alias");
  assert.equal(he.canonicalEnglish, "it");
  assert.equal(he.pyashSequence[0], "htit");
  assert.ok(coverage.counts["dictionary-alias"] > 6000);
});

test("lwonprom-derived English grammar keeps particles separate from lexical roots", async () => {
  const catalog = await loadEnglishGrammarCatalog();
  const grammar = buildEnglishGrammarIndex({ catalogEntries: catalog.entries });
  assert.deepEqual(grammar.resolve("i")?.pyashSequence, ["mi"]);
  assert.deepEqual(grammar.resolve("me")?.pyashSequence, ["mi"]);
  assert.deepEqual(grammar.resolve("we")?.pyashSequence, ["nyah"]);
  assert.deepEqual(grammar.resolve("us")?.pyashSequence, ["nyah"]);
  assert.deepEqual(grammar.resolve("you")?.pyashSequence, ["sa"]);
  assert.deepEqual(grammar.resolve("our")?.components, ["us_", "possessive_marker_"]);
  assert.deepEqual(grammar.resolve("our")?.pyashSequence, ["nyah", "ye"]);
  assert.deepEqual(grammar.resolve("your")?.components, ["you_", "possessive_marker_"]);
  assert.deepEqual(grammar.resolve("your")?.pyashSequence, ["sa", "ye"]);
  assert.deepEqual(grammar.resolve("thy")?.pyashSequence, ["sa", "ye"]);
  assert.deepEqual(grammar.resolve("thine")?.pyashSequence, ["sa", "ye"]);
  assert.deepEqual(grammar.resolve("my")?.pyashSequence, ["mi", "ye"]);
  assert.deepEqual(grammar.resolve("ours")?.pyashSequence, ["nyah", "ye"]);
  assert.deepEqual(grammar.resolve("yours")?.pyashSequence, ["sa", "ye"]);
  assert.deepEqual(grammar.resolve("and")?.pyashSequence, ["wa"]);
  assert.deepEqual(grammar.resolve("also")?.pyashSequence, ["pcah"]);
  assert.deepEqual(grammar.resolve("but")?.pyashSequence, ["pyuh"]);
  assert.deepEqual(grammar.resolve("plural")?.pyashSequence, ["pu"]);
  assert.deepEqual(grammar.resolve("possessive")?.pyashSequence, ["ye"]);
  assert.deepEqual(grammar.resolve("not")?.pyashSequence, ["no"]);

  assert.equal(pyashWords.find((entry) => entry.en === "me")?.pya, "hman");
  assert.equal(pyashWords.find((entry) => entry.en === "us")?.pya, "hwam");
  assert.equal(pyashWords.find((entry) => entry.en === "you")?.pya, "hnan");
  assert.equal(pyashWords.find((entry) => entry.en === "and")?.pya, "hwan");
  assert.equal(pyashWords.find((entry) => entry.en === "also")?.pya, "hyac");
  assert.equal(pyashWords.find((entry) => entry.en === "but")?.pya, "hlan");
  assert.equal(grammar.resolve("our")?.pyashSequence.includes("hwam"), false);
  assert.equal(grammar.resolve("your")?.pyashSequence.includes("hnan"), false);

  const coverage = await loadDefaultEnglish30kCoverage({ atomicEntries: pyashWords });
  const father = lookupEnglish30kCoverage(coverage, "father");
  assert.equal(father?.coverageType, "dictionary-alias");
  assert.deepEqual(father?.pyashSequence, ["hpap"]);

  const phrase = composeEnglishNounPhrase({
    possessor: "our",
    head: "father",
    plural: true,
    grammarIndex: grammar,
    resolve: (word) => lookupEnglish30kCoverage(coverage, word)
  });
  assert.equal(phrase.status, "composed");
  assert.deepEqual(phrase.pyashSequence, ["nyah", "ye", "hpap", "pu"]);

  const alreadyPlural = composeEnglishNounPhrase({
    head: "father",
    plural: true,
    grammarIndex: grammar,
    resolve: () => ({ pyashSequence: ["hpap", "pu"] })
  });
  assert.deepEqual(alreadyPlural.pyashSequence, ["hpap", "pu"]);
});

test("vocab_suggest reports a unique dictionary alias", async () => {
  const lines = [];
  const result = await runVocabSuggest(["he"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.match(lines.join("\n"), /he: dictionary alias it -> htit \(English30k rank 10\)/u);
});

test("vocab_suggest reports an English grammatical construction", async () => {
  const lines = [];
  const result = await runVocabSuggest(["our"], {
    report: (line) => lines.push(String(line))
  });
  assert.equal(result.exitCode, 0);
  assert.match(lines.join("\n"), /our: grammar -> nyah ye \(English30k rank 66\)/u);
});

test("vocab_suggest reports Lord's Prayer pronouns and conjunctions through grammar particles", async () => {
  const expected = new Map([
    ["us", "nyah"],
    ["yours", "sa ye"],
    ["and", "wa"],
    ["also", "pcah"],
    ["but", "pyuh"]
  ]);
  for (const [surface, sequence] of expected) {
    const lines = [];
    const result = await runVocabSuggest([surface], {
      report: (line) => lines.push(String(line))
    });
    assert.equal(result.exitCode, 0);
    assert.match(lines.join("\n"), new RegExp(`${surface}: grammar -> ${sequence}`, "u"));
  }
});

test("ambiguous regular forms remain Housekeeper candidates", () => {
  const candidates = buildEnglishLemmaCandidates({
    sourceRows: [{ rank: 1, word: "leaves", score: 100 }],
    atomicEntries: [
      { en: "leaf", pya: "leaf" },
      { en: "leave", pya: "leave" }
    ]
  });
  assert.deepEqual(candidates.map((row) => row.lemma), ["leaf", "leave"]);
  assert.equal(candidates.every((row) => row.status === "candidate"), true);
  assert.equal(new Set(candidates.map((row) => row.id)).size, 2);
});
