import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

import {
  appendNovelCompoundSourceTerms,
  buildDerivedCompoundCoverage,
  loadCuratedCompoundDecompositions,
  renderDerivedCompoundCoveragePya,
  resolveDerivedCompound,
  segmentClosedCompound,
  segmentDelimitedCompound,
  sourceTermsFromDictionaryRows,
  sourceTermsFromEnglish30kRows,
  sourceTermsFromWordNetIndex,
  WORDNET_COMPOUND_PROVENANCE
} from "../program/library/translation/compound_coverage.mjs";
import { buildCompoundMorphologyIndex, loadCompoundMorphology } from "../program/library/translation/compound_morphology.mjs";
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "../program/library/translation/pyac_complexity.mjs";
import {
  classifyCompoundCoverage,
  createDefaultMindCompoundVerifier,
  createQueuedMindCompoundVerifier,
  createMindCompoundVerifier,
  parseCompoundVerificationResponse,
  verifyCompoundCoverage
} from "../program/library/translation/compound_verification.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { loadCoverage as loadDefaultCompoundCoverage } from "../command/compound_coverage.mjs";
import {
  loadCompoundLexicon,
  loadChineseCompoundLexicon,
  parseCompoundLexicon
} from "../program/library/translation/compound_lexicon.mjs";

const atomicEntries = [
  { en: "snake", pya: "snak" },
  { en: "bird", pya: "bird" },
  { en: "blue", pya: "plun" },
  { en: "print", pya: "trat" },
  { en: "black", pya: "hkis" },
  { en: "grass", pya: "kfac" },
  { en: "roots", pya: "kr6n" },
  { en: "newspaper", pya: "gzat" },
  { en: "meat", pya: "meat" },
  { en: "us", pya: "us" },
  { en: "covered", pya: "kwak" }
];

const layerIndex = {
  englishToPyash: new Map([
    ["snake", "snak"], ["bird", "bird"], ["blue", "plun"], ["print", "trat"],
    ["black", "hkis"], ["grass", "kfac"], ["roots", "kr6n"], ["newspaper", "gzat"],
    ["meat", "meat"], ["us", "us"], ["covered", "kwak"]
  ]),
  byWord: new Map([
    ["snak", 16], ["bird", 16], ["plun", 16], ["trat", 19],
    ["hkis", 16], ["kfac", 16], ["kr6n", 19], ["gzat", 24],
    ["meat", 16], ["us", 16], ["kwak", 24]
  ])
};

function withWordNetEvidence(record) {
  const components = record.componentGlosses;
  const componentSenseEvidence = components.map((component, index) => ({
    component,
    source: `n:${String(index + 1).padStart(8, "0")}-n`,
    lemmas: [component],
    definition: `a test sense for ${component}`
  }));
  const headSenseId = componentSenseEvidence.at(-1).source;
  return {
    ...record,
    componentSenseEvidence,
    targetSenseEvidence: [{
      source: "n:00000099-n",
      pos: "n",
      lemmas: [record.target],
      definition: `a test meaning of ${record.target}`,
      compatibleHeadSenseIds: [headSenseId]
    }]
  };
}

function acceptedCompoundResponse(record, overrides = {}) {
  const candidate = withWordNetEvidence(record);
  return JSON.stringify({
    verdict: "accept",
    candidateId: record.id,
    headKind: "lexical-head",
    targetSenseId: "n:00000099-n",
    headSenseId: candidate.componentSenseEvidence.at(-1).source,
    modifierSenseIds: candidate.componentSenseEvidence.slice(0, -1).map((sense) => sense.source),
    modifierEvidence: candidate.componentGlosses.slice(0, -1).map((component) => `${component} modifies the compound meaning`),
    modifierRelations: candidate.componentGlosses.slice(0, -1).map(() => "literal"),
    rationale: "the supplied senses compose the target meaning",
    ...overrides
  });
}

test("compound coverage keeps Pyash compounds head-final", () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [
      { target: "snake-bird", sourceSurfaces: { chinese: "蛇鸟" }, sourceMorphemesByLanguage: { chinese: ["蛇鸟"] } },
      { target: "bird-snake", sourceSurfaces: { chinese: "鸟蛇" }, sourceMorphemesByLanguage: { chinese: ["鸟蛇"] } },
      { target: "blueprint", sourceSurfaces: { chinese: "蓝图" } },
      { target: "newspaper" }
    ],
    curatedDecompositions: [
      {
        target: "snake-bird",
        sourceMorphemes: ["蛇", "鸟"],
        componentGlosses: ["snake", "bird"],
        evidence: "semantic head-final fixture"
      },
      {
        target: "bird-snake",
        sourceMorphemes: ["鸟", "蛇"],
        componentGlosses: ["bird", "snake"],
        evidence: "semantic head-final fixture"
      },
      {
        target: "blueprint",
        sourceMorphemes: ["蓝图"],
        componentGlosses: ["blue", "print"],
        evidence: "semantic head-final fixture"
      }
    ]
  });

  const snakeBird = coverage.accepted.find((entry) => entry.target === "snake-bird");
  const birdSnake = coverage.accepted.find((entry) => entry.target === "bird-snake");
  assert.deepEqual(snakeBird.pyashSequence, ["snak", "bird"]);
  assert.equal(snakeBird.head, "bird");
  assert.deepEqual(snakeBird.sourceMorphemes, ["蛇", "鸟"]);
  assert.deepEqual(snakeBird.sourceMorphemesByLanguage.chinese, ["蛇鸟"]);
  assert.deepEqual(birdSnake.pyashSequence, ["bird", "snak"]);
  assert.equal(birdSnake.head, "snake");
  assert.equal(snakeBird.sourceSurfaces.chinese, "蛇鸟");
  assert.equal(coverage.accepted.some((entry) => entry.target === "newspaper"), false);
  assert.equal(coverage.existingAtomic.some((entry) => entry.target === "newspaper"), true);
});

test("curated prayer constructions enter the shared compound catalog", async () => {
  const entries = await loadCompoundLexicon({
    url: new URL("../program/library/translation/compound_coverage_curated.pya", import.meta.url),
    name: "translation_compounds_derived_curated",
    language: "canonical"
  });
  const kingdom = entries.find((entry) => entry.surface === "kingdom");
  const debtor = entries.find((entry) => entry.surface === "debtor");
  const brainstorm = entries.find((entry) => entry.surface === "brainstorm");
  const include = entries.find((entry) => entry.surface === "include");

  assert.ok(kingdom);
  assert.deepEqual(kingdom.morphemes, ["king", "government"]);
  assert.deepEqual(kingdom.pyashSequence, ["hyap", "syun"]);
  assert.equal(kingdom.head, "government");
  assert.deepEqual(kingdom.componentRoles, ["lexeme", "lexeme"]);
  assert.equal(kingdom.provenance, "lord_prayer_lexicon.pya");

  assert.ok(debtor);
  assert.deepEqual(debtor.morphemes, ["debit", "agent"]);
  assert.deepEqual(debtor.pyashSequence, ["hdef", "hgen"]);
  assert.equal(debtor.head, "agent");
  assert.deepEqual(debtor.componentRoles, ["lexeme", "lexeme"]);
  assert.equal(debtor.provenance, "lord_prayer_lexicon.pya");

  assert.ok(brainstorm);
  assert.equal(brainstorm.specificAtom, "brain_storming");

  assert.ok(include);
  assert.deepEqual(include.morphemes, ["inside", "containing"]);
  assert.deepEqual(include.pyashSequence, ["lwak", "hzan"]);
  assert.deepEqual(include.componentLayers, [16, 24]);
  assert.equal(include.head, "containing");
  assert.match(include.evidence, /contain-within sense of include/u);
});

test("Chinese 混同 lowers to the head-final identity-confusion compound", async () => {
  const curated = await loadCuratedCompoundDecompositions();
  const identityConfusion = curated.find((entry) => entry.target === "identity-confusion");
  assert.ok(identityConfusion);
  assert.deepEqual(identityConfusion.aliases, ["confuse"]);
  assert.deepEqual(identityConfusion.componentGlosses, ["identity", "confusion"]);
  assert.deepEqual(identityConfusion.pyashSequence, ["hdif", "hbun"]);
  assert.deepEqual(identityConfusion.componentLayers, [24, 24]);
  assert.equal(identityConfusion.componentGlosses.at(-1), "confusion");
  assert.match(identityConfusion.evidence, /混同/u);

  const chinese = await loadChineseCompoundLexicon();
  const hunTong = chinese.find((entry) => entry.surface === "混同");
  assert.ok(hunTong);
  assert.equal(hunTong.target, "identity-confusion");
  assert.deepEqual(hunTong.sourceMorphemes, ["混", "同"]);
  assert.deepEqual(hunTong.componentGlosses, ["identity", "confusion"]);
  assert.deepEqual(hunTong.pyashSequence, ["hdif", "hbun"]);
  assert.deepEqual(hunTong.componentLayers, [24, 24]);
  assert.equal(hunTong.maxLayer, 24);
  assert.equal(hunTong.head, "confusion");
  assert.equal(hunTong.status, "lowered-compound");
});

test("compound coverage separates delimited use from accidental closed splits", () => {
  const atoms = new Map(atomicEntries.map((entry) => [entry.en, entry.pya]));
  assert.deepEqual(segmentDelimitedCompound("blue-print", atoms), [["blue", "print"]]);
  assert.deepEqual(segmentDelimitedCompound("covered", atoms), []);
  assert.deepEqual(segmentClosedCompound("blueprint", atoms), [["blue", "print"]]);
  assert.deepEqual(segmentClosedCompound("blackbluegrassroots", atoms), []);
  assert.deepEqual(segmentClosedCompound("blackbluegrassroots", atoms, { maximumParts: 4 }), [["black", "blue", "grass", "roots"]]);
  assert.deepEqual(segmentClosedCompound("meatus", atoms), []);
});

test("English30k compound inputs include closed spellings and skip phrases", () => {
  const sourceTerms = sourceTermsFromEnglish30kRows([
    { rank: 1, word: "blueprint" },
    { rank: 2, word: "blue print" },
    { rank: 3, word: "mother-in-law" },
    { rank: 4, word: "catfish" }
  ]);

  assert.deepEqual(sourceTerms.map((row) => row.target), ["blueprint", "catfish"]);
  assert.deepEqual(sourceTerms[0].sourceSurfaces, { english: "blueprint" });
  assert.equal(sourceTerms[0].provenance, "pyachso2n/English30k.txt");
  assert.throws(() => sourceTermsFromEnglish30kRows("blueprint"), /must be an array/u);
});

test("new compound sources do not mutate identities for existing lexical targets", () => {
  const sourceTerms = [{ target: "brainstorm", sourceSurfaces: { zh: "头脑风暴" } }];
  const curated = [{ target: "identity-confusion" }];
  const additions = [
    { target: "brainstorm", sourceSurfaces: { english: "brainstorm" } },
    { target: "identity-confusion", sourceSurfaces: { english: "identity confusion" } },
    { target: "pocketbook", sourceSurfaces: { english: "pocketbook" } },
    { target: "POCKETBOOK", sourceSurfaces: { english: "pocketbook" } }
  ];

  assert.deepEqual(
    appendNovelCompoundSourceTerms(sourceTerms, curated, additions),
    [{ target: "pocketbook", sourceSurfaces: { english: "pocketbook" } }]
  );
});

test("multiword WordNet lemmas yield review candidates from existing atom components", () => {
  const sourceTerms = sourceTermsFromWordNetIndex({
    bySynset: new Map([[
      "n:00000001-n",
      [{ lemma: "snake_bird" }, { lemma: "bird-snake" }, { lemma: "snake" }]
    ]])
  });

  assert.deepEqual(sourceTerms.map((row) => row.target), ["bird snake", "snake bird"]);
  assert.equal(sourceTerms[1].provenance, WORDNET_COMPOUND_PROVENANCE);
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    sourceTerms: [sourceTerms[1]],
    curatedDecompositions: [],
    morphologyEntries: [],
    layerIndex
  });

  assert.equal(coverage.accepted.length, 0);
  assert.equal(coverage.candidates.length, 1);
  assert.deepEqual(coverage.candidates[0].componentGlosses, ["snake", "bird"]);
  assert.equal(coverage.candidates[0].status, "candidate-closed");
  assert.match(coverage.candidates[0].evidence, /semantic composition requires review/u);
});

test("compound morphology keeps lexical heads separate from marked endings", async () => {
  const morphology = await loadCompoundMorphology();
  const index = buildCompoundMorphologyIndex({
    atomicEntries: pyashWords,
    morphologyEntries: morphology
  });
  assert.equal(index.get("ing").some((entry) => entry.kind === "derivational-ending"), true);
  assert.equal(index.get("ant").some((entry) => entry.kind === "derivational-ending"), true);

  const morphologyAtomicEntries = [
    ...atomicEntries,
    { en: "accept", pya: "akse" },
    { en: "ant", pya: "mrim" },
    { en: "zinc", pya: "zyik" },
    { en: "king", pya: "hyap" }
  ];
  const morphologyLayerIndex = {
    englishToPyash: new Map([
      ...layerIndex.englishToPyash,
      ["accept", "akse"], ["ant", "mrim"], ["zinc", "zyik"], ["king", "hyap"]
    ]),
    byWord: new Map([
      ...layerIndex.byWord,
      ["akse", 19], ["mrim", 19], ["zyik", 16], ["hyap", 24]
    ])
  };
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries: morphologyAtomicEntries,
    layerIndex: morphologyLayerIndex,
    morphologyEntries: [
      { surface: "ant", kind: "derivational-ending", evidence: "agentive or adjectival ending" },
      { surface: "ing", kind: "grammatical-ending", evidence: "English progressive or participial ending" }
    ],
    sourceTerms: [
      { target: "acceptant", sourceSurfaces: { french: "acceptant" } },
      { target: "zincking", sourceSurfaces: { interlingua: "zincage" } }
    ]
  });
  const acceptant = coverage.records.find((record) => record.target === "acceptant");
  const zincking = coverage.records.find((record) => record.target === "zincking");
  assert.deepEqual(acceptant.componentGlosses, ["accept", "ant"]);
  assert.equal(acceptant.morphologyStatus, "ending-overlap-review");
  assert.equal(acceptant.morphologySignals[0].ending, "ant");
  assert.equal(acceptant.morphologySignals[0].boundary, "component");
  assert.deepEqual(zincking.componentGlosses, ["zinc", "king"]);
  assert.equal(zincking.morphologyStatus, "ending-overlap-review");
  assert.equal(zincking.morphologySignals[0].ending, "ing");
  assert.equal(zincking.morphologySignals[0].boundary, "inside-component");

  const calls = [];
  const verified = await verifyCompoundCoverage([acceptant, zincking], {
    invoke: async ({ candidates }) => {
      calls.push(candidates[0].target);
      return JSON.stringify({
        verdict: "reject",
        candidateId: candidates[0].id,
        headKind: "derivational-ending",
        rationale: "the final spelling is an ending rather than a semantic subtype"
      });
    }
  });
  assert.equal(verified.accepted.length, 0);
  assert.deepEqual(
    verified.rejected.map((record) => record.target).sort(),
    ["acceptant", "zincking"]
  );
  assert.deepEqual(calls, ["zincking"]);
  assert.equal(verified.rejected.find((record) => record.target === "acceptant").verificationStatus, "rejected-deterministic");
});

test("compound resolver returns only usable records and preserves source order", () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [{ target: "blueprint", sourceSurfaces: { french: "plan" }, sourceMorphemesByLanguage: { french: ["plan"] } }],
    curatedDecompositions: [{
      target: "blueprint",
      componentGlosses: ["blue", "print"],
      sourceMorphemes: ["plan"]
    }]
  });
  const resolved = resolveDerivedCompound(coverage.records, { language: "french", surface: "plan" });
  assert.equal(resolved.target, "blueprint");
  assert.deepEqual(resolved.pyashSequence, ["plun", "trat"]);
  assert.equal(resolved.head, "print");
  assert.deepEqual(resolved.sourceMorphemesByLanguage.french, ["plan"]);
});

test("compound coverage renders a parser-readable durable catalog", () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [{
      target: "blueprint",
      sourceSurfaces: { chinese: "蓝图" },
      sourceMorphemesByLanguage: { chinese: ["蓝图"] }
    }],
    curatedDecompositions: [{
      target: "blueprint",
      componentGlosses: ["blue", "print"]
    }]
  });
  const parsed = parseCompoundLexicon(renderDerivedCompoundCoveragePya(coverage.records), {
    name: "translation_compounds_derived",
    language: "canonical"
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].head, "print");
  assert.deepEqual(parsed[0].componentRoles, ["lexeme", "lexeme"]);
  assert.equal(parsed[0].morphologyStatus, "lexical-compound");
  assert.equal(parsed[0].sourceSurfaces.chinese, "蓝图");
  assert.deepEqual(parsed[0].sourceMorphemesByLanguage.chinese, ["蓝图"]);
});

test("current dictionaries produce broad derived coverage", async (t) => {
  const layerDirectory = "/home/htaf/pyachso2n";
  try {
    await fs.access(`${layerDirectory}/16GlyphWordList.txt`);
  } catch {
    t.skip("pyachso2n source lists are unavailable");
    return;
  }
  const [manifest, dictionaries] = await Promise.all([
    loadPyacComplexityLayers(),
    Promise.all([
      ["chinese", "zh"],
      ["french", "fr"],
      ["russian", "ru"],
      ["hindi", "hi"],
      ["interlingua", "ia"]
    ].map(async ([language, field]) => ({
      language,
      field,
      rows: JSON.parse(await fs.readFile(new URL(`../caterer/pyac/lyac/dictionary_${field}.json`, import.meta.url), "utf8"))
    })))
  ]);
  const layerIndex = await loadPyacWordLayerIndex({ manifest, directory: layerDirectory });
  const englishToPyash = new Map();
  for (const entry of pyashWords) {
    if (entry?.en && entry?.pya && !englishToPyash.has(entry.en.toLowerCase())) {
      englishToPyash.set(entry.en.toLowerCase(), entry.pya);
    }
  }
  const sourceTerms = dictionaries.flatMap(({ language, field, rows }) => (
    sourceTermsFromDictionaryRows({
      language,
      surfaceField: field,
      rows,
      provenance: `caterer/pyac/lyac/dictionary_${field}.json`
    })
  ));
  const curatedDecompositions = await loadCuratedCompoundDecompositions();
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries: pyashWords,
    sourceTerms,
    curatedDecompositions,
    morphologyEntries: await loadCompoundMorphology(),
    layerIndex: { ...layerIndex, englishToPyash }
  });
  assert.equal(coverage.existingAtomic.length, 7831);
  assert.ok(coverage.accepted.length + coverage.candidates.length >= 811);
  const blueprint = coverage.accepted.find((entry) => entry.target === "blueprint");
  assert.deepEqual(blueprint.pyashSequence, ["plun", "trat"]);
  assert.equal(blueprint.head, "print");
  assert.equal(blueprint.sourceSurfaces.chinese, "蓝图");
  assert.deepEqual(blueprint.sourceMorphemesByLanguage.french, ["plan"]);
  const brainstorm = coverage.accepted.find((entry) => entry.target === "brainstorm");
  assert.equal(brainstorm.specificAtom, "brain_storming");
  const include = coverage.accepted.find((entry) => entry.target === "include");
  assert.deepEqual(include.aliases, ["involve"]);
  assert.deepEqual(include.pyashSequence, ["lwak", "hzan"]);
  const acceptant = coverage.candidates.find((entry) => entry.target === "acceptant");
  const zincking = coverage.candidates.find((entry) => entry.target === "zincking");
  assert.equal(acceptant.morphologyStatus, "ending-overlap-review");
  assert.equal(acceptant.morphologySignals.some((signal) => signal.ending === "ant"), true);
  assert.equal(zincking.morphologyStatus, "ending-overlap-review");
  assert.equal(zincking.morphologySignals.some((signal) => signal.ending === "ing"), true);
});

test("deterministic compounds bypass the LLM and closed candidates enter verification", async () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [
      { target: "blueprint", sourceSurfaces: { chinese: "蓝图" } },
      { target: "blackbird", sourceSurfaces: { chinese: "黑鸟" } }
    ],
    curatedDecompositions: [{
      target: "blueprint",
      componentGlosses: ["blue", "print"]
    }]
  });
  const classified = classifyCompoundCoverage(coverage.records);
  assert.equal(classified.deterministic.length, 1);
  assert.equal(classified.verificationCandidates.length, 1);
  assert.equal(classified.deterministic[0].verificationStatus, "accepted-deterministic");
  assert.equal(classified.verificationCandidates[0].verificationStatus, "uncertain-llm");

  const calls = [];
  const checkpoints = [];
  const verified = await verifyCompoundCoverage(coverage.records, {
    invoke: async ({ phase }) => {
      calls.push(phase);
      return JSON.stringify({
        verdict: "uncertain",
        rationale: "closed-word semantics remain uncertain"
      });
    },
    onRecord: async ({ record, records, total }) => {
      checkpoints.push({ id: record.id, count: records.length, total });
    }
  });
  assert.deepEqual(calls, ["verify"]);
  assert.equal(verified.accepted.length, 1);
  assert.equal(verified.uncertain.length, 1);
  assert.equal(checkpoints.length, coverage.records.length);
  assert.deepEqual(checkpoints.map(({ id }) => id), verified.records.map(({ id }) => id));
  assert.equal(checkpoints.at(-1).count, checkpoints.at(-1).total);
});

test("independent compound verification groups run concurrently and checkpoint in input order", async () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [
      { target: "blackbird", sourceSurfaces: { chinese: "黑鸟" } },
      { target: "grasssnake", sourceSurfaces: { chinese: "草蛇" } }
    ]
  });
  const candidates = coverage.records.map(withWordNetEvidence);
  assert.equal(candidates.length, 2);
  assert.equal(classifyCompoundCoverage(candidates).verificationCandidates.length, 2);

  let active = 0;
  let maxActive = 0;
  let started = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const checkpoints = [];
  const verified = await verifyCompoundCoverage(candidates, {
    parallelism: 2,
    invoke: async ({ record }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started += 1;
      if (started === 2) releaseBarrier();
      await Promise.race([barrier, new Promise((resolve) => setTimeout(resolve, 150))]);
      active -= 1;
      return acceptedCompoundResponse(record);
    },
    onRecord: async ({ record, records }) => {
      checkpoints.push({ id: record.id, ids: records.map((entry) => entry.id) });
    }
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(verified.records.map((record) => record.id), candidates.map((record) => record.id));
  assert.deepEqual(checkpoints.map(({ id }) => id), candidates.map((record) => record.id));
  assert.deepEqual(checkpoints.at(-1).ids, candidates.map((record) => record.id));
});

test("uncertain compound verification gets one bounded repair and accepts only a supplied candidate", async () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [{ target: "blackbird", sourceSurfaces: { chinese: "黑鸟" } }]
  });
  const candidate = withWordNetEvidence(coverage.records[0]);
  const calls = [];
  const verified = await verifyCompoundCoverage([candidate], {
    verifierName: "fixture compound verifier",
    maxRepairAttempts: 99,
    invoke: async ({ phase }) => {
      calls.push(phase);
      if (phase === "verify") return "model noise without a JSON decision";
      return acceptedCompoundResponse(candidate);
    }
  });
  assert.deepEqual(calls, ["verify", "repair"]);
  assert.equal(verified.accepted.length, 1);
  assert.equal(verified.accepted[0].status, "repaired-llm");
  assert.equal(verified.accepted[0].verificationAttempts, 2);
  assert.equal(verified.accepted[0].verifier, "fixture compound verifier");
  assert.deepEqual(verified.accepted[0].verificationModifierSenseIds, [candidate.componentSenseEvidence[0].source]);
  assert.deepEqual(verified.accepted[0].verificationModifierEvidence, ["black modifies the compound meaning"]);
  const parsed = parseCompoundLexicon(renderDerivedCompoundCoveragePya(verified.records, {
    name: "translation_compounds_verified"
  }), {
    name: "translation_compounds_verified",
    language: "canonical"
  });
  assert.equal(parsed[0].status, "repaired-llm");
  assert.equal(parsed[0].verificationAttempts, 2);
  assert.equal(parsed[0].verificationStatus, "repaired-llm");
  assert.equal(parsed[0].verificationHeadKind, "lexical-head");
  assert.equal(parsed[0].coverageStatus, "candidate-closed");
  assert.equal(parsed[0].deterministicChecks.semanticHead, true);
  assert.deepEqual(
    parseCompoundVerificationResponse(JSON.stringify({
      verdict: "accept",
      candidateId: "outside-candidate",
      headKind: "lexical-head",
      rationale: "invented"
    }), { candidates: [candidate] }),
    { valid: false, reason: "response candidateId is outside the supplied candidate set" }
  );
  const noisy = parseCompoundVerificationResponse(
    `model preamble\n${acceptedCompoundResponse(candidate)}\nmodel tail`,
    { candidates: [candidate] }
  );
  assert.equal(noisy.valid, true);
  assert.equal(noisy.verdict, "accept");
  const providerEnvelope = parseCompoundVerificationResponse(
    JSON.stringify({
      message: { content: acceptedCompoundResponse(candidate) }
    }),
    { candidates: [candidate] }
  );
  assert.equal(providerEnvelope.valid, true);
  assert.equal(providerEnvelope.verdict, "accept");
});

test("compound verification rejects an accepted response whose head is an ending", async () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [{ target: "blackbird", sourceSurfaces: { chinese: "黑鸟" } }]
  });
  const candidate = withWordNetEvidence(coverage.records[0]);
  const verified = await verifyCompoundCoverage([candidate], {
    invoke: async () => acceptedCompoundResponse(candidate, {
      headKind: "derivational-ending",
      rationale: "the spelling appears at the end"
    })
  });
  assert.equal(verified.accepted.length, 0);
  assert.equal(verified.rejected.length, 1);
  assert.equal(verified.rejected[0].verificationHeadKind, "derivational-ending");
  assert.match(verified.rejected[0].verificationRationale, /final component classified/u);
  assert.equal(parseCompoundVerificationResponse(JSON.stringify({
    verdict: "accept",
    candidateId: candidate.id,
    rationale: "missing head classification"
  }), { candidates: [candidate] }).valid, false);
});

test("compound mind verifier uses the existing Pyash mind write shape", async () => {
  const calls = [];
  const invoke = createMindCompoundVerifier({
    mindName: "compound verifier",
    outputName: "compound verifier output",
    maxTokens: 240,
    interpret: async (sentence) => calls.push(sentence),
    readText: () => "{\"verdict\":\"uncertain\",\"rationale\":\"needs more evidence\"}"
  });
  const output = await invoke({ prompt: "verify this compound" });
  assert.equal(output, "{\"verdict\":\"uncertain\",\"rationale\":\"needs more evidence\"}");
  assert.deepEqual(calls, [{
    mood: "do",
    be: "write",
    for: { name: "compound verifier" },
    ob: { text: "verify this compound" },
    to: { name: "compound verifier output", nameTypeWords: ["text"] },
    by: { num: 0 },
    atmost: { num: 240 }
  }]);
});

test("default compound coverage excludes deprecated duplicate atoms", async () => {
  const coverage = await loadDefaultCompoundCoverage();
  const deprecated = new Set(["drus", "gvin"]);

  assert.ok(!coverage.activeAtomicEntries.some((entry) => deprecated.has(entry.pya)));
  assert.ok(coverage.records.every((record) => !record.pyashSequence.some((word) => deprecated.has(word))));
  assert.ok(coverage.rejected.some((record) => (
    record.target === "given name" && record.status === "rejected-deprecated-component"
  )));
});

test("ambiguous candidate decompositions share one LLM decision", async () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [{ target: "blackbird", sourceSurfaces: { chinese: "黑鸟" } }]
  });
  const base = withWordNetEvidence(coverage.records[0]);
  const candidates = [
    { ...base, id: "candidate-blackbird-a", pyashSequence: ["hkis", "bird"] },
    { ...base, id: "candidate-blackbird-b", pyashSequence: ["black", "bird"] }
  ];
  const calls = [];
  const verified = await verifyCompoundCoverage(candidates, {
    invoke: async ({ phase, candidates: supplied }) => {
      calls.push({ phase, count: supplied.length });
      return acceptedCompoundResponse(supplied[1], {
        candidateId: "candidate-blackbird-b",
        rationale: "the second supplied interpretation matches the target"
      });
    }
  });
  assert.deepEqual(calls, [{ phase: "verify", count: 2 }]);
  assert.equal(verified.accepted.length, 1);
  assert.equal(verified.accepted[0].id, "candidate-blackbird-b");
  assert.equal(verified.rejected.length, 1);
  assert.equal(verified.rejected[0].id, "candidate-blackbird-a");
});

test("default compound verifier delegates through the existing mind runtime", async () => {
  const previousResponse = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify({
    message: { content: JSON.stringify({
      verdict: "uncertain",
      headKind: "uncertain",
      rationale: "fixture response reached the configured mind"
    }) }
  });
  forget();
  try {
    await interpret(parse('exists su name compound verifier be mind via state "qwen3:8b" ya'));
    const invoke = await createDefaultMindCompoundVerifier({
      mindName: "compound verifier",
      outputName: "compound verifier fixture output"
    });
    const response = await invoke({ prompt: "verify a compound" });
    assert.match(response, /fixture response reached the configured mind/u);
  } finally {
    forget();
    if (previousResponse === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = previousResponse;
  }
});

test("queued compound verifier expresses future GPU work through Pyash", async () => {
  const calls = [];
  const invoke = createQueuedMindCompoundVerifier({
    timeoutMs: 9000,
    parse: (source) => source,
    interpret: async (sentence) => {
      calls.push(sentence);
      if (sentence.includes("vyah start future be gpu mind do")) return { ob: { text: "queued" } };
      return { ob: { text: "success" }, result: { text: "{\"verdict\":\"uncertain\"}" } };
    }
  });
  const response = await invoke({
    prompt: "verify a compound",
    record: {
      id: "candidate-acid-rain",
      target: "acid-rain",
      pyashSequence: ["flat", "myic"],
      targetSenseEvidence: [{ source: "n:00000001-n", definition: "a precipitation sense" }],
      componentGlosses: ["acid", "rain"],
      componentSenseEvidence: [
        { component: "acid", source: "n:00000003-n", definition: "a corrosive substance" },
        { component: "rain", source: "n:00000002-n", definition: "water falling from clouds" }
      ]
    }
  });
  assert.equal(response, '{"verdict":"uncertain"}');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /vyah start future be gpu mind do/u);
  const jobSpec = JSON.parse(parse(calls[0]).ob.text);
  assert.equal(jobSpec.kind, "ollama-generate");
  assert.equal(jobSpec.think, false);
  assert.equal(jobSpec.options.num_predict, 288);
  assert.deepEqual(jobSpec.format.properties.candidateId.enum, ["", "candidate-acid-rain"]);
  assert.deepEqual(jobSpec.format.properties.targetSenseId.enum, ["", "n:00000001-n"]);
  assert.deepEqual(jobSpec.format.properties.headSenseId.enum, ["", "n:00000002-n"]);
  assert.deepEqual(jobSpec.format.properties.modifierSenseIds.items.enum, ["", "n:00000003-n"]);
  assert.deepEqual(jobSpec.format.properties.modifierRelations.items.enum, ["literal", "metaphorical", "associative", "uncertain"]);
  assert.ok(jobSpec.format.required.includes("targetSenseId"));
  assert.ok(jobSpec.format.required.includes("headSenseId"));
  assert.ok(jobSpec.format.required.includes("modifierSenseIds"));
  assert.ok(jobSpec.format.required.includes("modifierEvidence"));
  assert.ok(jobSpec.format.required.includes("modifierRelations"));
  assert.match(jobSpec.prompt, /verify a compound/u);
  assert.match(calls[0], /compound-verifier-v9-/u);
  assert.match(calls[1], /vyah await be gpu do/u);
  assert.match(calls[1], /during num 9000/u);
});
