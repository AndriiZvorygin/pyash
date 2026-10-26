import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

import {
  buildDerivedCompoundCoverage,
  loadCuratedCompoundDecompositions,
  renderDerivedCompoundCoveragePya,
  resolveDerivedCompound,
  segmentClosedCompound,
  segmentDelimitedCompound,
  sourceTermsFromDictionaryRows
} from "../program/verbs/exchange/translation/compound_coverage.mjs";
import { buildCompoundMorphologyIndex, loadCompoundMorphology } from "../program/verbs/exchange/translation/compound_morphology.mjs";
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "../program/verbs/exchange/translation/pyac_complexity.mjs";
import {
  classifyCompoundCoverage,
  createDefaultMindCompoundVerifier,
  createQueuedMindCompoundVerifier,
  createMindCompoundVerifier,
  parseCompoundVerificationResponse,
  verifyCompoundCoverage
} from "../program/verbs/exchange/translation/compound_verification.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  loadCompoundLexicon,
  parseCompoundLexicon
} from "../program/verbs/exchange/translation/compound_lexicon.mjs";

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
    url: new URL("../program/verbs/exchange/translation/compound_coverage_curated.pya", import.meta.url),
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

test("compound coverage separates delimited use from accidental closed splits", () => {
  const atoms = new Map(atomicEntries.map((entry) => [entry.en, entry.pya]));
  assert.deepEqual(segmentDelimitedCompound("blue-print", atoms), [["blue", "print"]]);
  assert.deepEqual(segmentDelimitedCompound("covered", atoms), []);
  assert.deepEqual(segmentClosedCompound("blueprint", atoms), [["blue", "print"]]);
  assert.deepEqual(segmentClosedCompound("meatus", atoms), []);
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
        verdict: "accept",
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
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries: pyashWords,
    sourceTerms,
    curatedDecompositions: await loadCuratedCompoundDecompositions(),
    morphologyEntries: await loadCompoundMorphology(),
    layerIndex: { ...layerIndex, englishToPyash }
  });
  assert.equal(coverage.existingAtomic.length, 7831);
  assert.equal(coverage.accepted.length, 397);
  assert.equal(coverage.candidates.length, 412);
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

test("uncertain compound verification gets one bounded repair and accepts only a supplied candidate", async () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [{ target: "blackbird", sourceSurfaces: { chinese: "黑鸟" } }]
  });
  const candidate = coverage.records[0];
  const calls = [];
  const verified = await verifyCompoundCoverage(coverage.records, {
    verifierName: "fixture compound verifier",
    maxRepairAttempts: 99,
    invoke: async ({ phase }) => {
      calls.push(phase);
      if (phase === "verify") return "model noise without a JSON decision";
      return JSON.stringify({
        verdict: "accept",
        candidateId: candidate.id,
        headKind: "lexical-head",
        rationale: "the supplied components describe a bird modified by black"
      });
    }
  });
  assert.deepEqual(calls, ["verify", "repair"]);
  assert.equal(verified.accepted.length, 1);
  assert.equal(verified.accepted[0].status, "repaired-llm");
  assert.equal(verified.accepted[0].verificationAttempts, 2);
  assert.equal(verified.accepted[0].verifier, "fixture compound verifier");
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
    `model preamble\n${JSON.stringify({
      verdict: "accept",
      candidateId: candidate.id,
      headKind: "lexical-head",
      rationale: "the supplied candidate is grounded"
    })}\nmodel tail`,
    { candidates: [candidate] }
  );
  assert.equal(noisy.valid, true);
  assert.equal(noisy.verdict, "accept");
  const providerEnvelope = parseCompoundVerificationResponse(
    JSON.stringify({
      message: {
        content: JSON.stringify({
          verdict: "accept",
          candidateId: candidate.id,
          headKind: "lexical-head",
          rationale: "bounded provider envelope"
        })
      }
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
  const candidate = coverage.records[0];
  const verified = await verifyCompoundCoverage(coverage.records, {
    invoke: async () => JSON.stringify({
      verdict: "accept",
      candidateId: candidate.id,
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

test("ambiguous candidate decompositions share one LLM decision", async () => {
  const coverage = buildDerivedCompoundCoverage({
    atomicEntries,
    layerIndex,
    sourceTerms: [{ target: "blackbird", sourceSurfaces: { chinese: "黑鸟" } }]
  });
  const base = coverage.records[0];
  const candidates = [
    { ...base, id: "candidate-blackbird-a", pyashSequence: ["hkis", "bird"] },
    { ...base, id: "candidate-blackbird-b", pyashSequence: ["black", "bird"] }
  ];
  const calls = [];
  const verified = await verifyCompoundCoverage(candidates, {
    invoke: async ({ phase, candidates: supplied }) => {
      calls.push({ phase, count: supplied.length });
      return JSON.stringify({
        verdict: "accept",
        candidateId: "candidate-blackbird-b",
        headKind: "lexical-head",
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
    record: { id: "candidate-acid-rain", target: "acid-rain", pyashSequence: ["flat", "myic"] }
  });
  assert.equal(response, '{"verdict":"uncertain"}');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /vyah start future be gpu mind do/u);
  assert.match(calls[1], /vyah await be gpu do/u);
  assert.match(calls[1], /during num 9000/u);
});
