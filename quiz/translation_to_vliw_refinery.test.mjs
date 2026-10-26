import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseVliwCatalogPya } from "../program/library/vliw/index.mjs";
import { getRefinery } from "../program/bridge/refinery.mjs";
import { analyzeEnglishSentence } from "../program/verbs/exchange/translation/english_sentence.mjs";
import { buildEnglishWordNetIndex } from "../program/verbs/exchange/translation/english_wordnet.mjs";
import {
  segmentTranslationDocument,
  translateDocumentSegments
} from "../program/verbs/exchange/translation/translation_pipeline.mjs";
import {
  TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
  runTranslationSourceToVliwRefinery
} from "../program/verbs/exchange/translation/translation_to_vliw_refinery.mjs";
import { inspectTranslationRefineryArtifacts } from "../program/verbs/exchange/translation/translation_refinery_artifacts.mjs";

test("source-to-VLIW refinery declares the complete Pyash stage graph", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  const stages = [];

  await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    onEvoke: (sentence) => stages.push(sentence.su?.name),
    checkpointEnabled: false
  });

  const refinery = getRefinery(TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME);
  assert.ok(refinery);
  assert.deepEqual(refinery.order, [
    "read source",
    "segment source",
    "translate sentences",
    "refine senses",
    "review vocabulary",
    "refine compounds",
    "render translation",
    "lower vliw",
    "write outputs"
  ]);
  assert.deepEqual(refinery.platforms.get("translate sentences")?.deps, [
    "read source",
    "segment source"
  ]);
  assert.deepEqual(refinery.platforms.get("write outputs")?.deps, [
    "lower vliw",
    "render translation"
  ]);
  assert.deepEqual(stages, refinery.order);
});

test("source-to-VLIW refinery writes the translation catalog and executable pack", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-output-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };

  const output = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    checkpointEnabled: false
  });

  assert.equal(output.result.records, 2);
  assert.equal(output.result.executable, 1);
  assert.equal(output.result.unsupported, 1);
  assert.equal(readFileSync(paths.translation, "utf8").includes("translation-pipeline-v1"), true);
  assert.equal(parseVliwCatalogPya(readFileSync(paths.catalog, "utf8")).catalog.records.length, 2);
  assert.equal(readFileSync(paths.pack).length > 32, true);
});

test("source-to-VLIW refinery surfaces the current stage failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-error-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  await assert.rejects(
    () => runTranslationSourceToVliwRefinery({
      language: "english",
      source: "I walk.",
      locator: "fixture.txt",
      paths,
      adapterResolver: () => null,
      checkpointEnabled: false,
      retryConfig: { initialDelayMs: 0, backoff: 1, maxAttempts: 1, maxDelayMs: 0 }
    }),
    /no translation adapter is registered/u
  );
});

test("source-to-VLIW refinery replays its durable map checkpoints", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-replay-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  const checkpoints = [];
  const first = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    onCheckpoint: (sentence) => checkpoints.push(sentence)
  });
  const checkpointIndex = new Map([
    [
      TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
      new Map(checkpoints.map((sentence) => {
        const payload = JSON.parse(sentence.fromtext.text);
        return [sentence.su.name, {
          hash: sentence.ob.text,
          resultSentence: sentence.to.la,
          resultLine: sentence.totext.text,
          exportFacts: payload.exports,
          scopeSlots: payload.scope
        }];
      }))
    ]
  ]);

  const second = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "collector is number 5.\nadd 2 to collector.\n",
    locator: "fixture.txt",
    paths,
    checkpointIndex
  });

  assert.equal(checkpoints.length, 9);
  assert.deepEqual(second.result, first.result);
  assert.equal(second.database.catalog.packHash, first.database.catalog.packHash);
  const inspected = inspectTranslationRefineryArtifacts({ checkpointIndex });
  assert.equal(inspected.latestStage, "write outputs");
  assert.equal(inspected.counts.stages, 9);
  assert.deepEqual(inspected.stages.at(-1).outputNames, [
    "database",
    "result",
    "translation",
    "translationPya"
  ]);
  assert.deepEqual(Object.keys(inspected.stages.at(-1).inputArtifacts), [
    "lower vliw",
    "render translation"
  ]);
  assert.equal(inspected.counts.pendingSenseLinks, 0);
});

test("stale translation artifacts rebuild without downgrading accepted records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-monotonic-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  const checkpoints = [];
  let resolved = true;
  const adapterResolver = () => ({
    name: "english",
    analyzeSentence: (source, options) => resolved
      ? analyzeEnglishSentence(source, {
        ...options,
        resolveWord: (word) => word === "i"
          ? { coverageType: "grammar", pyashSequence: ["mi"] }
          : word === "walked"
            ? {
              coverageType: "lemma",
              lemma: "walk",
              pyashSequence: ["pfin"],
              morphology: {
                kind: "finite-past",
                markerNames: ["past_tense_"],
                markerSequence: ["ki"],
                certainty: "deterministic"
              }
            }
            : null
      })
      : {
        format: "english-sentence-v1",
        status: "review",
        unresolved: ["walked"],
        candidates: [],
        tokens: [{ surface: "walked", coverageType: "unresolved", pyashSequence: [] }]
      }
  });
  const first = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "I walked.",
    locator: "fixture.txt",
    paths,
    adapterResolver,
    resourceHashes: { fixture: "one" },
    onCheckpoint: (sentence) => checkpoints.push(sentence)
  });
  assert.equal(first.translation.records[0].status, "resolved");
  const checkpointIndex = new Map([[
    TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
    new Map(checkpoints.map((sentence) => {
      const payload = JSON.parse(sentence.fromtext.text);
      return [sentence.su.name, {
        hash: sentence.ob.text,
        resultSentence: sentence.to.la,
        resultLine: sentence.totext.text,
        exportFacts: payload.exports,
        scopeSlots: payload.scope
      }];
    }))
  ]]);

  resolved = false;
  const secondStages = [];
  const second = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "I walked.",
    locator: "fixture.txt",
    paths,
    adapterResolver,
    resourceHashes: { fixture: "two" },
    checkpointIndex,
    onStage: (stage) => secondStages.push(stage)
  });
  assert.deepEqual(secondStages, [
    "read source",
    "segment source",
    "translate sentences",
    "refine senses",
    "review vocabulary",
    "refine compounds",
    "render translation",
    "lower vliw",
    "write outputs"
  ]);
  assert.equal(second.translation.records[0].status, "resolved");
  assert.equal(second.translation.records[0].unresolved, undefined);
  assert.equal(second.translation.records[0].pyash, first.translation.records[0].pyash);
});

test("refinery artifact inspection reports pending sense links from the latest stage", () => {
  const checkpointIndex = new Map([[
    TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
    new Map([
      ["translate sentences", {
        hash: "translate-hash",
        resultSentence: {
          mood: "ya",
          be: "map",
          ob: { map: { translation: { records: [] } } }
        },
        resultLine: "translate output"
      }],
      ["refine senses", {
        hash: "sense-hash",
        resultSentence: {
          mood: "ya",
          be: "map",
          ob: {
            map: {
              translation: {
                wordnet: {
                  records: [{
                    id: "sense-record",
                    occurrenceId: "translation-occurrence-1",
                    sourceRecordId: "sentence-1",
                    tokenIndex: 2,
                    surface: "florp",
                    status: "review",
                    selectionStatus: "pending",
                    selectedSenseId: "v:one",
                    selectedSense: { gloss: "perform an action" },
                    anchorCandidates: [{ target: "activity", pyashSequence: ["twot"] }]
                  }]
                }
              }
            }
          }
        },
        resultLine: "sense output"
      }]
    ])
  ]]);
  const inspected = inspectTranslationRefineryArtifacts({ checkpointIndex });
  assert.equal(inspected.latestStage, "refine senses");
  assert.deepEqual(inspected.pendingSenseLinks.map((record) => ({
    occurrenceId: record.occurrenceId,
    surface: record.surface,
    selectedSenseId: record.selectedSenseId,
    selectedSenseWord: record.selectedSenseWord
  })), [{
    occurrenceId: "translation-occurrence-1",
    surface: "florp",
    selectedSenseId: "v:one",
    selectedSenseWord: "florp"
  }]);
});

test("source-to-VLIW pipeline forwards reconciled sense links into sentence analysis", async () => {
  const wordnetIndex = buildEnglishWordNetIndex({
    rows: [{
      id: "v:dynamic-v:florp",
      pos: "v",
      synset: "dynamic-v",
      senseKey: "dynamic-v",
      lemma: "florp",
      gloss: "express an emotional state"
    }]
  });
  const adapterResolver = () => ({
    name: "english",
    analyzeSentence: (source, options) => analyzeEnglishSentence(source, {
      ...options,
      wordnetIndex,
      resolveWord: (word) => word === "i"
        ? { coverageType: "grammar", pyashSequence: ["mi"] }
        : word === "emotionally"
          ? { coverageType: "atomic", pyashSequence: ["xyek"] }
          : null
    })
  });
  const result = await translateDocumentSegments({
    language: "english",
    text: "I florp.",
    segments: segmentTranslationDocument("I florp."),
    adapterResolver,
    resourceHashes: {},
    wordnetBridges: new Map([[
      "v:dynamic-v",
      {
        target: "emotionally",
        pyashSequence: ["xyek"],
        targetPartOfSpeech: "v",
        certainty: "contextual",
        evidence: "fixture Qwen decision"
      }
    ]])
  });
  const token = result.records[0].tokens.find((candidate) => candidate.surface === "florp");
  assert.equal(token.coverageType, "semantic-wordnet");
  assert.deepEqual(token.pyashSequence, ["xyek"]);
});

test("source-to-VLIW refinery closes the Qwen sense-link loop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-qwen-loop-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  const wordnetIndex = buildEnglishWordNetIndex({
    rows: [
      {
        id: "v:dynamic-v-one:florp",
        pos: "v",
        synset: "dynamic-v-one",
        senseKey: "dynamic-v-one",
        lemma: "florp",
        gloss: "like something"
      },
      {
        id: "v:dynamic-v-one:like",
        pos: "v",
        synset: "dynamic-v-one",
        senseKey: "dynamic-v-one",
        lemma: "like",
        gloss: "like something"
      },
      {
        id: "v:dynamic-v-two:florp",
        pos: "v",
        synset: "dynamic-v-two",
        senseKey: "dynamic-v-two",
        lemma: "florp",
        gloss: "dislike something"
      },
      {
        id: "v:dynamic-v-two:dislike",
        pos: "v",
        synset: "dynamic-v-two",
        senseKey: "dynamic-v-two",
        lemma: "dislike",
        gloss: "like something"
      }
    ]
  });
  const coverage = {
    byVariant: new Map([
      ["like", { coverageType: "atomic", canonicalEnglish: "like", pyashSequence: ["pyan"] }],
      ["dislike", { coverageType: "atomic", canonicalEnglish: "dislike", pyashSequence: ["twin"] }]
    ])
  };
  const adapterResolver = () => ({
    name: "english",
    analyzeSentence: (source, options) => analyzeEnglishSentence(source, {
      ...options,
      wordnetIndex,
      resolveWord: (word) => word === "i"
        ? { coverageType: "grammar", pyashSequence: ["mi"] }
        : coverage.byVariant.get(word) ?? null
    })
  });
  let submitted;
  const output = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "I florp.",
    locator: "fixture.txt",
    paths,
    adapterResolver,
    resourceHashes: {},
    checkpointEnabled: false,
    wordnetRefinery: {
      resources: {
        coverage,
        grammarCatalog: { entries: [] },
        wordnet: { index: wordnetIndex }
      },
      config: { maxBatch: 200, edgeMaxDegree: 1 },
      submit: async (request) => {
        submitted = request;
        return { status: "queued" };
      },
      awaitHandle: async () => JSON.stringify({
        verdict: "accept",
        senseId: "v:dynamic-v-one",
        confidence: "high",
        rationale: "fixture Qwen decision"
      })
    }
  });
  const record = output.translation.records[0];
  const florp = record.tokens.find((token) => token.surface === "florp");
  assert.equal(output.translation.wordnet.counts.accepted, 1);
  assert.equal(output.translation.wordnet.queuePending, 0);
  assert.equal(record.unresolved, undefined);
  assert.equal(florp.coverageType, "semantic-wordnet");
  assert.deepEqual(florp.pyashSequence, ["pyan"]);
  assert.equal(florp.lemma, "like");
});

test("source-to-VLIW refinery re-runs after an accepted Qwen vocabulary link", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-vocabulary-loop-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  let submitted;
  const output = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "I blorf.",
    locator: "fixture.txt",
    paths,
    checkpointEnabled: false,
    queueVocabulary: async (request) => {
      submitted = request;
      return { status: "queued" };
    },
    awaitVocabulary: async () => JSON.stringify({
      verdict: "complete",
      candidates: submitted.candidates.map((candidate) => ({
        id: candidate.id,
        status: "accept",
        targetEnglish: "love",
        rationale: "fixture Qwen vocabulary decision"
      }))
    })
  });
  const record = output.translation.records[0];
  const blorf = record.tokens.find((token) => token.surface === "blorf");
  assert.equal(output.result.vocabularyOutcome, "applied");
  assert.equal(record.unresolved, undefined);
  assert.equal(blorf.coverageType, "llm");
  assert.deepEqual(blorf.pyashSequence, ["pyan"]);
});

test("source-to-VLIW refinery feeds an accepted sense attachment through the anchor loop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-refinery-wordnet-anchor-loop-"));
  const paths = {
    translation: join(directory, "translation.pya"),
    catalog: join(directory, "catalog.pya"),
    pack: join(directory, "pack.pyac")
  };
  const wordnetIndex = buildEnglishWordNetIndex({
    rows: [
      {
        id: "v:anchor-v-one:florp",
        pos: "v",
        synset: "anchor-v-one",
        senseKey: "anchor-v-one",
        lemma: "florp",
        gloss: "perform an activity"
      },
      {
        id: "v:anchor-v-two:florp",
        pos: "v",
        synset: "anchor-v-two",
        senseKey: "anchor-v-two",
        lemma: "florp",
        gloss: "touch a surface"
      },
      {
        id: "v:anchor-activity:activity",
        pos: "v",
        synset: "anchor-activity",
        senseKey: "anchor-activity",
        lemma: "activity",
        gloss: "an activity"
      }
    ],
    relations: [{
      source: "v:anchor-v-one",
      target: "v:anchor-activity",
      relation: "hypernym"
    }]
  });
  const adapterResolver = () => ({
    name: "english",
    analyzeSentence: (source, options) => analyzeEnglishSentence(source, {
      ...options,
      wordnetIndex,
      resolveWord: (word) => word === "i"
        ? { coverageType: "grammar", pyashSequence: ["mi"] }
        : word === "activity"
          ? { coverageType: "atomic", canonicalEnglish: "activity", pyashSequence: ["twot"] }
        : null
    })
  });
  let vocabularyRequest;
  const output = await runTranslationSourceToVliwRefinery({
    language: "english",
    source: "I florp.",
    locator: "fixture.txt",
    paths,
    adapterResolver,
    checkpointEnabled: false,
    wordnetRefinery: {
      resources: {
        coverage: {
          byVariant: new Map([
            ["activity", {
              coverageType: "atomic",
              canonicalEnglish: "activity",
              pyashSequence: ["twot"]
            }]
          ])
        },
        grammarCatalog: { entries: [] },
        wordnet: { index: wordnetIndex }
      },
      config: { edgeMaxDegree: 1 },
      submit: async () => ({ status: "queued" }),
      awaitHandle: async () => JSON.stringify({
        verdict: "accept",
        option: 1,
        confidence: "high",
        rationale: "fixture selected activity sense"
      })
    },
    queueVocabulary: async (request) => {
      vocabularyRequest = request;
      return { status: "queued" };
    },
    awaitVocabulary: async () => JSON.stringify({
      verdict: "complete",
      candidates: [{
        id: vocabularyRequest.candidates[0].id,
        status: "accept",
        targetEnglish: "activity",
        rationale: "the selected sense describes an activity"
      }]
    })
  });
  const record = output.translation.records[0];
  const florp = record.tokens.find((token) => token.surface === "florp");
  assert.equal(output.result.vocabularyOutcome, "applied");
  assert.equal(output.translation.wordnet.records[0].status, "accepted-llm");
  assert.equal(output.translation.wordnet.records[0].link.target, "activity");
  assert.equal(output.translation.wordnet.records[0].selectedSenseId, "v:anchor-v-one");
  assert.equal(record.unresolved, undefined);
  assert.equal(florp.coverageType, "llm");
  assert.deepEqual(florp.pyashSequence, ["twot"]);
});
