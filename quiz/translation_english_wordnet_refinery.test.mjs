import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runTranslationDocument } from "../command/translate_document.mjs";
import { buildEnglishWordNetIndex } from "../program/library/translation/english_wordnet.mjs";
import {
  parseTranslationPipelinePya,
  renderTranslationPipelinePya,
  translateDocument
} from "../program/library/translation/translation_pipeline.mjs";
import { renderEnglishWordNetSenseLinksPya } from "../program/library/translation/english_wordnet_linker.mjs";
import { loadDefaultEnglishSentenceResources } from "../program/library/translation/english_sentence.mjs";
import {
  appendEnglishWordNetAttachmentCandidates,
  applyEnglishWordNetSenseAttachmentLinks,
  collectEnglishWordNetSourceTerms,
  refineEnglishWordNet
} from "../program/library/translation/english_wordnet_refinery.mjs";
import { TRANSLATION_SENSE_STATE_FORMAT } from "../program/library/translation/translation_occurrence.mjs";
import { buildTranslationVocabularyInventory } from "../program/library/translation/translation_vocabulary_queue.mjs";

function resources() {
  return {
    coverage: {
      byVariant: new Map([
        ["florp", { coverageType: "atomic", canonicalEnglish: "florp", pyashSequence: ["tyap"] }],
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
  assert.equal(resumed.records[0].selectedSenseWord, "florp");
  assert.equal(resumed.records[0].occurrenceId, first.records[0].occurrenceId);
});

test("refinery keeps convergent but non-equivalent atom suggestions out of sense links", async () => {
  const sourceRecord = {
    id: "sentence-one",
    source: { text: "I florp.", sentenceIndex: 0 },
    tokens: [{
      surface: "florp",
      tokenIndex: 0,
      pyashSequence: [],
      senseCandidates: occurrenceResources().wordnet.index.senses("florp")
    }],
    unresolved: ["florp"]
  };
  const result = {
    language: "english",
    sourceHash: "suggestion-anchor-source",
    senseStateFormat: TRANSLATION_SENSE_STATE_FORMAT,
    records: [sourceRecord],
    vocabularyCandidates: [{
      id: "translation-occurrence-florp",
      occurrenceId: "translation-occurrence-florp",
      surface: "florp",
      kind: "lexical-gap",
      sourceRecordId: sourceRecord.id,
      tokenIndex: 0,
      senseCandidates: sourceRecord.tokens[0].senseCandidates,
      context: [sourceRecord.source.text]
    }]
  };
  const resources = occurrenceResources();
  resources.coverage.byVariant.delete("florp");
  resources.coverage.byVariant.delete("like");
  const refined = await refineEnglishWordNet({
    result,
    resources,
    config: { maxBatch: 200, edgeMaxDegree: 1, vocabSuggestionMinSupport: 2 },
    submit: async () => ({ status: "queued" }),
    awaitHandle: async () => JSON.stringify({
      verdict: "accept",
      senseId: "v:one",
      confidence: "high",
      rationale: "fixture selected the supplied sense"
    }),
    suggestVocabulary: async () => [{
      input: "florp",
      mappings: [{ word: "mystified", pyacSequence: ["hmi2f"] }]
    }, {
      input: "like",
      mappings: [{ word: "mystified", pyacSequence: ["hmi2f"] }]
    }]
  });
  assert.equal(refined.records[0].status, "review");
  assert.equal(refined.records[0].link, undefined);
  const suggestion = refined.records[0].anchorCandidates.find((candidate) => candidate.target === "mystified");
  assert.ok(suggestion);
  assert.equal(suggestion.selectable, false);
});

test("refinery withholds exact direct links that converge on one atom", async () => {
  const wordnetIndex = buildEnglishWordNetIndex({
    rows: [{
      id: "n:alpha:alpha",
      pos: "n",
      synset: "alpha",
      senseKey: "alpha",
      lemma: "alpha",
      gloss: "the alpha concept"
    }, {
      id: "n:beta:beta",
      pos: "n",
      synset: "beta",
      senseKey: "beta",
      lemma: "beta",
      gloss: "the beta concept"
    }]
  });
  const result = {
    language: "english",
    sourceHash: "convergent-exact-anchor-source",
    records: [{
      id: "sentence-one",
      source: { text: "alpha beta", sentenceIndex: 0 },
      tokens: [{ surface: "alpha", tokenIndex: 0, senseCandidates: wordnetIndex.senses("alpha") }, {
        surface: "beta", tokenIndex: 1, senseCandidates: wordnetIndex.senses("beta")
      }],
      unresolved: ["alpha", "beta"]
    }],
    vocabularyCandidates: [{
      surface: "alpha", kind: "lexical-gap", sourceRecordId: "sentence-one", tokenIndex: 0
    }, {
      surface: "beta", kind: "lexical-gap", sourceRecordId: "sentence-one", tokenIndex: 1
    }]
  };
  const refined = await refineEnglishWordNet({
    result,
    resources: {
      coverage: {
        byVariant: new Map([
          ["alpha", { coverageType: "atomic", canonicalEnglish: "alpha", pyashSequence: ["shared"] }],
          ["beta", { coverageType: "atomic", canonicalEnglish: "beta", pyashSequence: ["shared"] }]
        ])
      },
      grammarCatalog: { entries: [] },
      wordnet: { index: wordnetIndex }
    },
    config: { edgeMaxDegree: 1 }
  });
  assert.deepEqual(refined.records.map((record) => record.status), ["review", "review"]);
  assert.equal(refined.records.every((record) => !record.link), true);
  assert.equal(refined.counts.accepted, 0);
});

test("persisted mixed-part-of-speech senses retain surrounding noun evidence", async () => {
  const actionSenses = [
    {
      pos: "n",
      synset: "action-noun",
      lemma: "action",
      lemmas: ["action"],
      gloss: "something done"
    },
    {
      pos: "v",
      synset: "action-verb",
      lemma: "action",
      lemmas: ["action"],
      gloss: "carry out a task"
    }
  ];
  const result = {
    language: "english",
    sourceHash: "mixed-pos-source",
    senseStateFormat: TRANSLATION_SENSE_STATE_FORMAT,
    records: [{
      id: "mixed-pos-record",
      source: { text: "Feelings and actions.", sentenceIndex: 0 },
      tokens: [{
        surface: "feelings",
        tokenIndex: 0,
        pyashSequence: ["xyek", "pu"],
        senseCandidates: [{
          pos: "n",
          synset: "feeling-noun",
          lemma: "feeling",
          lemmas: ["feeling"],
          gloss: "an emotional state"
        }]
      }, {
        surface: "and",
        tokenIndex: 1,
        pyashSequence: ["wa"],
        grammar: { kind: "conjunction", components: ["and_"], position: "link" },
        senseCandidates: []
      }, {
        surface: "actions",
        tokenIndex: 2,
        pyashSequence: [],
        senseCandidates: actionSenses
      }],
      unresolved: ["actions"]
    }],
    vocabularyCandidates: [{
      id: "translation-occurrence-actions",
      occurrenceId: "translation-occurrence-actions",
      surface: "actions",
      kind: "lexical-gap",
      sourceRecordId: "mixed-pos-record",
      tokenIndex: 2,
      senseCandidates: actionSenses,
      context: ["Feelings and actions."]
    }]
  };
  const refined = await refineEnglishWordNet({
    result,
    resources: {
      coverage: { byVariant: new Map() },
      grammarCatalog: { entries: [] },
      wordnet: {
        index: buildEnglishWordNetIndex({
          rows: [
            { id: "n:action-noun:action", pos: "n", synset: "action-noun", senseKey: "action-noun", lemma: "action", gloss: "something done" },
            { id: "v:action-verb:action", pos: "v", synset: "action-verb", senseKey: "action-verb", lemma: "action", gloss: "carry out a task" }
          ]
        })
      }
    },
    config: { maxBatch: 200, edgeMaxDegree: 1 },
    submit: async () => { throw new Error("noun evidence should resolve before a model call"); }
  });
  assert.deepEqual(refined.decisions[0].senses.map((sense) => sense.pos), ["n"]);
});

test("weak POS filtering does not collapse an unresolved ambiguous sense set", async () => {
  const senses = [
    {
      pos: "n",
      synset: "florp-noun",
      lemma: "florp",
      lemmas: ["florp"],
      gloss: "a named object"
    },
    {
      pos: "v",
      synset: "florp-verb",
      lemma: "florp",
      lemmas: ["florp"],
      gloss: "perform an action"
    }
  ];
  const sourceRecord = {
    id: "modal-ambiguous-record",
    source: { text: "The florps.", sentenceIndex: 0 },
    tokens: [{
      surface: "the",
      tokenIndex: 0,
      pyashSequence: ["dlih"],
      senseCandidates: []
    }, {
      surface: "florps",
      tokenIndex: 1,
      pyashSequence: [],
      senseCandidates: senses
    }],
    unresolved: ["florps"]
  };
  const submissions = [];
  const refined = await refineEnglishWordNet({
    result: {
      language: "english",
      sourceHash: "pos-filter-source",
      senseStateFormat: TRANSLATION_SENSE_STATE_FORMAT,
      records: [sourceRecord],
      vocabularyCandidates: [{
        id: "translation-occurrence-florps",
        occurrenceId: "translation-occurrence-florps",
        surface: "florps",
        kind: "lexical-gap",
        sourceRecordId: sourceRecord.id,
        tokenIndex: 1,
        senseCandidates: senses,
        context: [sourceRecord.source.text]
      }]
    },
    resources: {
      coverage: { byVariant: new Map() },
      grammarCatalog: { entries: [] },
      wordnet: {
        index: buildEnglishWordNetIndex({
          rows: senses.map((sense) => ({
            id: `${sense.pos}:${sense.synset}`,
            pos: sense.pos,
            synset: sense.synset,
            senseKey: sense.synset,
            lemma: sense.lemma,
            gloss: sense.gloss
          }))
        })
      }
    },
    config: { maxBatch: 200, edgeMaxDegree: 1 },
    submit: async (request) => {
      submissions.push(request);
      return { status: "queued" };
    }
  });
  assert.equal(refined.counts.errors, 0);
  assert.equal(refined.decisions[0].availableSenseCount, 2);
  assert.deepEqual(refined.decisions[0].senses.map((sense) => sense.pos), ["n", "v"]);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].candidates.length, 2);
  assert.equal(refined.records[0].status, "review");
});

test("accepted compound aliases link the selected involve inclusion sense", async () => {
  const sourceRecord = {
    id: "sentence-involve",
    source: { text: "This decision involves changes.", sentenceIndex: 0 },
    tokens: [{
      surface: "involves",
      tokenIndex: 0,
      pyashSequence: [],
      senseCandidates: [{
        pos: "v",
        synset: "02642216-v",
        lemma: "involve",
        lemmas: ["imply", "involve"],
        gloss: "have as a necessary feature"
      }]
    }],
    unresolved: ["involves"]
  };
  const result = {
    language: "english",
    sourceHash: "involve-source",
    senseStateFormat: TRANSLATION_SENSE_STATE_FORMAT,
    records: [sourceRecord],
    vocabularyCandidates: [{
      id: "translation-occurrence-involves",
      occurrenceId: "translation-occurrence-involves",
      surface: "involves",
      kind: "lexical-gap",
      sourceRecordId: sourceRecord.id,
      tokenIndex: 0,
      senseCandidates: sourceRecord.tokens[0].senseCandidates,
      context: [sourceRecord.source.text]
    }]
  };
  const refined = await refineEnglishWordNet({
    result,
    resources: {
      coverage: { byVariant: new Map() },
      grammarCatalog: { entries: [] },
      wordnet: {
        index: buildEnglishWordNetIndex({
          rows: [{
            id: "v:02642216-v",
            pos: "v",
            synset: "02642216-v",
            senseKey: "v:02642216-v",
            lemma: "involve",
            gloss: "have as a necessary feature"
          }]
        })
      }
    },
    compoundRecords: [{
      target: "include",
      aliases: ["involve"],
      pyashSequence: ["lwak", "hzan"],
      status: "accepted-curated"
    }]
  });
  assert.equal(refined.records[0].status, "accepted-edge");
  assert.equal(refined.records[0].link.target, "include");
  assert.deepEqual(refined.records[0].link.pyashSequence, ["lwak", "hzan"]);
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
  assert.equal(translation.vocabularyCandidates[0].senseWord, "feel");
  assert.equal(translation.vocabularyCandidates[0].sense.gloss, "undergo an emotional state");
  assert.deepEqual(translation.vocabularyCandidates[0].sense.lemmas, ["feel", "experience"]);
  assert.deepEqual(translation.vocabularyCandidates[0].anchorCandidates[0].pyashSequence, ["nrec"]);
});

test("WordNet attachment preserves composed anchor evidence", () => {
  const translation = appendEnglishWordNetAttachmentCandidates({
    language: "english",
    vocabularyCandidates: []
  }, [{
    id: "english-wordnet-sense-lust",
    status: "review",
    surface: "lust",
    sourceRecordId: "record-lust",
    selectedSenseId: "n:07504854-n",
    selectedSense: {
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
      evidence: "composed from covered components sexual desire"
    }],
    sentence: "Lust is a strong sexual desire."
  }]);
  assert.equal(translation.vocabularyCandidates[0].anchorCandidates[0].kind, "compound-composition");
  assert.equal(translation.vocabularyCandidates[0].anchorCandidates[0].targetKind, "compound");
  assert.deepEqual(translation.vocabularyCandidates[0].anchorCandidates[0].componentTargets, ["sexual", "desire"]);
  const linked = applyEnglishWordNetSenseAttachmentLinks({
    wordnet: {
      decisions: [],
      records: [{
        id: "english-wordnet-sense-lust",
        status: "review",
        pos: "n",
        synset: "07504854-n",
        selectedSenseId: "n:07504854-n",
        selectedSense: {
          pos: "n",
          synset: "07504854-n",
          lemmas: ["lust"],
          gloss: "a strong sexual desire"
        },
        anchorCandidates: translation.vocabularyCandidates[0].anchorCandidates
      }]
    },
    vocabularyCandidates: [{
      ...translation.vocabularyCandidates[0],
      status: "accepted-llm",
      targetEnglish: "sexual desire",
      pyashSequence: ["hjon", "twin"],
      verificationRationale: "selected sense retains the complete meaning"
    }]
  });
  assert.match(linked.wordnet.records[0].link.evidence, /linked to verified compound sexual desire/u);
  assert.match(linked.wordnet.records[0].link.evidence, /WordNet gloss: a strong sexual desire/u);
  assert.equal(linked.wordnet.records[0].link.senseGloss, "a strong sexual desire");
  assert.equal(linked.wordnet.records[0].link.targetKind, "compound");
  assert.equal(linked.wordnet.records[0].link.targetId, "compound:hjon+twin");
});

test("WordNet refinery derives and verifies a new compound before offering it as a sense anchor", async () => {
  const sense = {
    pos: "n",
    synset: "02846922-n",
    lemma: "birdhouse",
    lemmas: ["birdhouse"],
    gloss: "a shelter for birds"
  };
  const sentence = "A birdhouse is a shelter for birds.";
  const sourceRecord = {
    id: "record-birdhouse",
    source: { text: sentence, sentenceIndex: 0 },
    tokens: [{
      surface: "birdhouse",
      lemma: "birdhouse",
      tokenIndex: 0,
      pyashSequence: [],
      senseCandidates: [sense]
    }],
    unresolved: ["birdhouse"]
  };
  const result = {
    language: "english",
    sourceHash: "birdhouse-source",
    records: [sourceRecord],
    vocabularyCandidates: [{
      id: "candidate-birdhouse",
      occurrenceId: "occurrence-birdhouse",
      surface: "birdhouse",
      kind: "lexical-gap",
      sourceRecordId: sourceRecord.id,
      tokenIndex: 0,
      context: [sentence],
      senseCandidates: [sense]
    }]
  };
  const verifiedCandidates = [];
  const refined = await refineEnglishWordNet({
    result,
    resources: {
      coverage: { byVariant: new Map() },
      grammarCatalog: { entries: [] },
      wordnet: {
        index: buildEnglishWordNetIndex({
          rows: [
            {
              id: "n:02846922-n:birdhouse",
              pos: "n",
              synset: "02846922-n",
              lemma: "birdhouse",
              gloss: sense.gloss
            },
            { id: "n:02084071-n:bird", pos: "n", synset: "02084071-n", lemma: "bird", gloss: "warm-blooded egg-laying vertebrate" },
            { id: "n:03544360-n:house", pos: "n", synset: "03544360-n", lemma: "house", gloss: "a dwelling that serves as living quarters" }
          ],
          relations: [{ source: "n:02846922-n", target: "n:03544360-n", relation: "hypernym" }]
        })
      }
    },
    verifyCompound: async ({ candidates }) => {
      verifiedCandidates.push(...candidates);
      const candidate = candidates[0];
      return JSON.stringify({
        verdict: "accept",
        candidateId: candidate.id,
        headKind: "lexical-head",
        targetSenseId: candidate.targetSenseEvidence[0].source,
        headSenseId: candidate.componentSenseEvidence.find((row) => row.component === "house").source,
        modifierSenseIds: [candidate.componentSenseEvidence.find((row) => row.component === "bird").source],
        modifierEvidence: ["bird literally specifies the kind of house"],
        modifierRelations: ["literal"],
        rationale: "bird modifies house; house is the semantic head"
      });
    }
  });

  assert.equal(verifiedCandidates.length, 1);
  assert.equal(verifiedCandidates[0].target, "birdhouse");
  assert.deepEqual(verifiedCandidates[0].componentGlosses, ["bird", "house"]);
  assert.deepEqual(verifiedCandidates[0].pyashSequence, ["pyaf", "hcas"]);
  assert.match(verifiedCandidates[0].evidence, /a shelter for birds/u);
  let noHeadRelationCalls = 0;
  await refineEnglishWordNet({
    result: { ...result, sourceHash: "birdhouse-no-head-relation" },
    resources: {
      coverage: { byVariant: new Map() },
      grammarCatalog: { entries: [] },
      wordnet: {
        index: buildEnglishWordNetIndex({ rows: [
          { id: "n:02846922-n:birdhouse", pos: "n", synset: "02846922-n", lemma: "birdhouse", gloss: sense.gloss },
          { id: "n:02084071-n:bird", pos: "n", synset: "02084071-n", lemma: "bird", gloss: "warm-blooded egg-laying vertebrate" },
          { id: "n:03544360-n:house", pos: "n", synset: "03544360-n", lemma: "house", gloss: "a dwelling that serves as living quarters" }
        ] })
      }
    },
    verifyCompound: async () => {
      noHeadRelationCalls += 1;
      return "{}";
    }
  });
  assert.equal(noHeadRelationCalls, 0);
  const anchor = refined.records[0].anchorCandidates.find((candidate) => candidate.target === "birdhouse");
  assert.ok(anchor);
  assert.equal(anchor.selectable, true);
  assert.equal(anchor.targetKind, "compound");
  assert.equal(anchor.targetId, verifiedCandidates[0].id);
  assert.deepEqual(anchor.pyashSequence, ["pyaf", "hcas"]);
  assert.equal(anchor.compoundVerificationStatus, "accepted-llm");
  assert.match(anchor.senseGloss, /shelter for birds/u);

  const attached = appendEnglishWordNetAttachmentCandidates({
    language: "english",
    vocabularyCandidates: []
  }, refined.records);
  assert.equal(attached.vocabularyCandidates[0].sense.gloss, sense.gloss);
  assert.equal(attached.vocabularyCandidates[0].anchorCandidates[0].compoundVerificationStatus, "accepted-llm");
  const inventory = buildTranslationVocabularyInventory({
    sourceText: sentence,
    candidates: attached.vocabularyCandidates
  });
  const offered = inventory.entries.find((entry) => entry.english === "birdhouse");
  assert.deepEqual(offered.pyash, ["pyaf", "hcas"]);
  assert.equal(offered.targetKind, "compound");
  assert.equal(offered.targetId, verifiedCandidates[0].id);

  const linked = applyEnglishWordNetSenseAttachmentLinks({
    wordnet: { ...refined, records: refined.records },
    vocabularyCandidates: [{
      ...attached.vocabularyCandidates[0],
      status: "accepted-llm",
      targetEnglish: "birdhouse",
      pyashSequence: ["pyaf", "hcas"],
      verificationRationale: "selected sense matches the verified compound"
    }]
  });
  assert.equal(linked.wordnet.records[0].status, "accepted-llm");
  assert.equal(linked.wordnet.records[0].link.targetKind, "compound");
  assert.equal(linked.wordnet.records[0].link.senseGloss, sense.gloss);
  assert.match(renderEnglishWordNetSenseLinksPya({ records: linked.wordnet.records }), /WordNet gloss: a shelter for birds/u);
});

test("a selected sense cannot attach an unverified related atom", () => {
  const translation = applyEnglishWordNetSenseAttachmentLinks({
    wordnet: {
      decisions: [],
      records: [{
        id: "sense-attract",
        status: "review",
        pos: "v",
        synset: "attract",
        selectedSenseId: "v:attract",
        anchorCandidates: [{
          target: "charm",
          pyashSequence: ["crak"],
          targetKind: "atom",
          targetId: "atom:crak",
          selectable: false,
          kind: "relation",
          evidence: "WordNet related sense reaches charm"
        }]
      }]
    },
    vocabularyCandidates: [{
      id: "wordnet-attachment:sense-attract:occurrence",
      occurrenceId: "occurrence-attract",
      kind: "wordnet-sense-attachment",
      status: "accepted-llm",
      senseId: "v:attract",
      targetEnglish: "charm",
      pyashSequence: ["crak"],
      verificationRationale: "closest available word"
    }]
  });
  assert.equal(translation.wordnet.records[0].status, "review");
  assert.equal(translation.wordnet.records[0].link, undefined);
});

test("selected senses cannot share an atom unless the compound catalog declares equivalence", () => {
  const records = ["first", "second"].map((sense) => ({
    id: `sense-${sense}`,
    status: "review",
    pos: "n",
    synset: sense,
    selectedSenseId: `n:${sense}`,
    anchorCandidates: [{
      target: "touch",
      pyashSequence: ["tcum"],
      targetKind: "atom",
      targetId: "atom:tcum",
      selectable: true,
      evidence: "exact covered atom"
    }]
  }));
  const translation = applyEnglishWordNetSenseAttachmentLinks({
    wordnet: { decisions: [], records },
    vocabularyCandidates: records.map((record) => ({
      id: `wordnet-attachment:${record.id}`,
      kind: "wordnet-sense-attachment",
      status: "accepted-llm",
      senseId: record.selectedSenseId,
      targetEnglish: "touch",
      pyashSequence: ["tcum"],
      targetKind: "atom",
      targetId: "atom:tcum",
      verificationRationale: "fixture choice"
    }))
  });
  assert.deepEqual(translation.wordnet.records.map((record) => record.status), ["review", "review"]);
  assert.equal(translation.wordnet.records.every((record) => !record.link), true);
  assert.deepEqual(translation.vocabularyCandidates.map((candidate) => candidate.status), [
    "uncertain-llm",
    "uncertain-llm"
  ]);

  const equivalent = applyEnglishWordNetSenseAttachmentLinks({
    wordnet: {
      decisions: [],
      records: records.map((record) => ({
        ...record,
        anchorCandidates: record.anchorCandidates.map((anchor) => ({
          ...anchor,
          equivalenceGroup: "same-touch",
          equivalenceEvidence: "both selected synsets define the same tactile contact"
        }))
      }))
    },
    vocabularyCandidates: records.map((record) => ({
      id: `wordnet-attachment:${record.id}`,
      kind: "wordnet-sense-attachment",
      status: "accepted-llm",
      senseId: record.selectedSenseId,
      targetEnglish: "touch",
      pyashSequence: ["tcum"],
      verificationRationale: "fixture choice"
    }))
  });
  assert.deepEqual(equivalent.wordnet.records.map((record) => record.status), ["accepted-llm", "accepted-llm"]);
  assert.equal(equivalent.wordnet.records[0].link.equivalenceGroup, "same-touch");
});

test("WordNet attachment ids remain unique for repeated senses", () => {
  const translation = appendEnglishWordNetAttachmentCandidates({
    language: "english",
    vocabularyCandidates: []
  }, [
    {
      id: "english-wordnet-sense-lust",
      occurrenceId: "translation-occurrence-one",
      status: "review",
      surface: "lust",
      sourceRecordId: "record-one",
      selectedSenseId: "n:07504854-n",
      selectedSense: {
        pos: "n",
        synset: "07504854-n",
        lemmas: ["lust"],
        gloss: "strong sexual desire"
      },
      anchorCandidates: [],
      sentence: "Lust is desire."
    },
    {
      id: "english-wordnet-sense-lust",
      occurrenceId: "translation-occurrence-two",
      status: "review",
      surface: "lust",
      sourceRecordId: "record-two",
      selectedSenseId: "n:07504854-n",
      selectedSense: {
        pos: "n",
        synset: "07504854-n",
        lemmas: ["lust"],
        gloss: "strong sexual desire"
      },
      anchorCandidates: [],
      sentence: "Love can be confused with lust."
    }
  ]);
  assert.equal(translation.vocabularyCandidates.length, 2);
  assert.notEqual(
    translation.vocabularyCandidates[0].id,
    translation.vocabularyCandidates[1].id
  );
});

test("persisted plural noun context does not narrow a passive verb to a shared word stem", async () => {
  const translated = await translateDocument({
    language: "english",
    text: "Often love can be confused with other feelings."
  });
  const persisted = parseTranslationPipelinePya(renderTranslationPipelinePya(translated));
  const record = persisted.records[0];
  const feelings = record.tokens.find((token) => token.surface === "feelings");
  assert.equal(feelings.grammaticalNumber, "plural");

  const submissions = [];
  const refined = await refineEnglishWordNet({
    result: persisted,
    resources: await loadDefaultEnglishSentenceResources(),
    submit: async (request) => {
      submissions.push(request);
      return { status: "queued" };
    },
    suggestVocabulary: async () => []
  });
  const decision = refined.decisions.find((item) => item.surface === "confused");
  assert.ok(decision);
  assert.equal(decision.selectionEvidence, "");
  assert.ok(decision.senses.length > 1);
  assert.ok(decision.senses.some((sense) => sense.synset === "00621282-v"));
  assert.ok(decision.senses.some((sense) => sense.synset === "01794768-v"));
  assert.ok(submissions.some((request) => (
    request.candidates.some((sense) => sense.synset === "00621282-v")
      && request.candidates.some((sense) => sense.synset === "01794768-v")
  )));
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
        selectedSenseId: "n:00038116-n",
        anchorCandidates: [{
          target: "activity",
          pyashSequence: ["twot"],
          targetKind: "atom",
          targetId: "atom:twot",
          selectable: true
        }]
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
  assert.equal(linked.wordnet.records[0].link.targetKind, "atom");
  assert.equal(linked.wordnet.records[0].link.targetId, "atom:twot");
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
