import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseVliwCatalogPya } from "../program/library/vliw/index.mjs";
import { runTranslationDocument } from "../command/translate_document.mjs";
import {
  lowerTranslationToPyac,
  parseTranslationPipelinePya,
  renderTranslationPipelinePya,
  segmentTranslationDocument,
  translateDocument
} from "../program/verbs/exchange/translation/translation_pipeline.mjs";
import {
  renderPyashSentenceSurface,
  renderPyashSurface
} from "../program/verbs/exchange/translation/pyash_surface.mjs";

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
  assert.equal(result.records[0].pyash, "su name nyah ye hcas pu na be pfin ki ya");
  assert.equal(result.records[0].pyac, "nyahye hcaspuna pfinkiya");
  assert.equal(result.records[0].pyashSurface, "nyahye hcaspuna pfinkiya");
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

test("English subject nominative lowers to the fused Pyac form", async () => {
  const result = await translateDocument({
    language: "english",
    text: "I walked our houses."
  });
  assert.equal(result.records[0].canonical, "I walked our houses.");
  assert.equal(result.records[0].pyash, "su name mi na ob name nyah ye hcas pu ka be pfin ki ya");
  assert.equal(result.records[0].pyac, "mina nyahye hcaspuka pfinkiya");
  assert.equal(result.records[0].pyashSurface, "mina nyahye hcaspuka pfinkiya");
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
  assert.equal(result.records[0].pyash, "su name mi na be pfin pfih ya");
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
