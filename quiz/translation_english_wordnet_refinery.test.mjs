import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runTranslationDocument } from "../command/translate_document.mjs";
import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";
import { parseTranslationPipelinePya } from "../program/verbs/exchange/translation/translation_pipeline.mjs";
import {
  appendEnglishWordNetAttachmentCandidates,
  applyEnglishWordNetSenseAttachmentLinks,
  collectEnglishWordNetSourceTerms,
  refineEnglishWordNet
} from "../program/verbs/exchange/translation/english_wordnet_refinery.mjs";
import { TRANSLATION_SENSE_STATE_FORMAT } from "../program/verbs/exchange/translation/translation_occurrence.mjs";

function resources() {
  return {
    coverage: {
      byVariant: new Map([
        ["like", { coverageType: "atomic", canonicalEnglish: "like", pyashSequence: ["pyan"] }],
        ["require", { coverageType: "atomic", canonicalEnglish: "require", pyashSequence: ["hcas"] }],
        ["join", { coverageType: "atomic", canonicalEnglish: "join", pyashSequence: ["sren"] }]
      ])
    },
    grammarCatalog: { entries: [] },
    wordnet: {
      index: buildEnglishWordNetIndex({
        rows: [
          { id: "v:one:florp", pos: "v", synset: "one", senseKey: "one", lemma: "florp", gloss: "be fond of" },
          { id: "v:one:like", pos: "v", synset: "one", senseKey: "one", lemma: "like", gloss: "be fond of" },
          { id: "v:two:blorp", pos: "v", synset: "two", senseKey: "two", lemma: "blorp", gloss: "require a thing" },
          { id: "v:two:require", pos: "v", synset: "two", senseKey: "two", lemma: "require", gloss: "require a thing" },
          { id: "v:three:blorp", pos: "v", synset: "three", senseKey: "three", lemma: "blorp", gloss: "join a thing" },
          { id: "v:three:join", pos: "v", synset: "three", senseKey: "three", lemma: "join", gloss: "join a thing" }
        ]
      })
    }
  };
}

function occurrenceResources() {
  const base = resources();
  base.wordnet.index = buildEnglishWordNetIndex({
    rows: [
      { id: "v:one:florp", pos: "v", synset: "one", senseKey: "one", lemma: "florp", gloss: "be fond of" },
      { id: "v:one:like", pos: "v", synset: "one", senseKey: "one", lemma: "like", gloss: "be fond of" },
      { id: "v:two:florp", pos: "v", synset: "two", senseKey: "two", lemma: "florp", gloss: "require a thing" },
      { id: "v:two:require", pos: "v", synset: "two", senseKey: "two", lemma: "require", gloss: "require a thing" }
    ]
  });
  return base;
}

test("standard WordNet refinery selects leaf links and queues only pending senses", async () => {
  const result = {
    language: "english",
    sourceHash: "source-hash",
    records: [{
      id: "translation-blorp",
      source: { text: "I blorp.", sentenceIndex: 0 },
      context: [],
      unresolved: ["blorp"]
    }],
    vocabularyCandidates: [
      { surface: "blorp", kind: "lexical-gap" },
      { surface: "is", kind: "grammar-gap" }
    ]
  };
  assert.deepEqual(collectEnglishWordNetSourceTerms(result), ["blorp"]);
  const submissions = [];
  const refined = await refineEnglishWordNet({
    result,
    resources: resources(),
    config: { maxBatch: 200, edgeMaxDegree: 1 },
    submit: async (request) => {
      submissions.push(request);
      return { status: "queued" };
    }
  });
  assert.equal(refined.counts.decisions, 1);
  assert.equal(refined.counts.ambiguous, 1);
  assert.equal(refined.counts.review, 1);
  assert.equal(refined.queuePending, 1);
  assert.equal(submissions.length, 1);
  assert.match(submissions[0].handleId, /^english-wordnet-select-/u);
  assert.match(submissions[0].prompt, /OPTIONS/u);
  assert.match(submissions[0].prompt, /blorp/u);
  assert.equal(refined.records[0].queue.status, "queued");
});

test("accepted occurrence sense resumes without re-submitting to the selector", async () => {
  const sourceRecord = {
    id: "sentence-one",
    source: { text: "I florp.", sentenceIndex: 0 },
    tokens: [{
      surface: "i",
      tokenIndex: 0,
      pyashSequence: ["mi"],
      senseCandidates: []
    }, {
      surface: "florp",
      tokenIndex: 1,
      pyashSequence: [],
      senseCandidates: occurrenceResources().wordnet.index.senses("florp")
    }],
    unresolved: ["florp"]
  };
  const result = {
    language: "english",
    sourceHash: "resume-source",
    senseStateFormat: TRANSLATION_SENSE_STATE_FORMAT,
    records: [sourceRecord],
    vocabularyCandidates: [{
      id: "translation-occurrence-florp",
      occurrenceId: "translation-occurrence-florp",
      surface: "florp",
      kind: "lexical-gap",
      sourceRecordId: sourceRecord.id,
      tokenIndex: 1,
      senseCandidates: sourceRecord.tokens[1].senseCandidates,
      context: [sourceRecord.source.text]
    }]
  };
  let submissions = 0;
  const first = await refineEnglishWordNet({
    result,
    resources: occurrenceResources(),
    config: { maxBatch: 200, edgeMaxDegree: 1 },
    submit: async () => {
      submissions += 1;
      return { status: "queued" };
    },
    awaitHandle: async () => JSON.stringify({
      verdict: "accept",
      senseId: "v:one",
      confidence: "high",
      rationale: "fixture selected the supplied sense"
    })
  });
  const resumed = await refineEnglishWordNet({
    result: { ...result, wordnet: first },
    resources: occurrenceResources(),
    submit: async () => { throw new Error("accepted occurrence must not be submitted again"); },
    awaitHandle: async () => { throw new Error("accepted occurrence must not be awaited again"); }
  });
  assert.equal(submissions, 1);
  assert.equal(resumed.queues.length, 0);
  assert.equal(resumed.records[0].selectedSenseId, first.records[0].selectedSenseId);
  assert.equal(resumed.records[0].occurrenceId, first.records[0].occurrenceId);
});

test("WordNet refinery remains a no-op when the document has no lexical gaps", async () => {
  const refined = await refineEnglishWordNet({
    result: { language: "english", sourceHash: "source-hash", vocabularyCandidates: [] },
    submit: async () => { throw new Error("queue should not run"); }
  });
  assert.deepEqual(refined.sourceTerms, []);
  assert.deepEqual(refined.counts, {
    decisions: 0,
    ambiguous: 0,
    selected: 0,
    senses: 0,
    accepted: 0,
    leaf: 0,
    deterministic: 0,
    existing: 0,
    review: 0,
    rejected: 0,
    uncertain: 0,
    errors: 0,
    unresolved: 0
  });
  assert.equal(refined.queue, null);
});

test("selected WordNet senses become bounded anchor candidates", () => {
  const translation = appendEnglishWordNetAttachmentCandidates({
    language: "english",
    vocabularyCandidates: [{
      id: "old-candidate",
      surface: "feel",
      kind: "lexical-gap",
      sourceRecordId: "record-feel"
    }]
  }, [{
    id: "english-wordnet-sense-feel",
    status: "review",
    surface: "feel",
    sourceRecordId: "record-feel",
    selectedSenseId: "v:01775456",
    selectedSense: {
      pos: "v",
      synset: "01775456",
      lemmas: ["feel", "experience"],
      gloss: "undergo an emotional state"
    },
    anchorCandidates: [{
      target: "sensory",
      pyashSequence: ["nrec"],
      evidence: "WordNet hypernym reaches feeling"
    }],
    sentence: "People feel love.",
    selectionRationale: "the sentence describes emotion"
  }]);
  assert.equal(translation.vocabularyCandidates.length, 1);
  assert.equal(translation.vocabularyCandidates[0].kind, "wordnet-sense-attachment");
  assert.equal(translation.vocabularyCandidates[0].senseId, "v:01775456");
  assert.equal(translation.vocabularyCandidates[0].sense.gloss, "undergo an emotional state");
  assert.deepEqual(translation.vocabularyCandidates[0].sense.lemmas, ["feel", "experience"]);
  assert.deepEqual(translation.vocabularyCandidates[0].anchorCandidates[0].pyashSequence, ["nrec"]);
});

test("accepted attachment links update the selected sense record", () => {
  const linked = applyEnglishWordNetSenseAttachmentLinks({
    wordnet: {
      decisions: [],
      records: [{
        id: "english-wordnet-sense-action",
        status: "review",
        pos: "n",
        synset: "00038116-n",
        selectedSenseId: "n:00038116-n"
      }]
    },
    vocabularyCandidates: [{
      id: "wordnet-attachment:english-wordnet-sense-action",
      kind: "wordnet-sense-attachment",
      status: "accepted-llm",
      senseId: "n:00038116-n",
      targetEnglish: "activity",
      pyashSequence: ["twot"],
      verificationRationale: "WordNet relation anchor"
    }]
  });
  assert.equal(linked.wordnet.records[0].status, "accepted-llm");
  assert.deepEqual(linked.wordnet.records[0].link.pyashSequence, ["twot"]);
  assert.equal(linked.wordnet.counts.accepted, 1);
  assert.equal(linked.wordnet.counts.unresolved, 0);
});

test("translation document persists the WordNet refinery before vocabulary lowering", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-wordnet-refinery-document-"));
  const source = join(directory, "source.txt");
  const translation = join(directory, "translation.pya");
  const catalog = join(directory, "catalog.pya");
  const pack = join(directory, "pack.pyac");
  writeFileSync(source, "I blorp.\n", "utf8");
  const submissions = [];
  await runTranslationDocument(["english", source, translation, catalog, pack], {
    report: () => {},
    wordnetRefinery: {
      resources: resources(),
      config: { maxBatch: 200, edgeMaxDegree: 1 },
      sourceTerms: ["blorp"],
      submit: async (request) => {
        submissions.push(request);
        return { status: "queued" };
      }
    }
  });
  const parsed = parseTranslationPipelinePya(readFileSync(translation, "utf8"));
  assert.equal(submissions.length, 1);
  assert.match(submissions[0].handleId, /^english-wordnet-select-/u);
  assert.equal(parsed.wordnet?.format, "english-wordnet-refinery-v1");
  assert.equal(parsed.wordnet?.sourceTerms[0], "blorp");
  assert.equal(parsed.wordnet?.queue?.status, "queued");
  assert.equal(parsed.wordnet?.context[0].term, "blorp");
});
