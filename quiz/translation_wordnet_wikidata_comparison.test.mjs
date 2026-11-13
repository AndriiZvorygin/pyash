import assert from "node:assert/strict";
import test from "node:test";

import { buildProgram } from "../program/program.mjs";
import {
  buildWikidataWordNetQuery,
  buildWordNetWikidataComparison,
  parseWikidataWordNetBindings,
  parseWordNetSenseCompoundWorklist,
  renderWordNetWikidataComparisonPya,
  selectCachedQwenSample,
  wordNet31IdForOpenSynset
} from "../program/library/translation/wordnet_wikidata_comparison.mjs";

const senseRows = [
  {
    senseId: "n:02086723-n",
    pos: "n",
    synset: "02086723-n",
    lemma: "dog",
    lemmas: ["dog"],
    gloss: "a domesticated canine",
    frequencyRank: 1
  },
  {
    senseId: "n:02086724-n",
    pos: "n",
    synset: "02086724-n",
    lemma: "dogs",
    lemmas: ["dogs"],
    gloss: "plural canine",
    frequencyRank: 2
  }
];

const worklistFixture = [
  "su name translation_wordnet_sense_compound_worklist be map def",
  'su text "meta:source-hash" ob text "source-hash-1" ya',
  'su text "meta:worklist-hash" ob text "worklist-hash-1" ya',
  ...senseRows.map((row) => `su text ${JSON.stringify(row.senseId)} ob text ${JSON.stringify(JSON.stringify(row))} ya`),
  "prah"
].join("\n");

test("parse active sense worklist and select cached translations in worklist order", () => {
  const worklist = parseWordNetSenseCompoundWorklist(worklistFixture);
  const cache = {
    bySense: new Map([
      ["n:02086723-n", {
        senseId: "n:02086723-n",
        wordNetHash: "source-hash-1",
        status: "complete",
        translations: [{ language: "chinese", surface: "狗", composition: "simple" }]
      }],
      ["n:02086724-n", {
        senseId: "n:02086724-n",
        wordNetHash: "old-source-hash",
        status: "complete",
        translations: [{ language: "chinese", surface: "狗们", composition: "simple" }]
      }]
    ])
  };

  assert.equal(worklist.metadata["source-hash"], "source-hash-1");
  assert.equal(worklist.rows.length, 2);
  assert.deepEqual(selectCachedQwenSample({ worklist, cache }), [
    { sense: worklist.rows[0], translation: cache.bySense.get("n:02086723-n") }
  ]);
});

test("WordNet 3.1 crosswalk requires an exact offset and a shared lemma", () => {
  const sense = {
    senseId: "n:02086723-n",
    synset: "02086723-n",
    lemmas: ["dog", "domestic dog"]
  };
  const index = { bySynset: new Map([["n:02086723", ["dog%1:05:00::", "domestic_dog%1:05:00::"]]]) };

  assert.deepEqual(wordNet31IdForOpenSynset(sense, index), {
    status: "matched",
    p8814Id: "02086723-n",
    matchedLemmas: ["dog", "domestic dog"]
  });
  assert.equal(wordNet31IdForOpenSynset({ ...sense, lemmas: ["hound"] }, index).status, "lemma-mismatch");
  assert.equal(wordNet31IdForOpenSynset({ ...sense, synset: "bad-id" }, index).status, "invalid-synset-id");
  assert.equal(wordNet31IdForOpenSynset({
    senseId: "s:00911194-s",
    synset: "00911194-s",
    lemmas: ["becoming"]
  }, { bySynset: new Map([["s:00911194", ["becoming%5:00:00:becoming:00"]]]) }).status, "matched");
});

test("build exact P8814 query for the active seven translation languages", () => {
  const query = buildWikidataWordNetQuery(["02086723-n"]);
  assert.match(query, /wdt:P8814/u);
  assert.doesNotMatch(query, /P5063/u);
  assert.match(query, /"02086723-n"/u);
  for (const language of ["zh", "hi", "ru", "de", "ja", "ko", "fi"]) {
    assert.match(query, new RegExp(`LANGMATCHES\\(\\?labelLanguage, "${language}"\\)`, "u"));
  }
  assert.throws(() => buildWikidataWordNetQuery(["not-a-synset"]), /valid WordNet 3\.1 synset IDs/u);
});

test("group Wikidata entities without losing multiple exact mappings or language labels", () => {
  const grouped = parseWikidataWordNetBindings({
    results: {
      bindings: [
        {
          synsetId: { value: "02086723-n" },
          entity: { value: "http://www.wikidata.org/entity/Q144" },
          label: { value: "dog" },
          labelLanguage: { value: "en" },
          description: { value: "domesticated mammal" }
        },
        {
          synsetId: { value: "02086723-n" },
          entity: { value: "http://www.wikidata.org/entity/Q144" },
          label: { value: "狗" },
          labelLanguage: { value: "zh-hans" }
        },
        {
          synsetId: { value: "02086723-n" },
          entity: { value: "http://www.wikidata.org/entity/Q55983715" },
          label: { value: "狗" },
          labelLanguage: { value: "zh" }
        }
      ]
    }
  }, { expectedSynsetIds: ["02086723-n"] });

  const entities = grouped.get("02086723-n");
  assert.equal(entities.length, 2);
  assert.equal(entities[0].entityId, "Q144");
  assert.deepEqual(entities[0].labels.map(({ language, languageCode, value }) => ({ language, languageCode, value })), [
    { language: "chinese", languageCode: "zh-hans", value: "狗" },
    { language: "english", languageCode: "en", value: "dog" }
  ]);
  assert.deepEqual(entities[0].englishDescriptions, ["domesticated mammal"]);
  assert.equal(entities[1].entityId, "Q55983715");
});

test("compare label availability and exact surface overlap without claiming semantic quality", () => {
  const rows = buildWordNetWikidataComparison({
    runId: "sample-run",
    worklistHash: "worklist-hash-1",
    sourceHash: "source-hash-1",
    sample: [{
      sense: {
        senseId: "n:02086723-n",
        synset: "02086723-n",
        lemma: "dog",
        lemmas: ["dog"],
        gloss: "a domesticated canine",
        frequencyRank: 1
      },
      translation: {
        status: "complete",
        translations: [
          { language: "chinese", surface: "狗", composition: "simple" },
          { language: "german", surface: "Hund", composition: "simple" }
        ]
      }
    }],
    crosswalkBySense: new Map([["n:02086723-n", {
      status: "matched",
      p8814Id: "02086723-n",
      matchedLemmas: ["dog"]
    }]]),
    entitiesBySynset: new Map([["02086723-n", [{
      entityId: "Q144",
      uri: "http://www.wikidata.org/entity/Q144",
      labels: [
        { language: "chinese", languageCode: "zh", value: "狗" },
        { language: "german", languageCode: "de", value: "Hund" }
      ],
      englishDescriptions: ["domesticated mammal"]
    }]]])
  });

  assert.equal(rows.summary.worklistSampleCount, 1);
  assert.equal(rows.summary.exactP8814Matches, 1);
  assert.equal(rows.summary.labelsByLanguage.chinese, 1);
  assert.equal(rows.summary.exactSurfaceOverlapsByLanguage.chinese, 1);
  assert.equal(rows.summary.exactSurfaceOverlapsByLanguage.german, 1);
  assert.equal(rows.records[0].comparison.chinese.exactSurfaceOverlap, true);
  assert.equal(rows.records[0].comparison.finnish.wikidataLabels.length, 0);
  const rendered = renderWordNetWikidataComparisonPya(rows);
  assert.match(rendered, /wordnet-wikidata-qwen-sample-v1/u);
  assert.match(rendered, /Q144/u);
  const parsed = buildProgram(rendered).sentences;
  assert.equal(parsed[0].su.name, "translation_wordnet_wikidata_comparison");
  assert.equal(parsed.at(-1).mood, "prah");
});
