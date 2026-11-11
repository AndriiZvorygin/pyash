import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  activateEnglishWordNetModelSweepLinks,
  parseEnglishWordNetModelSweepBatchPya,
  renderEnglishWordNetModelSweepBatchPya,
  runEnglishWordNetModelSweep,
  selectEnglishWordNetModelSweepPilotRecords
} from "../program/library/translation/english_wordnet_model_sweep.mjs";
import { parseEnglishWordNetBridgeCatalog } from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  ENGLISH_WORDNET_LINKER_CONFIG_URL,
  parseEnglishWordNetLinkerConfig
} from "../program/library/translation/english_wordnet_linker.mjs";

function pendingRecord(index, candidates = 1) {
  const id = `sense-${index}`;
  return {
    id,
    source: `n:${index}`,
    pos: "n",
    synset: String(index),
    lemmas: [`lemma-${index}`],
    gloss: `definition for lemma ${index}`,
    category: "needs-sense-choice",
    candidates: Array.from({ length: candidates }, (_, option) => ({
      target: `anchor-${index}-${option + 1}`,
      pyashSequence: [`atom${index}${option + 1}`],
      targetKind: "atom",
      targetId: `atom:atom${index}${option + 1}`,
      targetPartOfSpeech: "n",
      selectable: true,
      sourceLemmas: [`lemma-${index}`],
      evidence: "fixture accepted atom"
    }))
  };
}

test("model sense sweep persists sequential decisions and resumes completed batches", async (t) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), "pyash-wordnet-model-sweep-"));
  t.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const records = [pendingRecord(3), pendingRecord(2, 2), pendingRecord(1)];
  const pending = new Map();
  let submissions = 0;
  let active = 0;
  let peakActive = 0;
  const submit = async ({ handleId, candidates }) => {
    submissions += 1;
    pending.set(handleId, candidates);
    return { status: "queued" };
  };
  const awaitHandle = async (handleId) => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    const candidates = pending.get(handleId);
    assert.ok(candidates);
    const response = {
      verdict: "complete",
      senses: candidates.map((record) => ({
        id: record.id,
        status: "accept",
        targetEnglish: record.candidates[0].target,
        rationale: "The candidate matches the supplied WordNet definition."
      }))
    };
    await Promise.resolve();
    active -= 1;
    return JSON.stringify(response);
  };
  const options = {
    records,
    inventory: { entries: [], grammar: [] },
    sourceHash: "wordnet-source-hash",
    coverageHash: "coverage-hash",
    runId: "wordnet-link-sweep-test",
    model: "qwen3.5:9b",
    artifactDirectory,
    maxDutySenses: 2,
    rankForEnglish: (term) => Number(term.replace("lemma-", "")),
    submit,
    awaitHandle
  };

  const first = await runEnglishWordNetModelSweep(options);
  assert.equal(first.status, "complete");
  assert.equal(first.batchCount, 2);
  assert.deepEqual(first.counts, { accepted: 3, rejected: 0, uncertain: 0, completed: 3 });
  assert.equal(submissions, 2);
  assert.equal(peakActive, 1);
  const firstBatch = parseEnglishWordNetModelSweepBatchPya(
    await readFile(path.join(artifactDirectory, "batches", "batch-00001.pya"), "utf8")
  );
  assert.equal(firstBatch.runId, "wordnet-link-sweep-test");
  assert.deepEqual(firstBatch.records.map((record) => record.id), ["sense-1", "sense-2"]);
  assert.deepEqual(firstBatch.records.map((record) => record.english30kRank), [1, 2]);
  assert.equal(firstBatch.records[1].status, "accepted-llm");

  const resumed = await runEnglishWordNetModelSweep(options);
  assert.equal(resumed.records.length, 3);
  assert.equal(submissions, 2);
});

test("model sweep batch artifacts retain stable identities and record decisions", () => {
  const source = renderEnglishWordNetModelSweepBatchPya({
    runId: "model-run",
    sourceHash: "source",
    coverageHash: "coverage",
    batchIndex: 2,
    model: "qwen3.5:9b",
    records: [{ id: "sense-2", status: "uncertain-llm", verificationRationale: "definition does not choose" }]
  });
  const parsed = parseEnglishWordNetModelSweepBatchPya(source);
  assert.equal(parsed.batchIndex, 2);
  assert.equal(parsed.records[0].id, "sense-2");
  assert.equal(parsed.records[0].status, "uncertain-llm");
});

test("model sweep artifacts preserve the exact submitted prompt", () => {
  const prompt = "First instruction.\nJSON only: {\"status\":\"accept\"}";
  const source = renderEnglishWordNetModelSweepBatchPya({
    runId: "model-run",
    sourceHash: "source",
    coverageHash: "coverage",
    batchIndex: 1,
    model: "qwen3.5:9b",
    prompt,
    records: [{ id: "sense-1", status: "uncertain-llm" }]
  });
  assert.equal(parseEnglishWordNetModelSweepBatchPya(source).prompt, prompt);
});

test("pilot selection includes choice cases and samples single anchors across parts of speech", () => {
  const records = [
    pendingRecord("n1"),
    pendingRecord("n2"),
    pendingRecord("multi1", 2),
    pendingRecord("v1"),
    pendingRecord("multi2", 2),
    pendingRecord("a1"),
    pendingRecord("multi3", 2),
    pendingRecord("r1"),
    pendingRecord("s1"),
    pendingRecord("multi4", 2)
  ].map((record) => {
    const suffix = record.id.slice("sense-".length);
    return { ...record, pos: suffix.startsWith("multi") ? "n" : suffix[0] };
  });
  const selected = selectEnglishWordNetModelSweepPilotRecords(records, 7, {
    maxMultipleChoice: 4,
    rankForEnglish: (lemma) => lemma.endsWith("v1") ? 1 : lemma.endsWith("n2") ? 2 : lemma.endsWith("a1") ? 3 : Number.POSITIVE_INFINITY
  });
  assert.equal(selected.length, 7);
  assert.deepEqual(selected.filter((row) => row.id.startsWith("sense-multi")).map((row) => row.id), [
    "sense-multi1", "sense-multi2", "sense-multi3", "sense-multi4"
  ]);
  assert.deepEqual(
    selected.filter((row) => !row.id.startsWith("sense-multi")).map((row) => row.id),
    ["sense-v1", "sense-n2", "sense-a1"]
  );
  assert.deepEqual(selected.slice(0, 3).map((row) => row.id), ["sense-v1", "sense-n2", "sense-a1"]);
});

test("WordNet linker configuration defaults the model workflow to its bounded pilot", async () => {
  const config = parseEnglishWordNetLinkerConfig(await readFile(ENGLISH_WORDNET_LINKER_CONFIG_URL, "utf8"));
  assert.equal(config.modelSweepMode, "pilot");
  assert.equal(config.modelSweepPilotLimit, 12);
  assert.equal(config.modelSweepPilotMultipleChoiceLimit, 2);
});

test("accepted Qwen links activate only when their target identities remain collision-free", () => {
  const catalog = [
    "su name translation_english_wordnet_bridges be map def",
    'su text "format" ob text "english-wordnet-bridge-v1" ya',
    'su text "source" ob text "Open English WordNet 2025" ya',
    'su text "mode" ob text "sense-level semantic bridge" ya',
    "prah",
    ""
  ].join("\n");
  const accepted = {
    source: "n:sample",
    pos: "n",
    synset: "sample",
    gloss: "a sample gloss",
    lemmas: ["sample", "specimen"],
    status: "accepted-llm",
    verificationRationale: "sample matches the definition",
    link: {
      target: "sample",
      pyashSequence: ["smal"],
      targetKind: "atom",
      targetId: "atom:smal",
      targetPartOfSpeech: "n"
    }
  };
  const result = activateEnglishWordNetModelSweepLinks({
    catalogSource: catalog,
    records: [accepted],
    runId: "model-run",
    sourceHash: "source-hash",
    model: "qwen3.5:9b",
    resolveTarget: () => ({ pyashSequence: ["smal"], coverageType: "atomic" })
  });
  assert.deepEqual(result.activated, ["n:sample"]);
  const activeEntry = parseEnglishWordNetBridgeCatalog(result.catalog).entries[0];
  assert.equal(activeEntry.gloss, "a sample gloss");
  assert.deepEqual(activeEntry.lemmas, ["sample", "specimen"]);
  assert.match(result.catalog, /with text "contextual"/u);
  assert.match(result.catalog, /model qwen3\.5:9b/u);
});
