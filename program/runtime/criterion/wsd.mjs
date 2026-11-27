import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const WSD_DATASETS = Object.freeze([
  "semeval2007",
  "senseval2",
  "senseval3",
  "semeval2013",
  "semeval2015"
]);

export const WSD_BENCHMARK = Object.freeze({
  name: "Raganato English all-words WSD",
  wordNetVersion: "3.0",
  publishedReferenceModel: "BPYap/BERT-WSD BERT-base-augmented",
  publishedReferenceParameters: "110M",
  publishedReferenceAllF1: 0.787,
  acceptanceF1: 0.777,
  sourceUrl: "https://lcl.uniroma1.it/wsdeval/"
});

function parseRows(text, kind) {
  const rows = new Map();
  for (const [index, rawLine] of String(text ?? "").split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/u);
    if (fields.length < 2) {
      throw new Error(`WSD ${kind} key file line ${index + 1} requires an instance ID and at least one sense key`);
    }
    const [instanceId, ...senseKeys] = fields;
    if (rows.has(instanceId)) throw new Error(`WSD ${kind} key file has duplicate instance ID ${instanceId} at line ${index + 1}`);
    if (kind === "prediction" && senseKeys.length !== 1) {
      throw new Error(`WSD prediction at line ${index + 1} must contain exactly one sense key`);
    }
    rows.set(instanceId, kind === "gold" ? [...new Set(senseKeys)] : senseKeys);
  }
  return rows;
}

export function parseWsdKeyFile(text, { kind = "gold" } = {}) {
  if (kind !== "gold" && kind !== "prediction") throw new Error(`unsupported WSD key-file kind: ${kind}`);
  return parseRows(text, kind);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function metrics({ dataset, gold, predictions }) {
  if (!gold.size) throw new Error(`WSD ${dataset} gold key file is empty`);
  for (const instanceId of predictions.keys()) {
    if (!gold.has(instanceId)) throw new Error(`WSD prediction ID ${instanceId} is not present in gold dataset ${dataset}`);
  }
  let correctCount = 0;
  for (const [instanceId, predicted] of predictions) {
    if (gold.get(instanceId).includes(predicted[0])) correctCount += 1;
  }
  const goldCount = gold.size;
  const predictionCount = predictions.size;
  const precision = ratio(correctCount, predictionCount);
  const recall = ratio(correctCount, goldCount);
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return {
    dataset,
    goldCount,
    predictionCount,
    correctCount,
    missingPredictionCount: goldCount - predictionCount,
    coverage: ratio(predictionCount, goldCount),
    precision,
    recall,
    f1
  };
}

export function scoreWsdDataset({ dataset, goldText, predictionText }) {
  const gold = parseWsdKeyFile(goldText, { kind: "gold" });
  const predictions = parseWsdKeyFile(predictionText, { kind: "prediction" });
  return metrics({ dataset, gold, predictions });
}

function combineMetrics(rows) {
  const totals = rows.reduce((sum, row) => ({
    goldCount: sum.goldCount + row.goldCount,
    predictionCount: sum.predictionCount + row.predictionCount,
    correctCount: sum.correctCount + row.correctCount,
    missingPredictionCount: sum.missingPredictionCount + row.missingPredictionCount
  }), { goldCount: 0, predictionCount: 0, correctCount: 0, missingPredictionCount: 0 });
  const precision = ratio(totals.correctCount, totals.predictionCount);
  const recall = ratio(totals.correctCount, totals.goldCount);
  return {
    dataset: "ALL",
    ...totals,
    coverage: ratio(totals.predictionCount, totals.goldCount),
    precision,
    recall,
    f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0
  };
}

export function scoreWsdBenchmark(inputs) {
  const byName = new Map(inputs.map(input => [input.dataset, input]));
  const duplicateNames = inputs.filter((input, index) => inputs.findIndex(row => row.dataset === input.dataset) !== index);
  if (duplicateNames.length) throw new Error(`duplicate WSD datasets: ${[...new Set(duplicateNames.map(row => row.dataset))].join(", ")}`);
  const missing = WSD_DATASETS.filter(name => !byName.has(name));
  const unexpected = [...byName.keys()].filter(name => !WSD_DATASETS.includes(name));
  if (missing.length || unexpected.length) {
    throw new Error(`WSD benchmark requires exactly the five standard datasets; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`);
  }
  const datasets = WSD_DATASETS.map(dataset => {
    const input = byName.get(dataset);
    const result = scoreWsdDataset(input);
    return {
      ...result,
      goldSha256: sha256(input.goldText),
      predictionSha256: sha256(input.predictionText)
    };
  });
  return { datasets, aggregate: combineMetrics(datasets) };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function hashModelArtifact(filepath) {
  if (!filepath) return null;
  const metadata = await fs.stat(filepath);
  if (!metadata.isFile()) throw new Error(`WSD model artifact must be a checkpoint file: ${filepath}`);
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filepath)) hash.update(chunk);
  return hash.digest("hex");
}

function validRunId(value) {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(id)) throw new Error(`invalid WSD run ID: ${id}`);
  return id;
}

async function readDatasetPair(goldDirectory, predictionDirectory, dataset) {
  const goldPath = path.join(goldDirectory, dataset, `${dataset}.gold.key.txt`);
  const predictionPath = path.join(predictionDirectory, `${dataset}.key.txt`);
  const alternatePredictionPath = path.join(predictionDirectory, `${dataset}.gold.key.txt`);
  const [goldText, predictionText] = await Promise.all([
    fs.readFile(goldPath, "utf8"),
    fs.readFile(predictionPath, "utf8").catch(error => error.code === "ENOENT"
      ? fs.readFile(alternatePredictionPath, "utf8")
      : Promise.reject(error))
  ]);
  return { dataset, goldText, predictionText, goldPath, predictionPath };
}

function renderPya(run) {
  const lines = [
    `exists su name criterion wsd run ${run.runId} be map def`,
    `su name benchmark ob text ${JSON.stringify(WSD_BENCHMARK.name)} be text ya`,
    `su name wordnet version ob text ${JSON.stringify(WSD_BENCHMARK.wordNetVersion)} be text ya`,
    `su name model ob text ${JSON.stringify(run.model)} be text ya`,
    `su name model artifact sha256 ob text ${JSON.stringify(run.modelArtifactSha256 ?? "")} be text ya`,
    `su name started at ob text ${JSON.stringify(run.startedAt)} be text ya`,
    `su name finished at ob text ${JSON.stringify(run.finishedAt)} be text ya`,
    `su name dataset count ob num ${run.datasets.length} ya`,
    `su name gold count ob num ${run.aggregate.goldCount} ya`,
    `su name prediction count ob num ${run.aggregate.predictionCount} ya`,
    `su name correct count ob num ${run.aggregate.correctCount} ya`,
    `su name coverage ob num ${run.aggregate.coverage} ya`,
    `su name precision ob num ${run.aggregate.precision} ya`,
    `su name recall ob num ${run.aggregate.recall} ya`,
    `su name f1 ob num ${run.aggregate.f1} ya`,
    `su name acceptance f1 ob num ${WSD_BENCHMARK.acceptanceF1} ya`,
    `su name acceptance passed ob text ${JSON.stringify(run.aggregate.f1 >= WSD_BENCHMARK.acceptanceF1 ? "true" : "false")} be text ya`,
    `su name report path ob filename ${JSON.stringify(run.artifacts.markdown)} be filename ya`,
    ...run.datasets.map(row => [
      `exists su name wsd dataset ${row.dataset} be map def`,
      `su name gold count ob num ${row.goldCount} ya`,
      `su name prediction count ob num ${row.predictionCount} ya`,
      `su name correct count ob num ${row.correctCount} ya`,
      `su name coverage ob num ${row.coverage} ya`,
      `su name precision ob num ${row.precision} ya`,
      `su name recall ob num ${row.recall} ya`,
      `su name f1 ob num ${row.f1} ya`,
      `su name gold sha256 ob text ${JSON.stringify(row.goldSha256)} be text ya`,
      `su name prediction sha256 ob text ${JSON.stringify(row.predictionSha256)} be text ya`,
      "prah"
    ].join("\n")),
    "prah",
    ""
  ];
  return lines.join("\n");
}

function formatPercent(value) { return `${(value * 100).toFixed(2)}%`; }

function renderMarkdown(run) {
  const rows = [...run.datasets, run.aggregate].map(row =>
    `| ${row.dataset} | ${row.goldCount} | ${row.predictionCount} | ${row.correctCount} | ${formatPercent(row.coverage)} | ${formatPercent(row.precision)} | ${formatPercent(row.recall)} | ${formatPercent(row.f1)} |`
  );
  return [
    `# ${WSD_BENCHMARK.name}: ${run.runId}`,
    "",
    `- Model: ${run.model}`,
    `- Model artifact SHA-256: ${run.modelArtifactSha256 ?? "not supplied"}`,
    `- WordNet labels: ${WSD_BENCHMARK.wordNetVersion}`,
    `- Reference: ${WSD_BENCHMARK.publishedReferenceModel} (${WSD_BENCHMARK.publishedReferenceParameters}), published ALL F1 ${formatPercent(WSD_BENCHMARK.publishedReferenceAllF1)}`,
    `- Acceptance threshold: ${formatPercent(WSD_BENCHMARK.acceptanceF1)} ALL F1`,
    `- Start/end: ${run.startedAt} / ${run.finishedAt}`,
    "",
    "Missing predictions count as uncovered gold instances; unknown prediction IDs and duplicate rows fail the run. ALL is pooled micro precision/recall/F1 across the five official datasets.",
    "",
    "| Dataset | Gold | Predicted | Correct | Coverage | Precision | Recall | F1 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "## Input hashes",
    "",
    ...run.datasets.flatMap(row => [
      `- ${row.dataset} gold: ${row.goldSha256}`,
      `- ${row.dataset} predictions: ${row.predictionSha256}`
    ]),
    ""
  ].join("\n");
}

async function atomicWrite(filepath, content) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const temporary = `${filepath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, filepath);
}

export async function runWsdScore({
  goldDirectory,
  predictionDirectory,
  root = process.cwd(),
  runId = `wsd-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`,
  model = "unspecified",
  modelArtifactPath = null,
  now = () => new Date()
}) {
  const id = validRunId(runId ?? `wsd-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`);
  const startedAt = now().toISOString();
  const inputs = await Promise.all(WSD_DATASETS.map(dataset => readDatasetPair(goldDirectory, predictionDirectory, dataset)));
  const { datasets, aggregate } = scoreWsdBenchmark(inputs);
  const modelArtifactSha256 = await hashModelArtifact(modelArtifactPath);
  const finishedAt = now().toISOString();
  const directory = path.resolve(root, "criterion", "results");
  const artifacts = {
    markdown: path.join(directory, `${id}.md`),
    pya: path.join(directory, `${id}.pya`),
    json: path.join(directory, `${id}.json`)
  };
  const run = {
    runId: id,
    criterion: "raganato-wsd",
    benchmark: WSD_BENCHMARK.name,
    model: String(model),
    modelArtifact: modelArtifactPath ? path.basename(modelArtifactPath) : null,
    modelArtifactSha256,
    wordNetVersion: WSD_BENCHMARK.wordNetVersion,
    publishedReference: {
      model: WSD_BENCHMARK.publishedReferenceModel,
      parameters: WSD_BENCHMARK.publishedReferenceParameters,
      allF1: WSD_BENCHMARK.publishedReferenceAllF1
    },
    acceptanceF1: WSD_BENCHMARK.acceptanceF1,
    startedAt,
    finishedAt,
    datasets,
    datasetHashes: datasets.map(row => ({ dataset: row.dataset, gold: row.goldSha256, predictions: row.predictionSha256 })),
    aggregate,
    targetMet: aggregate.f1 >= WSD_BENCHMARK.acceptanceF1,
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, path.relative(root, value)]))
  };
  await Promise.all([
    atomicWrite(artifacts.markdown, renderMarkdown(run)),
    atomicWrite(artifacts.pya, renderPya({ ...run, artifacts: run.artifacts })),
    atomicWrite(artifacts.json, `${JSON.stringify(run, null, 2)}\n`)
  ]);
  return { ...run, artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, path.relative(root, value)])) };
}
