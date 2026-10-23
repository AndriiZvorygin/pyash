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
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "../program/verbs/exchange/translation/pyac_complexity.mjs";
import {
  classifyCompoundCoverage,
  createDefaultMindCompoundVerifier,
  createMindCompoundVerifier,
  parseCompoundVerificationResponse,
  verifyCompoundCoverage
} from "../program/verbs/exchange/translation/compound_verification.mjs";
import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import { parseCompoundLexicon } from "../program/verbs/exchange/translation/compound_lexicon.mjs";

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

test("compound coverage separates delimited use from accidental closed splits", () => {
  const atoms = new Map(atomicEntries.map((entry) => [entry.en, entry.pya]));
  assert.deepEqual(segmentDelimitedCompound("blue-print", atoms), [["blue", "print"]]);
  assert.deepEqual(segmentDelimitedCompound("covered", atoms), []);
  assert.deepEqual(segmentClosedCompound("blueprint", atoms), [["blue", "print"]]);
  assert.deepEqual(segmentClosedCompound("meatus", atoms), []);
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
    layerIndex: { ...layerIndex, englishToPyash }
  });
  assert.equal(coverage.existingAtomic.length, 7830);
  assert.equal(coverage.accepted.length, 393);
  assert.equal(coverage.candidates.length, 411);
  const blueprint = coverage.accepted.find((entry) => entry.target === "blueprint");
  assert.deepEqual(blueprint.pyashSequence, ["plun", "trat"]);
  assert.equal(blueprint.head, "print");
  assert.equal(blueprint.sourceSurfaces.chinese, "蓝图");
  assert.deepEqual(blueprint.sourceMorphemesByLanguage.french, ["plan"]);
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
  assert.equal(parsed[0].coverageStatus, "candidate-closed");
  assert.equal(parsed[0].deterministicChecks.semanticHead, true);
  assert.deepEqual(
    parseCompoundVerificationResponse(JSON.stringify({
      verdict: "accept",
      candidateId: "outside-candidate",
      rationale: "invented"
    }), { candidates: [candidate] }),
    { valid: false, reason: "response candidateId is outside the supplied candidate set" }
  );
  const noisy = parseCompoundVerificationResponse(
    `model preamble\n${JSON.stringify({
      verdict: "accept",
      candidateId: candidate.id,
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
          rationale: "bounded provider envelope"
        })
      }
    }),
    { candidates: [candidate] }
  );
  assert.equal(providerEnvelope.valid, true);
  assert.equal(providerEnvelope.verdict, "accept");
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
