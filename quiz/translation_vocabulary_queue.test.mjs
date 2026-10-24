import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranslationVocabularyVerificationPrompt,
  buildTranslationVocabularyInventory,
  createQueuedMindTranslationVocabularySubmitter,
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
  assert.match(prompt, /AUTHORITATIVE PYASH/u);
  assert.match(prompt, /love.*pyan/u);
  assert.match(prompt, /deterministic parser's candidate sequences are heuristics/u);
  assert.match(prompt, /another.*hqok/u);
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
});
