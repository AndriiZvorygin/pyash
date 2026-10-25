import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadSuiteSamples } from "../../program/runtime/criterion/datasets.mjs";
import { runCriterion, scoreSample } from "../../program/runtime/criterion/run.mjs";
import { chrfScore } from "../../program/runtime/criterion/translation.mjs";
import { renderRunMarkdown } from "../../program/runtime/criterion/report.mjs";
import { resolveProfile } from "../../program/runtime/criterion/ollama.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pyash-criterion-translation-"));
}

async function writeDataset(root, rows) {
  const filepath = path.join(root, "flores.jsonl");
  await fs.writeFile(filepath, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return filepath;
}

function metadataProvider({ model }) {
  return Promise.resolve({ model, modelDigest: `digest-${model}`, quantization: "test" });
}

test("chrF rewards exact translation and penalizes a changed sentence", () => {
  assert.equal(chrfScore(["The house is large."], "The house is large."), 100);
  assert.ok(chrfScore(["The house is large."], "The house is small.") < 100);
  assert.equal(scoreSample({ suiteKey: "flores-200", sample: { references: ["Bonjour le monde."] }, output: "Bonjour le monde." }).chrf, 100);
});

test("FLORES adapter normalizes language pairs and preserves direction metadata", async () => {
  const root = await tempRoot();
  const dataset = await writeDataset(root, [{
    id: "eng-fra-1",
    source_language: "eng_Latn",
    target_language: "fra_Latn",
    source: "Hello world.",
    reference: "Bonjour le monde."
  }]);
  const loaded = await loadSuiteSamples({ benchmark: "flores-200", datasetPath: dataset });
  assert.equal(loaded.samples.length, 1);
  assert.equal(loaded.samples[0].metadata.direction, "eng_Latn→fra_Latn");
  assert.match(loaded.samples[0].prompt, /from eng_Latn to fra_Latn/u);
  assert.equal(loaded.samples[0].reference, "Bonjour le monde.");
});

test("FLORES Criterion runs score chrF, group directions, and render replay evidence", async () => {
  const root = await tempRoot();
  const dataset = await writeDataset(root, [
    { id: "eng-fra-1", source_language: "eng", target_language: "fra", source: "Hello.", reference: "Bonjour." },
    { id: "fra-eng-1", source_language: "fra", target_language: "eng", source: "Bonjour.", reference: "Hello." }
  ]);
  const run = await runCriterion({
    benchmark: "flores-200",
    datasetPath: dataset,
    models: ["qwen3.8:27b"],
    profile: "translation_direct",
    runId: "flores-translation",
    root,
    executor: async ({ sample }) => ({ text: sample.reference, timing: { outputTokens: 2, totalElapsedMs: 10 } }),
    metadataProvider
  });
  assert.equal(run.status, "completed");
  assert.equal(run.results.length, 2);
  assert.equal(run.aggregates[0].aggregate.chrf, 100);
  assert.equal(run.evaluationAggregates.length, 2);
  assert.equal(run.evaluationAggregates[0].direction, "eng→fra");
  assert.equal(run.profile, "translation_direct");
  assert.equal(resolveProfile("translation_direct").temperature, 0);
  assert.match(renderRunMarkdown(run), /chrF/u);
  assert.match(renderRunMarkdown(run), /translationQuality/u);
  await fs.access(path.join(root, "criterion", "results", "flores-translation.jsonl"));
});
