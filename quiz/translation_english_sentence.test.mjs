import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeDefaultEnglishSentence,
  analyzeEnglishSentence,
  applyEnglishSentenceCandidate,
  resolveEnglishSentence
} from "../program/verbs/exchange/translation/english_sentence.mjs";
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

test("sentence analysis selects simple past and emits the root plus tense particle", () => {
  const result = analyzeEnglishSentence("I walked", { resolveWord: fixtureResolver() });
  assert.equal(result.status, "resolved");
  assert.equal(result.pyash, "su name mi be pfin ki ya");
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
  assert.equal(result.pyash, "su name mi be pfin pfih ra ya");
  assert.deepEqual(result.verbPhrase.markerNames, ["progressive_aspect_", "present_tense_"]);
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
  assert.equal(resolved.pyash, "su name mi be pfin pfih ya");
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
