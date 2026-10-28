import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseVliwCatalogPya } from "../program/library/vliw/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { runTranslationDocument } from "../command/translate_document.mjs";
import { translation_from_filename_to_vliw } from "../program/verbs/exchange/translation.mjs";
import {
  decodeCheckpointText,
  encodeCheckpointText
} from "../command/run_pya_helpers.mjs";
import {
  lowerTranslationToPyac,
  parseTranslationPipelinePya,
  renderTranslationPipelinePya,
  projectTranslationSentence,
  segmentTranslationDocument,
  translateDocumentSegments,
  translateDocument,
  mergeTranslationArtifacts
} from "../program/verbs/exchange/translation/translation_pipeline.mjs";
import {
  renderPyashSentenceSurface,
  renderPyashSurface
} from "../program/verbs/exchange/translation/pyash_surface.mjs";
import { lowerSentencePhraseVliw } from "../program/library/vliw/phrase.mjs";
import { TRANSLATION_SENSE_STATE_FORMAT } from "../program/verbs/exchange/translation/translation_occurrence.mjs";

test("Pyash surface rendering fuses endings and preserves sentence-final moods", () => {
  assert.equal(
    renderPyashSurface("hpap wu cyak te sa ye hnim na swut pyoh jwih"),
    "hpapwu cyakte saye hnimna swutpyohjwih"
  );
  assert.equal(
    renderPyashSurface("nyah yi tren myah nyah ye dlat ci hpup ka kwin pcih"),
    "nyahyi trenmyah nyahye dlatci hpupka kwinpcih"
  );
  assert.equal(
    renderPyashSurface("pfin ki vi hcas pu ka"),
    "pfinkivi hcaspuka"
  );
  assert.equal(renderPyashSurface("cyah tlih"), "cyahtlih");
  assert.equal(renderPyashSurface("cyah tlah"), "cyahtlah");
  assert.equal(renderPyashSurface("ya no"), "yano");
  assert.equal(renderPyashSurface("clah tlih"), "clahtlih");
  assert.equal(renderPyashSurface("pfin ra no ya"), "pfinra noya");
});

test("Pyash sentence surface rendering keeps canonical sentence structure available", () => {
  assert.equal(
    renderPyashSentenceSurface({
      su: { name: "nyah ye hcas pu" },
      be: "pfin ki",
      mood: "ya"
    }),
    "nyahye hcaspu pfinkiya"
  );
  assert.equal(
    renderPyashSentenceSurface({
      su: { name: "mi" },
      ob: { name: "nyah ye hcas pu" },
      be: "pfin ki",
      mood: "ya"
    }),
    "mi nyahye hcaspu pfinkiya"
  );
});

test("translation segmentation preserves sentence text and source offsets", () => {
  const source = "I walked.\nYou ran! 世界。";
  assert.deepEqual(segmentTranslationDocument(source), [
    {
      text: "I walked.",
      startOffset: 0,
      endOffset: 9,
      sentenceIndex: 0,
      lineIndex: 0
    },
    {
      text: "You ran!",
      startOffset: 10,
      endOffset: 18,
      sentenceIndex: 1,
      lineIndex: 1
    },
    {
      text: "世界。",
      startOffset: 19,
      endOffset: 22,
      sentenceIndex: 2,
      lineIndex: 1
    }
  ]);
});

test("English translation uses the shared resources and retains unresolved vocabulary", async () => {
  const result = await translateDocument({
    language: "english",
    text: "our houses walked.\nI walked blorf.",
    locator: "fixture.txt"
  });

  assert.deepEqual(result.counts, { resolved: 1, provisional: 1, unresolved: 0 });
  assert.equal(result.records[0].pyash, "ya su our houses be walked.");
  assert.equal(result.records[0].structural, "su name nyah ye hcas pu na be pfin ki ya");
  assert.equal(result.records[0].pyac, "nyahye hcaspuna pfinkiya");
  assert.equal(result.records[0].englishPyash, result.records[0].pyash);
  assert.equal(result.records[0].englishPyash, "ya su our houses be walked.");
  assert.equal(result.records[0].vliw.format, "pyac-vliw-phrase-v1");
  assert.equal(result.records[0].vliw.vectors.length, 1);
  assert.deepEqual(result.records[0].vliw.phraseEnds, [4]);
  assert.equal(result.records[0].canonical, "our houses walked.");
  assert.equal(result.records[1].status, "provisional");
  assert.equal(result.resourceHashes.english30k.length, 64);
  assert.equal(result.resourceHashes.englishLemmas.length, 64);
  assert.equal(result.resourceHashes.englishGrammar.length, 64);
  assert.deepEqual(result.records[1].unresolved, ["blorf"]);
  assert.equal(result.vocabularyCandidates.length, 1);
  assert.equal(result.vocabularyCandidates[0].surface, "blorf");
  assert.equal(result.vocabularyCandidates[0].status, "queued");
  assert.equal(result.vocabularyCandidates[0].sourceRecordId, result.records[1].id);
});

test("English paragraph reuses the accepted involve compound before vocabulary review", async () => {
  const result = await translateDocument({
    language: "english",
    text: "Love involves caring for another.",
    locator: "fixture.txt"
  });
  const involves = result.records[0].tokens.find((token) => token.surface === "involves");
  assert.equal(involves.coverageType, "compound");
  assert.deepEqual(involves.pyashSequence, ["lwak", "hzan"]);
  assert.deepEqual(result.records[0].unresolved, ["caring"]);
});

test("accepted lexical verb and complete phrases produce a full sentence", async () => {
  const source = "Love involves caring for another.";
  const result = await translateDocumentSegments({
    language: "english",
    text: source,
    segments: segmentTranslationDocument(source),
    locator: "fixture.txt",
    coverageOverrides: new Map([
      ["caring", {
        coverageType: "llm",
        canonicalEnglish: "nurture",
        lemma: "nurture",
        pyashSequence: ["xyen"]
      }]
    ])
  });

  assert.equal(result.records[0].status, "resolved");
  assert.equal(result.records[0].pyash, "ya su love be include ob nurture for another.");
  assert.equal(result.records[0].pyac, "pyanna xyenka clahtlihpwah lwakhzanraya");
  assert.deepEqual(result.records[0].unresolved, undefined);
});

test("translation records coordinated clauses with their source connectors", async () => {
  const source = "Romantic love can lead to dating, but a person can also feel for friends.";
  const result = await translateDocument({
    language: "english",
    text: source,
    locator: "fixture.txt"
  });
  const record = result.records[0];

  assert.equal(record.clauses.length, 2);
  assert.match(record.clauses[1].source, /^but a person can also feel/u);
  assert.equal(record.clauses[1].connector, "but");
  assert.deepEqual(record.clauses[1].connectorPyashSequence, ["pyuh"]);
  assert.equal(record.clauses[1].action.phrase, "can also feel");
  assert.deepEqual(projectTranslationSentence(record).clauses, record.clauses);

  const roundTrip = parseTranslationPipelinePya(renderTranslationPipelinePya(result));
  assert.deepEqual(roundTrip.records[0].clauses, record.clauses);
});

test("resolved coordinated clauses become separate Pyash sentences and VLIW codelets", async () => {
  const source = "Romantic love can lead to dating, but a person can also feel for friends.";
  const result = await translateDocumentSegments({
    language: "english",
    text: source,
    segments: segmentTranslationDocument(source),
    locator: "fixture.txt",
    coverageOverrides: new Map([
      ["feel", {
        coverageType: "llm",
        canonicalEnglish: "emotionally",
        lemma: "emotionally",
        pyashSequence: ["xyek"]
      }]
    ])
  });
  const record = result.records[0];
  assert.equal(record.status, "resolved");
  assert.equal(record.sentences.length, 2);
  assert.equal(record.sentences[0].connector, null);
  assert.equal(record.sentences[1].connector, "but");
  assert.deepEqual(record.sentences[1].connectorPyashSequence, ["pyuh"]);
  assert.equal(record.pyash.length, 2);
  assert.equal(record.pyac.length, 2);
  assert.match(record.pyash[1], /^but can su /u);

  const projection = projectTranslationSentence(record);
  assert.deepEqual(projection.sentences.map(({ connector }) => connector), [null, "but"]);
  assert.equal(projection.pyash.length, 2);
  const database = lowerTranslationToPyac(result);
  assert.equal(database.catalog.executableCount, 2);
  assert.deepEqual(database.sourceRecordIds, [
    `${record.id}:clause-0`,
    `${record.id}:clause-1`
  ]);
});

test("translation records additive existential structure without inventing a brain action", async () => {
  const source = "There are also chemical reactions within the brain that can be triggered by the different types of love.";
  const result = await translateDocument({
    language: "english",
    text: source,
    locator: "fixture.txt"
  });
  const record = result.records[0];

  assert.equal(record.status, "provisional");
  assert.equal(record.construction, "existential-clause");
  assert.deepEqual(record.existential.pyashSequence, ["syi7h"]);
  assert.deepEqual(record.discourseConnectors, [{
    surface: "also",
    pyashSequence: ["pcah"],
    scope: "sentence",
    evidence: "also connects the existential clause to the preceding discourse"
  }]);
  assert.match(record.structuralPreview, /^pcah /u);
  assert.match(record.structuralPreview, / syi7h$/u);
  assert.ok(record.structuralPreview.indexOf("la") < record.structuralPreview.indexOf("ryik"));
  assert.equal((record.candidates ?? []).some((candidate) => candidate.phrase === "brain"), false);
  assert.equal(record.relativeClauses[0].construction, "passive-relative-clause");
  assert.deepEqual(record.relativeClauses[0].action.pyashSequence, ["txak", "pyoh", "tseh"]);
  assert.ok(record.relativeClauses[0].pyashSequence.indexOf("je") < record.relativeClauses[0].pyashSequence.indexOf("txak"));
  const projection = projectTranslationSentence(record);
  assert.deepEqual(projection.pyash.find((part) => part.source === "can").sequence, ["tseh"]);
  assert.deepEqual(projection.pyac.find((part) => part.source === "can").sequence, ["tseh"]);
  assert.deepEqual(projection.pyac.find((part) => part.source === "be").sequence, ["pyoh"]);
});

test("translation artifact merging never downgrades an accepted occurrence", () => {
  const prior = {
    sourceHash: "same-source",
    records: [{
      id: "sentence-1",
      status: "resolved",
      sentence: { mood: "ya", su: { name: "mi" }, be: "pfin", ob: { name: "lwak hzan" } },
      tokens: [{
        occurrenceId: "translation-occurrence-1",
        surface: "involve",
        coverageType: "compound",
        pyashSequence: ["lwak", "hzan"]
      }]
    }],
    vocabularyCandidates: [{
      id: "translation-occurrence-1",
      occurrenceId: "translation-occurrence-1",
      surface: "involve",
      status: "accepted-llm",
      pyashSequence: ["lwak", "hzan"]
    }, {
      id: "translation-occurrence-2",
      occurrenceId: "translation-occurrence-2",
      surface: "caring",
      status: "queued"
    }]
  };
  const fresh = {
    sourceHash: "same-source",
    records: [{
      id: "sentence-1",
      status: "unresolved",
      unresolved: ["involve"],
      tokens: [{
        occurrenceId: "translation-occurrence-1",
        surface: "involve",
        coverageType: "unresolved",
        pyashSequence: []
      }]
    }],
    vocabularyCandidates: [{
      id: "translation-occurrence-1",
      occurrenceId: "translation-occurrence-1",
      surface: "involve",
      status: "queued"
    }]
  };
  const merged = mergeTranslationArtifacts(fresh, prior);
  assert.equal(merged.records[0].status, "resolved");
  assert.equal(merged.records[0].unresolved, undefined);
  assert.deepEqual(merged.records[0].tokens[0].pyashSequence, ["lwak", "hzan"]);
  assert.equal(merged.vocabularyCandidates.length, 1);
  assert.equal(merged.vocabularyCandidates[0].status, "accepted-llm");
});

test("translation persists sense candidates per stable source occurrence", async () => {
  const senseCandidates = [{
    pos: "v",
    synset: "florp-one",
    lemma: "florp",
    lemmas: ["florp"],
    gloss: "perform an unspecified action"
  }];
  const result = await translateDocument({
    language: "english",
    text: "Florp. Florp.",
    adapterResolver: () => ({
      name: "english",
      analyzeSentence: async () => ({
        format: "english-sentence-v1",
        status: "review",
        unresolved: ["florp"],
        candidates: [],
        tokens: [{
          surface: "florp",
          coverageType: "unresolved",
          pyashSequence: [],
          wordnet: { senses: senseCandidates }
        }]
      })
    }),
    resourceHashes: {}
  });
  const candidates = result.vocabularyCandidates;
  assert.equal(result.senseStateFormat, TRANSLATION_SENSE_STATE_FORMAT);
  assert.equal(candidates.length, 2);
  assert.equal(new Set(candidates.map((candidate) => candidate.occurrenceId)).size, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.tokenIndex), [0, 0]);
  assert.deepEqual(candidates.map((candidate) => candidate.senseCandidates[0].synset), [
    "florp-one",
    "florp-one"
  ]);
  const parsed = parseTranslationPipelinePya(renderTranslationPipelinePya(result));
  assert.match(renderTranslationPipelinePya(result), /ob text quoted\.text\.\{/u);
  assert.equal(parsed.senseStateFormat, TRANSLATION_SENSE_STATE_FORMAT);
  assert.equal(parsed.records[0].pyash, result.records[0].pyash);
  assert.equal(parsed.records[0].structural, result.records[0].structural);
  assert.equal(parsed.records[0].pyashSurface, undefined);
  assert.deepEqual(parsed.records.map((record) => record.tokens[0].occurrenceId), [
    result.records[0].tokens[0].occurrenceId,
    result.records[1].tokens[0].occurrenceId
  ]);
});

test("English subject nominative lowers to the fused Pyac form", async () => {
  const result = await translateDocument({
    language: "english",
    text: "I walked our houses."
  });
  assert.equal(result.records[0].canonical, "I walked our houses.");
  assert.equal(result.records[0].pyash, "ya su I be walked ob our houses.");
  assert.equal(result.records[0].structural, "su name mi na ob name nyah ye hcas pu ka be pfin ki ya");
  assert.equal(result.records[0].pyac, "mina nyahye hcaspuka pfinkiya");
  assert.equal(result.records[0].englishPyash, result.records[0].pyash);
  assert.equal(result.records[0].englishPyash, "ya su I be walked ob our houses.");
});

test("translation pipeline renders compositional cases at the phrase boundary", async () => {
  const result = await translateDocument({
    language: "english",
    text: "I walked into houses."
  });
  assert.equal(result.records[0].pyash, "ya su I be walked into houses.");
  assert.equal(result.records[0].structural, "su name mi na ob name hcas pu twih be pfin ki ya");
  assert.equal(result.records[0].pyac, "mina hcasputwih pfinkiya");
  assert.equal(result.records[0].englishPyash, "ya su I be walked into houses.");
});

test("sentence verification can resolve a contextual candidate through the pipeline", async () => {
  const calls = [];
  const result = await translateDocument({
    language: "english",
    text: "I walking.",
    verify: async ({ candidates, context }) => {
      calls.push({ candidates, context });
      return {
        verdict: "accept",
        candidateId: candidates[0].id,
        rationale: "fixture context selects the progressive predicate"
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, ["I walking."]);
  assert.equal(result.records[0].status, "resolved");
  assert.equal(result.records[0].pyash, "ya su I be walking.");
  assert.equal(result.records[0].structural, "su name mi na be pfin pfih ya");
});

test("registered structured adapters share the document pipeline", async () => {
  const samples = [
    ["chinese", "加 2 到 collector。"],
    ["french", "ajoute 2 a collector."],
    ["hindi", "collector में 2 जोड़ो।"],
    ["interlingua", "adde 2 a collector."],
    ["russian", "прибавь 2 к collector."]
  ];
  for (const [language, source] of samples) {
    const result = await translateDocument({ language, text: source });
    assert.deepEqual(result.counts, { resolved: 1, provisional: 0, unresolved: 0 }, language);
    assert.equal(result.records[0].status, "resolved", language);
  }
});

test("pipeline records round-trip and only resolved sentences enter Pyac", async () => {
  const result = await translateDocument({
    language: "english",
    text: "collector is number 5.\nadd 2 to collector.",
    locator: "fixture.txt"
  });
  const parsed = parseTranslationPipelinePya(renderTranslationPipelinePya(result));
  const database = lowerTranslationToPyac(result);

  assert.equal(parsed.format, "translation-pipeline-v1");
  assert.deepEqual(parsed.resourceHashes, result.resourceHashes);
  assert.equal(parsed.records.length, 2);
  assert.equal(database.sourceRecordIds.length, 2);
  assert.equal(database.catalog.executableCount, 1);
  assert.equal(database.catalog.unsupportedCount, 1);
  assert.deepEqual(database.skippedRecordIds, []);
});

test("translation lowering preserves phrase VLIW for resolved subject/object sentences", () => {
  const sentence = {
    mood: "ya",
    su: { name: "pyan na" },
    ob: { name: "tlih kcin crin ka cyah tlih ba ya tlih pwah" },
    be: "sren ra"
  };
  const phraseVliw = lowerSentencePhraseVliw(sentence);
  const database = lowerTranslationToPyac({
    language: "english",
    locator: "fixture.txt",
    records: [{
      id: "translation-sentence-0",
      status: "resolved",
      sentence,
      vliw: phraseVliw,
      source: {
        sentenceIndex: 0,
        lineIndex: 0,
        startOffset: 0,
        endOffset: 10,
        text: "fixture sentence."
      }
    }]
  });

  assert.equal(database.catalog.records.length, 1);
  assert.equal(database.catalog.records[0].status, "executable");
  assert.equal(database.catalog.records[0].semantic, "phrase-vliw");
  assert.equal(database.catalog.records[0].error, undefined);
  assert.deepEqual(database.catalog.records[0].sentence, sentence);
  assert.equal(database.catalog.records[0].words.length, 16);
});

test("translation document command writes durable evidence and Pyac outputs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-"));
  const source = join(directory, "source.txt");
  const translation = join(directory, "translation.pya");
  const catalog = join(directory, "catalog.pya");
  const pack = join(directory, "pack.pyac");
  writeFileSync(source, "collector is number 5.\nadd 2 to collector.\n", "utf8");

  const reports = [];
  const result = await runTranslationDocument([
    "english", source, translation, catalog, pack
  ], { report: (value) => reports.push(value) });

  assert.equal(result.result.records, 2);
  assert.equal(result.result.executable, 1);
  assert.equal(parseTranslationPipelinePya(readFileSync(translation, "utf8")).records.length, 2);
  assert.equal(parseVliwCatalogPya(readFileSync(catalog, "utf8")).catalog.records.length, 2);
  assert.equal(readFileSync(pack).length > 32, true);
  assert.equal(reports.length, 1);
});

test("translation document goal mode keeps all output artifacts in one run folder", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-goal-"));
  const source = join(directory, "source.txt");
  const runId = "goal-mode-translation";
  writeFileSync(source, "collector is number 5.\nadd 2 to collector.\n", "utf8");

  await runTranslationDocument(
    ["english", source, join(directory, "old-translation.pya"), join(directory, "old-catalog.pya"), join(directory, "old.pyac")],
    {
      runId,
      checkpointCwd: directory,
      checkpointEnabled: true,
      report: () => {}
    }
  );
  const stages = [];

  const result = await runTranslationDocument(
    ["english", source, "vliw"],
    {
      runId,
      checkpointCwd: directory,
      artifactCwd: directory,
      onStage: (stage) => stages.push(stage),
      report: () => {}
    }
  );

  const artifactFolder = join(directory, "artifacts", runId);
  assert.equal(result.result.goal, "vliw");
  assert.equal(result.result.artifactFolder, artifactFolder);
  assert.equal(result.result.translation, join(artifactFolder, "translation.pya"));
  assert.equal(result.result.catalog, join(artifactFolder, "vliw-catalog.pya"));
  assert.equal(result.result.pack, join(artifactFolder, "vliw.pyac"));
  assert.deepEqual(stages, ["lower vliw", "write outputs"]);
  assert.equal(readFileSync(result.result.translation, "utf8").includes("translation-pipeline-v1"), true);
  assert.equal(parseVliwCatalogPya(readFileSync(result.result.catalog, "utf8")).catalog.records.length, 2);
  assert.equal(readFileSync(result.result.pack).length > 32, true);
});

test("the Pyash source-to-VLIW translation operation uses one injected artifact job", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-operation-"));
  const source = join(directory, "source.txt");
  const runId = "translation-operation";
  writeFileSync(source, "collector is number 5.\nadd 2 to collector.\n", "utf8");

  const result = await translation_from_filename_to_vliw({
    mood: "do",
    be: "translation",
    from: { filename: source },
    fromstate: { name: "english" },
    become: { name: "vliw" },
    to: { name: "translation result", nameTypeWords: ["map"] }
  }, {
    cwd: directory,
    runId,
    translationDependencies: {
      queueVocabulary: null,
      awaitVocabulary: null,
      wordnetRefinery: null,
      compoundTranslation: null
    }
  });

  const artifactFolder = join(directory, "artifacts", runId);
  assert.equal(result.be, "map");
  assert.equal(result.ob.map.goal.text, "vliw");
  assert.equal(result.ob.map.artifactFolder.text, artifactFolder);
  assert.equal(readFileSync(result.ob.map.translation.text, "utf8").includes("translation-pipeline-v1"), true);
  assert.equal(parseVliwCatalogPya(readFileSync(result.ob.map.catalog.text, "utf8")).catalog.records.length, 2);
  assert.equal(readFileSync(result.ob.map.pack.text).length > 32, true);
  assert.deepEqual(JSON.parse(result.ob.map.sentences.text), [
    {
      original: "collector is number 5.",
      pyash: [],
      pyac: "collector 5 numberya",
      status: "resolved"
    },
    {
      original: "add 2 to collector.",
      pyash: [],
      pyac: "2 plusdo",
      status: "resolved"
    }
  ]);
  const serialized = sentenceToPyash(result);
  assert.match(serialized, new RegExp(`artifactFolder ob text ${JSON.stringify(artifactFolder)}`));
  assert.match(serialized, new RegExp(`pack ob text ${JSON.stringify(join(artifactFolder, "vliw.pyac"))}`));
});

test("translation document resumes unchanged stages from its Pyash checkpoint newspaper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-resume-"));
  const source = join(directory, "source.txt");
  const translation = join(directory, "translation.pya");
  const catalog = join(directory, "catalog.pya");
  const pack = join(directory, "pack.pyac");
  const runId = "translation-resume-checkpoint";
  writeFileSync(source, "collector is number 5.\nadd 2 to collector.\n", "utf8");
  const firstStages = [];
  const first = await runTranslationDocument(
    ["english", source, translation, catalog, pack],
    {
      report: () => {},
      runId,
      checkpointCwd: directory,
      onStage: (stage) => firstStages.push(stage)
    }
  );
  const newspaper = join(directory, "newspaper", `${runId}.pya`);
  const newspaperText = readFileSync(newspaper, "utf8");
  assert.equal(firstStages.length, 9);
  assert.equal((newspaperText.match(/be checkpoint/gu) ?? []).length, 9);
  const secondStages = [];
  const second = await runTranslationDocument(
    ["english", source, translation, catalog, pack],
    {
      report: () => {},
      runId,
      checkpointCwd: directory,
      onStage: (stage) => secondStages.push(stage)
    }
  );
  assert.deepEqual(secondStages, []);
  assert.equal(second.result.runId, runId);
  assert.equal(second.result.checkpointPath, newspaper);
  assert.equal(second.result.packHash, first.result.packHash);
});

test("checkpoint text escaping preserves newlines, literal escapes, and noisy payload text", () => {
  const source = "line one\nline two\\n\\u000a\rline three";
  const encoded = encodeCheckpointText(source);
  assert.equal(encoded.includes("\n"), false);
  assert.equal(encoded.includes("\r"), false);
  assert.equal(decodeCheckpointText(encoded), source);
  assert.equal(decodeCheckpointText("checkpoint noise"), "checkpoint noise");
});

test("translation catalogs keep repeated vocabulary gaps replayable", async () => {
  const source = readFileSync("examples/translation/simple-english-wikipedia-love.txt", "utf8");
  const result = await translateDocument({
    language: "english",
    text: source,
    locator: "https://simple.wikipedia.org/wiki/Love#Beginning"
  });
  const ids = result.vocabularyCandidates.map((candidate) => candidate.id);
  assert.equal(new Set(ids).size, ids.length);
  const parsed = parseTranslationPipelinePya(renderTranslationPipelinePya(result));
  assert.equal(parsed.records.length, 4);
  assert.equal(parsed.vocabularyCandidates.length, result.vocabularyCandidates.length);
});

test("English zero-copula clauses lower through the VLIW projection", async () => {
  const result = await translateDocument({
    language: "english",
    text: "Love is a mix of feelings and actions.",
    locator: "https://simple.wikipedia.org/wiki/Love#Beginning"
  });
  assert.equal(result.records[0].status, "resolved");
  assert.equal(result.records[0].sentence.be, undefined);
  assert.equal(result.records[0].pyac, "pyanna tlih mratka xyekpu wa twottiya");
  assert.equal(result.records[0].englishPyash, "ya su love ob a mixed of emotionallys and activity.");
  assert.deepEqual(result.records[0].phrases.map((phrase) => [phrase.slot, phrase.start, phrase.end]), [
    ["su", 0, 1],
    ["ob", 2, 8]
  ]);
  assert.deepEqual(result.vocabularyCandidates, []);
});

test("translation document submits vocabulary review through the injected queue", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pyash-translation-queue-"));
  const source = join(directory, "source.txt");
  const translation = join(directory, "translation.pya");
  const catalog = join(directory, "catalog.pya");
  const pack = join(directory, "pack.pyac");
  writeFileSync(source, "Love involves caring for another.\n", "utf8");
  const submissions = [];
  const reports = [];
  const output = await runTranslationDocument(
    ["english", source, translation, catalog, pack],
    {
      report: (value) => reports.push(JSON.parse(value)),
      queueVocabulary: async (request) => {
        submissions.push(request);
        return { status: "queued", ob: { text: "queued" } };
      }
    }
  );
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions.map((request) => request.candidates.length), [1]);
  assert.match(submissions[0].prompt, /Pyash vocabulary review worker/u);
  assert.equal(reports[0].vocabularySubmitted, 1);
  assert.equal(output.translation.vocabularyQueue.status, "queued");
  assert.equal(output.translation.vocabularyCandidates.every((candidate) => candidate.queue?.handleId), true);
  const parsed = parseTranslationPipelinePya(readFileSync(translation, "utf8"));
  assert.equal(parsed.vocabularyCandidates.every((candidate) => candidate.queue?.status === "queued"), true);
});
