import test from "node:test";
import assert from "node:assert/strict";

import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";
import {
  buildEnglishWordNetSenseSelectionPrompt,
  parseEnglishWordNetSenseSelectionResponse
} from "../program/verbs/exchange/translation/english_wordnet_selection.mjs";
import {
  buildEnglishWordNetSenseLinkRecords,
  linkEnglishWordNetSense
} from "../program/verbs/exchange/translation/english_wordnet_linker.mjs";
import { refineEnglishWordNet } from "../program/verbs/exchange/translation/english_wordnet_refinery.mjs";

function senseResources(rows) {
  const wordnet = buildEnglishWordNetIndex({ rows });
  const coverage = new Map([
    ["like", { coverageType: "atomic", canonicalEnglish: "like", pyashSequence: ["pyan"] }],
    ["dislike", { coverageType: "atomic", canonicalEnglish: "dislike", pyashSequence: ["twin"] }]
  ]);
  return {
    coverage: { byVariant: coverage },
    grammarCatalog: { entries: [] },
    wordnet: { index: wordnet }
  };
}

function ambiguousRows() {
  return [{
    id: "v:one:florp",
    pos: "v",
    synset: "one",
    senseKey: "one",
    lemma: "florp",
    gloss: "like something"
  }, {
    id: "v:one:like",
    pos: "v",
    synset: "one",
    senseKey: "one",
    lemma: "like",
    gloss: "like something"
  }, {
    id: "v:two:florp",
    pos: "v",
    synset: "two",
    senseKey: "two",
    lemma: "florp",
    gloss: "dislike something"
  }, {
    id: "v:two:dislike",
    pos: "v",
    synset: "two",
    senseKey: "two",
    lemma: "dislike",
    gloss: "dislike something"
  }];
}

test("WordNet sense selection prompt contains one word, one sentence, and only its senses", () => {
  const prompt = buildEnglishWordNetSenseSelectionPrompt({
    surface: "florp",
    sentence: "I florp the object.",
    senses: [{
      pos: "v",
      synset: "one",
      lemma: "florp",
      lemmas: ["florp", "like"],
      gloss: "like something"
    }, {
      pos: "v",
      synset: "two",
      lemma: "florp",
      lemmas: ["florp", "dislike"],
      gloss: "dislike something"
    }]
  });
  assert.match(prompt, /WORD TO CLASSIFY: florp/u);
  assert.match(prompt, /SENTENCE: I florp the object\./u);
  assert.match(prompt, /OPTION 1[\s\S]*meaning: like something/u);
  assert.match(prompt, /OPTION 2[\s\S]*meaning: dislike something/u);
  assert.match(prompt, /Return one JSON object only/u);
  assert.match(prompt, /No markdown, explanation, Pyash words, or extra keys/u);
  assert.match(prompt, /option must be one option number shown above/u);
  assert.doesNotMatch(prompt, /senseId:/u);
  assert.doesNotMatch(prompt, /other sentence/u);
  assert.doesNotMatch(prompt, /Pyash inventory/u);
});

test("WordNet selector prompt keeps a large sense set bounded and numbered", () => {
  const senses = Array.from({ length: 17 }, (_, index) => ({
    pos: "v",
    synset: `sense-${index}`,
    lemmas: [`florp-${index}`, "shared-lemma"],
    gloss: `meaning ${index} with a short contextual description`
  }));
  const prompt = buildEnglishWordNetSenseSelectionPrompt({
    surface: "florp",
    sentence: "They florp the object near the station.",
    senses
  });
  assert.equal((prompt.match(/OPTION /gu) ?? []).length, 17);
  assert.match(prompt, /OPTION 17[\s\S]*meaning: meaning 16/u);
  assert.ok(prompt.length < 10000);
  assert.ok(!prompt.includes("pyashSequence"));
});

test("WordNet sense selection accepts medium confidence and fails closed below threshold", () => {
  const senses = [
    { pos: "v", synset: "one", lemma: "florp" },
    { pos: "v", synset: "two", lemma: "florp" }
  ];
  const accepted = parseEnglishWordNetSenseSelectionResponse(JSON.stringify({
    verdict: "accept",
    option: 1,
    confidence: "medium",
    rationale: "the sentence supports this sense"
  }), { senses });
  assert.equal(accepted.valid, true);
  const low = parseEnglishWordNetSenseSelectionResponse(JSON.stringify({
    verdict: "accept",
    option: 1,
    confidence: "low",
    rationale: "the sentence is weakly compatible"
  }), { senses });
  assert.equal(low.valid, false);
  assert.match(low.reason, /below the accepted threshold/u);
});

test("WordNet sense selection recovers one noisy JSON envelope and rejects malformed output", () => {
  const senses = [
    { pos: "v", synset: "one", lemma: "florp" },
    { pos: "v", synset: "two", lemma: "florp" }
  ];
  const payload = JSON.stringify({
    verdict: "accept",
    senseId: "v:one",
    confidence: "high",
    rationale: "the supplied sentence supports the first sense"
  });
  const noisy = parseEnglishWordNetSenseSelectionResponse(
    `provider preface\n${payload}\nprovider suffix`,
    { senses }
  );
  assert.equal(noisy.valid, true);
  assert.equal(noisy.senseId, "v:one");
  const malformed = parseEnglishWordNetSenseSelectionResponse(
    "{\"verdict\":\"accept\",\"option\":1}",
    { senses }
  );
  assert.equal(malformed.valid, false);
});

test("deterministic WordNet sense bypasses Housekeeper", async () => {
  const resources = senseResources([{
    id: "v:one:florp",
    pos: "v",
    synset: "one",
    senseKey: "one",
    lemma: "florp",
    gloss: "like something"
  }, {
    id: "v:one:like",
    pos: "v",
    synset: "one",
    senseKey: "one",
    lemma: "like",
    gloss: "like something"
  }]);
  const refined = await refineEnglishWordNet({
    result: {
      language: "english",
      sourceHash: "deterministic-source",
      records: [{
        id: "sentence-one",
        source: { text: "I florp.", sentenceIndex: 0 },
        unresolved: ["florp"],
        context: []
      }],
      vocabularyCandidates: [{ surface: "florp", kind: "lexical-gap" }]
    },
    resources,
    config: { promptMaxChars: 12000, promptMaxTokens: 3900, maxOutputTokens: 512, edgeMaxDegree: 1 },
    submit: async () => { throw new Error("deterministic sense must not queue"); }
  });
  assert.equal(refined.counts.ambiguous, 0);
  assert.equal(refined.counts.selected, 1);
  assert.equal(refined.counts.accepted, 1);
  assert.equal(refined.queues.length, 0);
});

test("an uncovered source does not inherit an arbitrary covered synonym", () => {
  const wordnetIndex = buildEnglishWordNetIndex({
    rows: [{
      id: "s:confused:confused",
      pos: "s",
      synset: "confused",
      senseKey: "confused",
      lemma: "confused",
      gloss: "perplexed or mixed up"
    }, {
      id: "s:confused:lost",
      pos: "s",
      synset: "confused",
      senseKey: "confused-lost",
      lemma: "lost",
      gloss: "perplexed or mixed up"
    }, {
      id: "s:lost:lost",
      pos: "s",
      synset: "lost",
      senseKey: "lost",
      lemma: "lost",
      gloss: "unable to find the way"
    }]
  });
  const linked = linkEnglishWordNetSense({
    sense: {
      pos: "s",
      synset: "confused",
      lemmas: ["confused", "lost"],
      gloss: "perplexed or mixed up"
    },
    sourceTerm: "confused",
    resolveWord: (word) => word === "lost"
      ? { coverageType: "atomic", canonicalEnglish: "lost", pyashSequence: ["hmut"] }
      : null,
    wordnetIndex
  });
  assert.equal(linked.status, "review");
  assert.equal(linked.link, undefined);
  assert.equal(linked.candidates[0].target, "lost");
});

test("the batch linker keeps an uncovered source reviewable", () => {
  const wordnetIndex = buildEnglishWordNetIndex({
    rows: [{
      id: "s:confused:confused",
      pos: "s",
      synset: "confused",
      senseKey: "confused",
      lemma: "confused",
      gloss: "perplexed or mixed up"
    }, {
      id: "s:confused:lost",
      pos: "s",
      synset: "confused",
      senseKey: "confused-lost",
      lemma: "lost",
      gloss: "perplexed or mixed up"
    }, {
      id: "s:lost:lost",
      pos: "s",
      synset: "lost",
      senseKey: "lost",
      lemma: "lost",
      gloss: "unable to find the way"
    }]
  });
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex,
    sourceTerms: ["confused"],
    resolveWord: (word) => word === "lost"
      ? { coverageType: "atomic", canonicalEnglish: "lost", pyashSequence: ["hmut"] }
      : null
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "review");
  assert.equal(records[0].link, undefined);
  assert.equal(records[0].candidates[0].target, "lost");
});

test("ambiguous repeated occurrences receive independent sense decisions", async () => {
  const resources = senseResources(ambiguousRows());
  const submissions = new Map();
  const refined = await refineEnglishWordNet({
    result: {
      language: "english",
      sourceHash: "repeated-source",
      records: [{
        id: "sentence-one",
        source: { text: "I florp.", sentenceIndex: 0 },
        unresolved: ["florp"],
        context: []
      }, {
        id: "sentence-two",
        source: { text: "They florp.", sentenceIndex: 1 },
        unresolved: ["florp"],
        context: []
      }],
      vocabularyCandidates: [
        { surface: "florp", kind: "lexical-gap", sourceRecordId: "sentence-one" },
        { surface: "florp", kind: "lexical-gap", sourceRecordId: "sentence-two" }
      ]
    },
    resources,
    config: { promptMaxChars: 12000, promptMaxTokens: 3900, maxOutputTokens: 512, edgeMaxDegree: 1 },
    submit: async (request) => {
      submissions.set(request.handleId, request);
      return { status: "queued" };
    },
    awaitHandle: async (handleId) => {
      const request = submissions.get(handleId);
      const sense = request.candidates.find((candidate) => candidate.synset === "one");
      return JSON.stringify({
        verdict: "accept",
        option: request.candidates.indexOf(sense) + 1,
        confidence: "high",
        rationale: "the fixture sentence selects the like sense"
      });
    }
  });
  assert.equal(submissions.size, 2);
  assert.equal(refined.counts.decisions, 2);
  assert.equal(refined.counts.ambiguous, 2);
  assert.equal(refined.counts.selected, 2);
  assert.equal(refined.counts.accepted, 2);
  assert.equal(new Set(refined.records.map((record) => record.decisionId)).size, 2);
});

test("low-confidence sense selection persists an explicit error and blocks attachment", async () => {
  const resources = senseResources(ambiguousRows());
  const refined = await refineEnglishWordNet({
    result: {
      language: "english",
      sourceHash: "low-confidence-source",
      records: [{
        id: "sentence-one",
        source: { text: "I florp.", sentenceIndex: 0 },
        unresolved: ["florp"],
        context: []
      }],
      vocabularyCandidates: [{ surface: "florp", kind: "lexical-gap", sourceRecordId: "sentence-one" }]
    },
    resources,
    config: { promptMaxChars: 12000, promptMaxTokens: 3900, maxOutputTokens: 512, edgeMaxDegree: 1 },
    submit: async () => ({ status: "queued" }),
    awaitHandle: async () => JSON.stringify({
      verdict: "accept",
      option: 1,
      confidence: "low",
      rationale: "weak evidence"
    })
  });
  assert.equal(refined.counts.errors, 1);
  assert.equal(refined.errors.length, 1);
  assert.equal(refined.records[0].status, "error");
});

test("selector queue failure persists one occurrence error and does not drop the other occurrence", async () => {
  const resources = senseResources(ambiguousRows());
  const refined = await refineEnglishWordNet({
    result: {
      language: "english",
      sourceHash: "queue-error-source",
      records: [{
        id: "sentence-one",
        source: { text: "I florp.", sentenceIndex: 0 },
        unresolved: ["florp"]
      }, {
        id: "sentence-two",
        source: { text: "They florp.", sentenceIndex: 1 },
        unresolved: ["florp"]
      }],
      vocabularyCandidates: [
        { surface: "florp", kind: "lexical-gap", sourceRecordId: "sentence-one" },
        { surface: "florp", kind: "lexical-gap", sourceRecordId: "sentence-two" }
      ]
    },
    resources,
    config: { promptMaxChars: 12000, promptMaxTokens: 3900, maxOutputTokens: 512, edgeMaxDegree: 1 },
    submit: async (request) => {
      if (request.handleId.includes("retry")) return { status: "rejected" };
      throw new Error("Housekeeper unavailable for this occurrence");
    },
    maxRepairAttempts: 1
  });
  assert.equal(refined.counts.decisions, 2);
  assert.equal(refined.counts.errors, 2);
  assert.equal(refined.records.every((record) => record.status === "error"), true);
  assert.equal(refined.errors.length, 2);
});
