import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranslationVocabularyVerificationPrompt,
  buildTranslationVocabularyInventory,
  createQueuedMindTranslationVocabularySubmitter,
  parseTranslationVocabularyVerificationResponse,
  reconcileTranslationVocabularyCandidates,
  submitTranslationVocabularyCandidates,
  translationVocabularyQueueHandle
} from "../program/verbs/exchange/translation/translation_vocabulary_queue.mjs";

const result = {
  language: "english",
  sourceHash: "source-hash",
  locator: "love.txt",
  vocabularyCandidates: [
    {
      id: "candidate-one",
      surface: "caring",
      kind: "lexical-gap",
      sourceRecordId: "record-one",
      context: ["Love involves caring for another."],
      candidateSequences: [],
      evidence: "source term remains unresolved"
    },
    {
      id: "candidate-two",
      surface: "caring",
      kind: "lexical-gap",
      sourceRecordId: "record-two",
      context: ["Love involves caring for another."],
      candidateSequences: [],
      evidence: "source term remains unresolved"
    }
  ]
};

test("vocabulary review prompt is bounded to supplied candidate evidence", () => {
  const inventory = buildTranslationVocabularyInventory({
    sourceText: "Love involves caring for another.",
    candidates: result.vocabularyCandidates,
    grammarEntries: [{
      surface: "another",
      kind: "pronoun",
      pyashSequence: ["hqok"],
      position: "standalone"
    }]
  });
  const prompt = buildTranslationVocabularyVerificationPrompt({
    language: "english",
    sourceText: "Love involves caring for another.",
    locator: "love.txt",
    candidates: result.vocabularyCandidates,
    inventory
  });
  assert.match(prompt, /Return exactly one JSON object/u);
  assert.match(prompt, /candidate-one/u);
  assert.match(prompt, /candidate-two/u);
  assert.match(prompt, /AUTHORITATIVE ENGLISH ANCHOR/u);
  assert.match(prompt, /\{"english":"love"\}/u);
  assert.match(prompt, /host pipeline derives the Pyash sequence/u);
  assert.match(prompt, /\{"english":"another","kind":"pronoun","position":"standalone"\}/u);
  assert.doesNotMatch(prompt, /"pyash":"pyan"/u);
  assert.doesNotMatch(prompt, /ollama/u);
});

test("vocabulary candidates share one deduplicated durable queue duty", async () => {
  const requests = [];
  const queued = await submitTranslationVocabularyCandidates({
    result,
    sourceText: "Love involves caring for another.",
    submittedAt: "2026-10-24T00:00:00.000Z",
    submit: async (request) => {
      requests.push(request);
      return { status: "queued" };
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].candidates.length, 1);
  assert.equal(queued.submittedCount, 1);
  assert.equal(queued.result.vocabularyQueue.status, "queued");
  assert.equal(queued.result.vocabularyCandidates[0].queue.handleId, queued.handleId);
  assert.equal(translationVocabularyQueueHandle({
    sourceHash: result.sourceHash,
    candidates: requests[0].candidates
  }), queued.handleId);
});

test("vocabulary duties keep semantic decisions small and retain every candidate", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    id: `candidate-${index}`,
    surface: `term-${index}`,
    kind: "lexical-gap",
    sourceRecordId: `record-${index}`,
    context: [`Term ${index} matters.`],
    evidence: "source term remains unresolved"
  }));
  const requests = [];
  const queued = await submitTranslationVocabularyCandidates({
    result: { ...result, sourceHash: "many-vocabulary-candidates", vocabularyCandidates: candidates },
    sourceText: "Term 0 matters. Term 1 matters. Term 2 matters. Term 3 matters. Term 4 matters.",
    submit: async (request) => {
      requests.push(request);
      return { status: "queued" };
    }
  });
  assert.deepEqual(requests.map((request) => request.candidates.length), [2, 2, 1]);
  assert.equal(queued.batches.length, 3);
  assert.equal(queued.queues.length, 3);
  assert.equal(queued.submittedCount, 5);
  assert.equal(new Set(queued.queues.map((queue) => queue.handleId)).size, 3);
  assert.deepEqual(queued.result.vocabularyCandidates.map((candidate) => candidate.queue.handleId), queued.handleIds
    .flatMap((handleId) => [handleId, handleId])
    .slice(0, 5));
});

test("default vocabulary submitter uses the Pyash future GPU duty", async () => {
  let sentence;
  const submit = createQueuedMindTranslationVocabularySubmitter({
    parse: (value) => value,
    interpret: async (value) => {
      sentence = value;
      return { ob: { text: "queued" } };
    }
  });
  const response = await submit({ handleId: "translation-vocabulary-test", prompt: "review" });
  assert.equal(response.status, "queued");
  assert.match(sentence, /vyah start future be gpu mind do/u);
  assert.match(sentence, /translation-vocabulary-test/u);
  assert.match(sentence, /think.*false/u);
  assert.match(sentence, /format.*candidates/u);
  assert.match(sentence, /num_predict.*4096/u);
});

test("vocabulary decisions are parsed and applied without a human approval step", () => {
  const candidate = result.vocabularyCandidates[0];
  const response = parseTranslationVocabularyVerificationResponse(JSON.stringify({
    verdict: "complete",
    candidates: [{
      id: candidate.id,
      status: "accept",
      targetEnglish: "caring",
      rationale: "the supplied inventory supports the caring atom"
    }]
  }), {
    candidates: [candidate],
    inventory: { entries: [{ english: "caring", pyash: ["twot"] }], grammar: [] },
    requireComplete: true
  });
  assert.equal(response.valid, true);
});

test("vocabulary parser extracts noisy provider JSON and rejects ungrounded sequences", () => {
  const candidate = result.vocabularyCandidates[0];
  const noisy = `worker preface\n${JSON.stringify({
    verdict: "complete",
    candidates: [{
      id: candidate.id,
      status: "accept",
      targetEnglish: "caring",
      rationale: "bounded inventory match"
    }]
  })}\nworker suffix`;
  const accepted = parseTranslationVocabularyVerificationResponse(noisy, {
    candidates: [candidate],
    inventory: { entries: [{ english: "caring", pyash: "twot" }], grammar: [] },
    requireComplete: true
  });
  assert.equal(accepted.valid, true);
  const sequenceResponse = parseTranslationVocabularyVerificationResponse(JSON.stringify({
    verdict: "complete",
    candidates: [{
      id: candidate.id,
      status: "accept",
      pyashSequence: ["twot"],
      rationale: "the model attempted to lower the answer"
    }]
  }), {
    candidates: [candidate],
    inventory: { entries: [{ english: "caring", pyash: ["twot"] }], grammar: [] },
    requireComplete: true
  });
  assert.equal(sequenceResponse.valid, false);
  assert.match(sequenceResponse.reason, /Pyash sequence is derived/u);
  const rejected = parseTranslationVocabularyVerificationResponse(JSON.stringify({
    verdict: "complete",
    candidates: [{
      id: candidate.id,
      status: "accept",
      targetEnglish: "outside-inventory",
      rationale: "ungrounded"
    }]
  }), {
    candidates: [candidate],
    inventory: { entries: [{ english: "caring", pyash: "twot" }], grammar: [] },
    requireComplete: true
  });
  assert.equal(rejected.valid, false);
  assert.match(rejected.reason, /inventory-backed targetEnglish/u);
});

test("vocabulary reconciliation repairs malformed model output through the same queue", async () => {
  const candidate = {
    id: "candidate-love",
    surface: "love",
    kind: "lexical-gap",
    sourceRecordId: "record-love",
    context: ["Love matters."],
    candidateSequences: [],
    evidence: "source term remains unresolved",
    status: "queued",
    queue: { handleId: "translation-vocabulary-reconcile", status: "queued" }
  };
  const baseResult = {
    ...result,
    sourceHash: "reconcile-source",
    vocabularyCandidates: [candidate],
    vocabularyQueue: candidate.queue,
    records: [{
      id: "record-love",
      status: "unresolved",
      unresolved: ["love"],
      tokens: [{ surface: "love", pyashSequence: [] }]
    }]
  };
  const submitted = [];
  const settled = await reconcileTranslationVocabularyCandidates({
    result: baseResult,
    sourceText: "Love matters.",
    candidates: [candidate],
    handleId: candidate.queue.handleId,
    awaitHandle: async (handleId) => handleId.endsWith("-retry-2")
      ? JSON.stringify({
        verdict: "complete",
        candidates: [{ id: candidate.id, status: "accept", targetEnglish: "love", rationale: "love is present in the inventory" }]
      })
      : JSON.stringify({ verdict: "complete", candidates: [{ id: candidate.id, status: "accept", rationale: "missing sequence" }] }),
    submit: async (request) => {
      submitted.push(request);
      return { status: "queued" };
    }
  });
  assert.equal(submitted.length, 1);
  assert.equal(settled.queue.outcome, "applied");
  assert.equal(settled.result.vocabularyCandidates[0].status, "accepted-llm");
  assert.deepEqual(settled.result.records[0].tokens[0].pyashSequence, ["pyan"]);
  assert.deepEqual(settled.result.records[0].unresolved, []);
});

test("vocabulary reconciliation keeps valid rows during bounded partial recovery", async () => {
  const candidates = [
    {
      id: "candidate-activity",
      surface: "activity",
      kind: "lexical-gap",
      sourceRecordId: "record-activity",
      context: ["Activity matters."],
      status: "queued"
    },
    {
      id: "candidate-unknown",
      surface: "unknown",
      kind: "lexical-gap",
      sourceRecordId: "record-unknown",
      context: ["Unknown matters."],
      status: "queued"
    }
  ];
  const queue = { handleId: "translation-vocabulary-partial", status: "queued" };
  const baseResult = {
    language: "english",
    sourceHash: "partial-vocabulary-source",
    locator: "partial.txt",
    vocabularyCandidates: candidates,
    vocabularyQueue: queue,
    records: candidates.map((candidate) => ({
      id: candidate.sourceRecordId,
      status: "unresolved",
      unresolved: [candidate.surface],
      tokens: [{ surface: candidate.surface, pyashSequence: [] }]
    }))
  };
  const settled = await reconcileTranslationVocabularyCandidates({
    result: baseResult,
    sourceText: "Activity matters. Unknown matters.",
    candidates,
    handleId: queue.handleId,
    maxRepairAttempts: 0,
    awaitHandle: async () => JSON.stringify({
      verdict: "complete",
      candidates: [
        {
          id: "candidate-activity",
          status: "accept",
          targetEnglish: "activity",
          rationale: "the activity atom is in the inventory"
        },
        {
          id: "candidate-unknown",
          status: "accept",
          rationale: "the provider omitted the mapping"
        }
      ]
    }),
    submit: async () => ({ status: "queued" })
  });
  assert.equal(settled.queue.outcome, "partial");
  assert.equal(settled.result.vocabularyCandidates[0].status, "accepted-llm");
  assert.equal(settled.result.vocabularyCandidates[1].status, "uncertain-llm");
  assert.deepEqual(settled.result.records[0].unresolved, []);
  assert.deepEqual(settled.result.records[1].unresolved, ["unknown"]);
});
