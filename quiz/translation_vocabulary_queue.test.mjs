import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranslationVocabularyVerificationPrompt,
  buildTranslationVocabularyInventory,
  applyTranslationVocabularyVerificationResponse,
  createQueuedMindTranslationVocabularySubmitter,
  parseTranslationVocabularyVerificationResponse,
  reconcileTranslationVocabularyCandidates,
  submitTranslationVocabularyCandidates,
  translationVocabularyQueueHandle
} from "../program/library/translation/translation_vocabulary_queue.mjs";

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

test("vocabulary review prompt carries the selected WordNet sense to anchor selection", () => {
  const candidate = {
    id: "wordnet-attachment:feel",
    surface: "feel",
    kind: "wordnet-sense-attachment",
    sourceRecordId: "record-feel",
    context: ["People feel love."],
    senseId: "v:01775456",
    sense: {
      pos: "v",
      synset: "01775456",
      lemmas: ["feel", "experience"],
      gloss: "undergo an emotional state"
    },
    anchorCandidates: [{
      target: "activity",
      pyashSequence: ["twot"],
      targetKind: "atom",
      targetId: "atom:twot",
      selectable: true,
      evidence: "fixture WordNet relation reaches activity"
    }],
    evidence: "selected WordNet sense v:01775456; undergo an emotional state"
  };
  const prompt = buildTranslationVocabularyVerificationPrompt({
    language: "english",
    sourceText: candidate.context[0],
    locator: "love.txt",
    candidates: [candidate],
    inventory: { entries: [{ english: "activity", pyash: ["twot"] }], grammar: [] }
  });
  assert.match(prompt, /authoritative meaning for this occurrence/u);
  assert.match(prompt, /do not re-disambiguate the source word/u);
  assert.match(prompt, /may differ from the source surface and WordNet lemma/u);
  assert.match(prompt, /"selectedSenseId":"v:01775456"/u);
  assert.match(prompt, /"gloss":"undergo an emotional state"/u);
  assert.match(prompt, /"anchorOptions":\["activity"\]/u);
});

test("vocabulary review preserves a complete composed anchor over its components", () => {
  const candidate = {
    id: "wordnet-attachment:lust",
    surface: "lust",
    kind: "wordnet-sense-attachment",
    sourceRecordId: "record-lust",
    context: ["Lust means strong sexual desire."],
    senseId: "n:07504854-n",
    sense: {
      pos: "n",
      synset: "07504854-n",
      lemmas: ["lust"],
      gloss: "a strong sexual desire"
    },
    anchorCandidates: [{
      target: "sexual desire",
      pyashSequence: ["hjon", "twin"],
      kind: "compound-composition",
      targetKind: "compound",
      targetId: "compound:hjon+twin",
      selectable: true,
      componentTargets: ["sexual", "desire"],
      evidence: "WordNet hypernym reaches sexual desire; composed from covered components sexual desire"
    }, {
      target: "sexual",
      pyashSequence: ["hjon"],
      targetKind: "atom",
      targetId: "atom:hjon",
      selectable: false,
      evidence: "WordNet relation component"
    }, {
      target: "desire",
      pyashSequence: ["twin"],
      targetKind: "atom",
      targetId: "atom:twin",
      selectable: false,
      evidence: "WordNet relation component"
    }],
    evidence: "selected WordNet sense n:07504854-n"
  };
  const prompt = buildTranslationVocabularyVerificationPrompt({
    language: "english",
    sourceText: candidate.context[0],
    locator: "love.txt",
    candidates: [candidate],
    inventory: {
      entries: [
        { english: "sexual desire", pyash: ["hjon", "twin"] },
        { english: "sexual", pyash: ["hjon"] },
        { english: "desire", pyash: ["twin"] }
      ],
      grammar: []
    }
  });
  assert.match(prompt, /complete multiword anchor/u);
  assert.match(prompt, /"anchorOptions":\["sexual desire"\]/u);
  assert.match(prompt, /"components":\["sexual","desire"\]/u);
});

test("sense linking excludes related atoms unless the linker marks them selectable", () => {
  const candidate = {
    id: "wordnet-attachment:attract",
    surface: "attracted",
    kind: "wordnet-sense-attachment",
    senseId: "v:attract",
    sense: { pos: "v", synset: "attract", lemmas: ["attract"], gloss: "draw toward" },
    context: ["Being attracted describes a feeling."],
    anchorCandidates: [{
      target: "charm",
      pyashSequence: ["crak"],
      targetKind: "atom",
      targetId: "atom:crak",
      selectable: false,
      kind: "relation",
      evidence: "WordNet relation reaches charm"
    }]
  };
  const inventory = buildTranslationVocabularyInventory({
    sourceText: candidate.context[0],
    candidates: [candidate]
  });
  const prompt = buildTranslationVocabularyVerificationPrompt({
    language: "english",
    sourceText: candidate.context[0],
    locator: "love.txt",
    candidates: [candidate],
    inventory
  });
  assert.match(prompt, /"anchorOptions":\[\]/u);
  assert.doesNotMatch(prompt, /"target":"charm"/u);
  assert.doesNotMatch(prompt, /"english":"charm"/u);
});

test("accepted sense vocabulary preserves the selected atom or compound identity", () => {
  const candidate = {
    id: "wordnet-attachment:lust",
    surface: "lust",
    kind: "wordnet-sense-attachment",
    senseId: "n:07504854-n",
    sense: { pos: "n", synset: "07504854-n", lemmas: ["lust"], gloss: "sexual desire" },
    context: ["Lust is a strong sexual desire."],
    anchorCandidates: [{
      target: "sexual desire",
      pyashSequence: ["hjon", "twin"],
      targetKind: "compound",
      targetId: "compound:sexual_desire",
      selectable: true,
      kind: "compound",
      evidence: "accepted compound anchor"
    }]
  };
  const inventory = buildTranslationVocabularyInventory({
    sourceText: candidate.context[0],
    candidates: [candidate]
  });
  const response = parseTranslationVocabularyVerificationResponse(JSON.stringify({
    verdict: "complete",
    candidates: [{
      id: candidate.id,
      status: "accept",
      targetEnglish: "sexual desire",
      rationale: "the accepted compound preserves the selected meaning"
    }]
  }), { candidates: [candidate], inventory, requireComplete: true });
  assert.equal(response.valid, true);
  assert.equal(response.links[0].targetKind, "compound");
  assert.equal(response.links[0].targetId, "compound:sexual_desire");
  const applied = applyTranslationVocabularyVerificationResponse({
    records: [],
    vocabularyCandidates: [candidate]
  }, response);
  assert.equal(applied.vocabularyCandidates[0].targetKind, "compound");
  assert.equal(applied.vocabularyCandidates[0].targetId, "compound:sexual_desire");
});

test("vocabulary candidates preserve independent occurrence queue duties", async () => {
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
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.candidates.length), [1, 1]);
  assert.equal(queued.submittedCount, 2);
  assert.equal(queued.handleId, "");
  assert.equal(queued.handleIds.length, 2);
  assert.equal(queued.result.vocabularyQueue.status, "queued");
  assert.deepEqual(
    queued.result.vocabularyCandidates.map((candidate) => candidate.queue.handleId),
    queued.handleIds
  );
  assert.deepEqual(
    queued.handleIds,
    requests.map((request) => translationVocabularyQueueHandle({
      sourceHash: result.sourceHash,
      candidates: request.candidates
    }))
  );
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
  assert.deepEqual(requests.map((request) => request.candidates.length), [1, 1, 1, 1, 1]);
  assert.ok(requests.every((request) => request.responseFormat?.properties?.candidates?.items?.properties?.targetEnglish?.enum));
  assert.equal(queued.batches.length, 5);
  assert.equal(queued.queues.length, 5);
  assert.equal(queued.submittedCount, 5);
  assert.equal(new Set(queued.queues.map((queue) => queue.handleId)).size, 5);
  assert.deepEqual(queued.result.vocabularyCandidates.map((candidate) => candidate.queue.handleId), queued.handleIds);
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
  assert.match(sentence, /num_predict.*512/u);
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
  assert.match(rejected.reason, /bounded anchor options|inventory-backed targetEnglish/u);
});

test("selected-sense vocabulary links cannot escape their bounded anchor options", () => {
  const candidate = {
    id: "wordnet-attachment:action",
    surface: "actions",
    kind: "wordnet-sense-attachment",
    senseId: "n:00038116-n",
    sense: { pos: "n", synset: "00038116-n", lemmas: ["action"], gloss: "something done" },
    anchorCandidates: [{ target: "activity", pyashSequence: ["twot"] }]
  };
  const response = parseTranslationVocabularyVerificationResponse(JSON.stringify({
    verdict: "complete",
    candidates: [{
      id: candidate.id,
      status: "accept",
      targetEnglish: "love",
      rationale: "unrelated inventory entry"
    }]
  }), {
    candidates: [candidate],
    inventory: {
      entries: [
        { english: "activity", pyash: ["twot"] },
        { english: "love", pyash: ["pyan"] }
      ],
      grammar: []
    },
    requireComplete: true
  });
  assert.equal(response.valid, false);
  assert.match(response.reason, /bounded anchor options/u);
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
