import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runTranslationDocument } from "../command/translate_document.mjs";
import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";
import { parseTranslationPipelinePya } from "../program/verbs/exchange/translation/translation_pipeline.mjs";
import {
  collectEnglishWordNetSourceTerms,
  refineEnglishWordNet
} from "../program/verbs/exchange/translation/english_wordnet_refinery.mjs";

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
  assert.match(submissions[0].prompt, /POSSIBLE SENSES/u);
  assert.match(submissions[0].prompt, /blorp/u);
  assert.equal(refined.records[0].queue.status, "queued");
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
