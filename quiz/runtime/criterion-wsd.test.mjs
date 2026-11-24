import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  WSD_DATASETS,
  parseWsdKeyFile,
  scoreWsdDataset,
  runWsdScore
} from "../../program/runtime/criterion/wsd.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pyash-wsd-test-"));
}

test("WSD key parser preserves multiple accepted gold senses and rejects duplicate IDs", () => {
  const rows = parseWsdKeyFile("d000.s000.t000 bank%1:14:00:: bank%1:17:00::\n", { kind: "gold" });
  assert.deepEqual(rows.get("d000.s000.t000"), ["bank%1:14:00::", "bank%1:17:00::"]);
  assert.throws(() => parseWsdKeyFile("x sense-a\nx sense-b\n", { kind: "prediction" }), /duplicate instance/);
  assert.throws(() => parseWsdKeyFile("x\n", { kind: "prediction" }), /requires an instance ID and/);
});

test("WSD scorer reports incomplete coverage and uses exact WordNet sense-key matches", () => {
  const result = scoreWsdDataset({
    dataset: "semeval2007",
    goldText: "one bank%1:14:00::\ntwo bank%1:17:00:: bank%1:14:00::\nthree run%2:38:00::\n",
    predictionText: "one bank%1:14:00::\ntwo bank%1:14:00::\n"
  });
  assert.equal(result.goldCount, 3);
  assert.equal(result.predictionCount, 2);
  assert.equal(result.correctCount, 2);
  assert.equal(result.coverage, 2 / 3);
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 2 / 3);
  assert.equal(result.f1, 0.8);
});

test("WSD run scores each standard dataset and the pooled ALL result with reproducible artifacts", async () => {
  const root = await tempRoot();
  const goldDirectory = path.join(root, "gold");
  const predictionDirectory = path.join(root, "predictions");
  const modelArtifactPath = path.join(root, "checkpoint.bin");
  await fs.mkdir(goldDirectory);
  await fs.mkdir(predictionDirectory);
  await fs.writeFile(modelArtifactPath, "tiny checkpoint bytes");

  for (const dataset of WSD_DATASETS) {
    const base = dataset;
    const datasetGoldDirectory = path.join(goldDirectory, dataset);
    await fs.mkdir(datasetGoldDirectory);
    await fs.writeFile(path.join(datasetGoldDirectory, `${dataset}.gold.key.txt`), `${base}-1 sense-a\n${base}-2 sense-b sense-c\n`);
    const predictions = dataset === "semeval2015" ? `${base}-1 sense-a\n` : `${base}-1 sense-a\n${base}-2 sense-wrong\n`;
    await fs.writeFile(path.join(predictionDirectory, `${dataset}.gold.key.txt`), predictions);
  }

  const run = await runWsdScore({
    goldDirectory,
    predictionDirectory,
    root,
    runId: "wsd-test-run",
    model: "vliw-test",
    modelArtifactPath,
    now: () => new Date("2026-11-24T12:00:00.000Z")
  });
  assert.equal(run.datasets.length, 5);
  assert.equal(run.aggregate.goldCount, 10);
  assert.equal(run.aggregate.predictionCount, 9);
  assert.equal(run.aggregate.correctCount, 5);
  assert.equal(run.aggregate.f1, 10 / 19);
  assert.equal(run.datasets.find(row => row.dataset === "semeval2015").coverage, 0.5);
  assert.equal(run.modelArtifactSha256, crypto.createHash("sha256").update("tiny checkpoint bytes").digest("hex"));
  assert.match(await fs.readFile(path.join(root, run.artifacts.pya), "utf8"), /gold sha256/);
  assert.match(await fs.readFile(path.join(root, run.artifacts.markdown), "utf8"), /\| ALL \|/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, run.artifacts.json), "utf8")).datasetHashes.length, 5);
});

test("WSD scorer rejects prediction IDs absent from the gold dataset", () => {
  assert.throws(() => scoreWsdDataset({
    dataset: "senseval2",
    goldText: "known sense-a\n",
    predictionText: "unknown sense-a\n"
  }), /not present in gold/);
});
