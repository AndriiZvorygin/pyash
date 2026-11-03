import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEnglishAtomLemmaAssignments,
  buildEnglishAtomLemmaCatalogAdditions,
  loadEnglishAtomLemmaScanConfig
} from "../program/library/translation/english_atom_lemma_scan.mjs";
import {
  buildEnglishLemmaIndex,
  parseEnglishLemmaCatalog
} from "../program/library/translation/english_lemmas.mjs";

function wordnetIndex(lemmas) {
  const rows = new Map(Object.entries(lemmas));
  return {
    lookup(value) {
      return rows.get(value) ?? [];
    }
  };
}

test("atom lemma scan loads the Pyash assignment policy", async () => {
  const config = await loadEnglishAtomLemmaScanConfig();
  assert.equal(config.format, "english-atom-lemma-scan-v1");
  assert.match(config["grammar-lemma-collision-policy"], /grammar entry/u);
});

test("atom lemma scan classifies grammar, inflections, duplicates, and self lemmas", () => {
  const atoms = [
    { en: "walk", pya: "walk16" },
    { en: "walked", pya: "walk28" },
    { en: "bits", pya: "bits28" },
    { en: "six", pya: "six16" },
    { en: "sixes", pya: "six28" },
    { en: "news", pya: "news28" },
    { en: "peter", pya: "peter24" },
    { en: "future_tense_", pya: "future16" },
    { en: "blue", pya: "blue16" }
  ];
  const atomCoverage = [
    { id: "atom:walk28", pyac: "walk28", labels: ["walked"], status: "no-direct-wordnet-candidate" },
    { id: "atom:bits28", pyac: "bits28", labels: ["bits"], status: "no-direct-wordnet-candidate" },
    { id: "atom:six28", pyac: "six28", labels: ["sixes"], status: "no-direct-wordnet-candidate" },
    { id: "atom:news28", pyac: "news28", labels: ["news"], status: "no-direct-wordnet-candidate" },
    { id: "atom:peter24", pyac: "peter24", labels: ["peter"], status: "no-direct-wordnet-candidate" },
    { id: "atom:future16", pyac: "future16", labels: ["future_tense_"], status: "no-direct-wordnet-candidate" },
    { id: "atom:blue16", pyac: "blue16", labels: ["blue"], status: "no-direct-wordnet-candidate" }
  ];
  const assignments = buildEnglishAtomLemmaAssignments({
    atomCoverage,
    atomicEntries: atoms,
    wordnetIndex: wordnetIndex({
      walk: [{ pos: "v" }],
      bit: [{ pos: "n" }],
      six: [{ pos: "n" }],
      peter: [{ pos: "n" }],
      pet: [{ pos: "n" }, { pos: "v" }],
      news: [{ pos: "n" }],
      new: [{ pos: "a" }],
      blue: [{ pos: "a" }]
    }),
    rankForEnglish: (word) => ({ walk: 100, bit: 200, six: 250 }[word] ?? Number.POSITIVE_INFINITY),
    layerByWord: new Map([
      ["walk16", 16], ["walk28", 28], ["bits28", 28], ["six16", 16], ["six28", 28],
      ["news28", 28], ["peter24", 24], ["future16", 16], ["blue16", 16]
    ])
  });
  const bySurface = new Map(assignments.flatMap((row) => row.assignments.map((entry) => [entry.surface, entry])));

  assert.equal(assignments.length, atomCoverage.length);
  assert.equal(bySurface.get("future_tense_").kind, "grammar-word");
  assert.equal(bySurface.get("walked").kind, "duplicate");
  assert.equal(bySurface.get("walked").canonicalPyac, "walk16");
  assert.equal(bySurface.get("bits").kind, "lemma");
  assert.equal(bySurface.get("bits").lemma, "bit");
  assert.equal(bySurface.get("bits").canonicalPyac, "bits28");
  assert.equal(bySurface.get("sixes").kind, "duplicate");
  assert.equal(bySurface.get("sixes").canonicalPyac, "six16");
  assert.equal(bySurface.get("news").lemma, "news");
  assert.equal(bySurface.get("peter").lemma, "peter");
  assert.equal(bySurface.get("blue").lemma, "blue");

  const additions = buildEnglishAtomLemmaCatalogAdditions(assignments, [], atoms);
  assert.deepEqual(additions.map((row) => row.surface).sort(), ["bit", "bits", "sixes", "walked"]);
  assert.equal(additions.find((row) => row.surface === "bit").kind, "anchor");
  assert.ok(additions.filter((row) => ["sixes", "walked"].includes(row.surface))
    .every((row) => row.status === "deprecated-duplicate"));
});

test("atom lemma scan keeps lexical WordNet entries from being reinterpreted as suffix forms", () => {
  const assignments = buildEnglishAtomLemmaAssignments({
    atomCoverage: [{ id: "atom:news", pyac: "news28", labels: ["news"], status: "no-direct-wordnet-candidate" }],
    atomicEntries: [{ en: "news", pya: "news28" }],
    wordnetIndex: wordnetIndex({ news: [{ pos: "n" }], new: [{ pos: "a" }] }),
    rankForEnglish: () => 100,
    layerByWord: new Map([["news28", 28]])
  });

  assert.equal(assignments[0].assignments[0].kind, "lemma");
  assert.equal(assignments[0].assignments[0].lemma, "news");
  assert.equal(assignments[0].assignments[0].method, "surface-lemma");
});

test("atom lemma scan preserves curated irregular lemmas with distinct lexical atoms", () => {
  const assignments = buildEnglishAtomLemmaAssignments({
    atomCoverage: [{ id: "atom:saw", pyac: "saw28", labels: ["saw"], status: "no-direct-wordnet-candidate" }],
    atomicEntries: [
      { en: "see", pya: "see16" },
      { en: "saw", pya: "saw28" }
    ],
    lemmaEntries: [{
      surface: "saw",
      lemma: "see",
      kind: "irregular",
      status: "accepted-curated",
      evidence: "English past form of see"
    }],
    wordnetIndex: wordnetIndex({ see: [{ pos: "v" }], saw: [{ pos: "n" }] }),
    rankForEnglish: (word) => ({ see: 100, saw: 500 }[word] ?? Number.POSITIVE_INFINITY),
    layerByWord: new Map([["see16", 16], ["saw28", 28]])
  });

  assert.equal(assignments[0].assignments[0].kind, "lemma");
  assert.equal(assignments[0].assignments[0].lemma, "see");
  assert.equal(assignments[0].assignments[0].canonicalPyac, "see16");
  assert.equal(assignments[0].assignments[0].method, "accepted-lemma-catalog");
});

test("atom lemma scan does not create a lexical anchor that shadows a grammar entry", () => {
  const additions = buildEnglishAtomLemmaCatalogAdditions([
    {
      id: "atom:canning",
      pyac: "canning28",
      labels: ["canning"],
      assignments: [{
        surface: "canning",
        kind: "lemma",
        lemma: "can",
        canonicalEnglish: "canning",
        canonicalPyac: "canning28",
        method: "wordnet-regular-inflection",
        rule: "present-participle-ing"
      }]
    }
  ], [], [{ en: "canning", pya: "canning28" }], [{ surface: "can" }]);

  assert.deepEqual(additions.map((entry) => entry.surface), ["canning"]);
  assert.equal(additions[0].kind, "inflectional");
});

test("atom lemma scan keeps ambiguous unranked forms as their own lemma", () => {
  const assignments = buildEnglishAtomLemmaAssignments({
    atomCoverage: [{ id: "atom:panties", pyac: "panties", labels: ["panties"], status: "no-direct-wordnet-candidate" }],
    atomicEntries: [{ en: "panties", pya: "panties" }],
    wordnetIndex: wordnetIndex({ panty: [{ pos: "n" }], pantie: [{ pos: "n" }] }),
    rankForEnglish: () => Number.POSITIVE_INFINITY,
    layerByWord: new Map([["panties", 28]])
  });

  assert.equal(assignments[0].assignments[0].kind, "lemma");
  assert.equal(assignments[0].assignments[0].lemma, "panties");
  assert.deepEqual(assignments[0].assignments[0].candidates.map((row) => row.lemma).sort(), ["pantie", "panty"]);
});

test("lemma catalog allows POS-scoped homographs and resolves the matching mapping", () => {
  const payload = {
    surface: "becoming",
    lemma: "become",
    canonicalEnglish: "become",
    kind: "inflectional",
    status: "accepted-curated",
    partOfSpeech: "v",
    evidence: "The verb form maps to the verb lemma."
  };
  const catalog = parseEnglishLemmaCatalog([
    "su name translation_english30k_lemmas be map def",
    'su text "format" ob text "english-lemma-v1" ya',
    `su text "becoming" ob text ${JSON.stringify(JSON.stringify(payload))} ya`,
    "prah"
  ].join("\n"));
  const index = buildEnglishLemmaIndex({
    atomicEntries: [
      { en: "becoming", pya: "hbec" },
      { en: "become", pya: "kbe2" }
    ],
    catalogEntries: catalog.entries
  });

  assert.equal(index.resolve("becoming").canonicalEnglish, "becoming");
  assert.equal(index.resolve("becoming", { partOfSpeech: "a" }).canonicalEnglish, "becoming");
  assert.equal(index.resolve("becoming", { partOfSpeech: "v" }).canonicalEnglish, "become");
  assert.equal(index.resolve("becoming", { pos: "v" }).lemma, "become");
});

test("lemma index keeps adjective satellite mappings separate from adjective mappings", () => {
  const row = (partOfSpeech) => JSON.stringify({
    surface: "only",
    lemma: "only",
    canonicalEnglish: "only",
    kind: "anchor",
    status: "accepted-curated",
    partOfSpeech,
    evidence: `fixture ${partOfSpeech} mapping`
  });
  const catalog = parseEnglishLemmaCatalog([
    "su name translation_english30k_lemmas be map def",
    'su text "format" ob text "english-lemma-v1" ya',
    `su text "only" ob text ${JSON.stringify(row("a"))} ya`,
    `su text "only" ob text ${JSON.stringify(row("s"))} ya`,
    "prah"
  ].join("\n"));
  const index = buildEnglishLemmaIndex({
    atomicEntries: [{ en: "only", pya: "htun" }],
    catalogEntries: catalog.entries
  });

  assert.equal(index.resolve("only", { partOfSpeech: "a" }).partOfSpeech, "a");
  assert.equal(index.resolve("only", { partOfSpeech: "s" }).partOfSpeech, "s");
});

test("lemma catalog rejects duplicate rows for the same surface and part of speech", () => {
  const row = (partOfSpeech) => JSON.stringify({
    surface: "becoming",
    lemma: "become",
    canonicalEnglish: "become",
    kind: "inflectional",
    status: "accepted-curated",
    ...(partOfSpeech ? { partOfSpeech } : {}),
    evidence: "fixture"
  });
  assert.throws(() => parseEnglishLemmaCatalog([
    "su name translation_english30k_lemmas be map def",
    'su text "format" ob text "english-lemma-v1" ya',
    `su text "becoming" ob text ${JSON.stringify(row("v"))} ya`,
    `su text "becoming" ob text ${JSON.stringify(row("v"))} ya`,
    "prah"
  ].join("\n")), /surface and part of speech/u);
});
