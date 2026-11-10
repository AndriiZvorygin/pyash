import fs from "node:fs/promises";
import path from "node:path";

import { pyaFileToJson, pyaToPlainValue } from "../../library/pya_to_json.mjs";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const INDEX_FILENAME = "index.pya";
const DEFAULT_LIMIT = 30;

function normalizeModels(run) {
  const fromRun = Array.isArray(run?.models) ? run.models : [];
  const fromAggregates = Array.isArray(run?.aggregates) ? run.aggregates.map(row => row?.model) : [];
  const values = [...fromRun, ...fromAggregates, run?.model]
    .map(value => String(value ?? "").trim())
    .filter(Boolean);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sampleCount(run, models) {
  const direct = Number(run?.selection?.count ?? run?.selectedSampleCount ?? run?.annotationCount);
  if (Number.isFinite(direct) && direct >= 0) return Math.trunc(direct);
  const aggregateCounts = (run?.aggregates ?? []).map(row => Number(row?.aggregate?.sampleCount)).filter(Number.isFinite);
  if (aggregateCounts.length) return Math.max(...aggregateCounts);
  const resultCount = Array.isArray(run?.results) ? run.results.length : 0;
  return models.length > 1 ? Math.ceil(resultCount / models.length) : resultCount;
}

function normalizeRun(run, filename) {
  const models = normalizeModels(run);
  const runId = String(run?.runId ?? path.basename(filename, ".pya"));
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`unsupported Criterion run id in ${filename}: ${runId}`);
  return {
    runId,
    criterion: String(run?.criterion ?? "unknown"),
    benchmark: String(run?.suite?.name ?? run?.criterion ?? "unknown"),
    status: String(run?.status ?? "unknown"),
    startedAt: String(run?.startedAt ?? run?.createdAt ?? ""),
    finishedAt: String(run?.finishedAt ?? ""),
    models,
    sampleCount: sampleCount(run, models),
    host: String(run?.throughput?.hostId ?? run?.hostId ?? run?.machine?.hostname ?? "unknown"),
    reportPath: `criterion/results/${runId}.md`,
    manifestPath: `criterion/results/${runId}.pya`,
    jsonlPath: `criterion/results/${runId}.jsonl`
  };
}

async function readRunManifest(filepath) {
  let parsed;
  try {
    parsed = await pyaFileToJson(filepath);
  } catch (error) {
    throw new Error(`could not parse saved Criterion manifest ${filepath}: ${error.message}`, { cause: error });
  }
  const mapSentence = parsed.memory.find(sentence => sentence?.be === "map" && String(sentence?.su?.name ?? "").startsWith("criterion "));
  if (!mapSentence?.ob?.map) throw new Error(`saved Criterion manifest has no run map: ${filepath}`);
  const fields = pyaMapFields(mapSentence.ob.map);
  let run = null;
  if (typeof fields["run payload"] === "string" && fields["run payload"].trim()) {
    try {
      run = JSON.parse(fields["run payload"]);
    } catch (error) {
      throw new Error(`saved Criterion manifest has malformed run payload (${filepath}): ${error.message}`, { cause: error });
    }
  }
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    run = {
      runId: fields["run id"],
      criterion: fields["criterion name"],
      suite: { name: fields["suite name"] },
      status: fields.status,
      totalWallClockMs: Number(fields["total wall clock ms"]),
      results: []
    };
  }
  return normalizeRun(run, path.basename(filepath));
}

function pyaText(value) {
  return JSON.stringify(String(value ?? ""));
}

function pyaMapFields(map) {
  return Object.fromEntries(Object.entries(map ?? {}).map(([key, sentence]) => [key, pyaToPlainValue(sentence?.ob)]));
}

function pyaTextField(name, value) {
  return `su name ${name} ob text ${pyaText(value)} be text ya`;
}

function pyaVectorField(name, values) {
  if (!values.length) return `su name ${name} ob text "" be text ya`;
  return `su name ${name} ob ve text ${values.map(pyaText).join(" ")} ya`;
}

function renderRunIndexPya(runs, refreshedAt) {
  const lines = [
    "exists su name criterion run index be json map def",
    "su name schema version ob num 1 ya",
    pyaTextField("refreshed timestamp", refreshedAt),
    `su name run count ob num ${runs.length} ya`,
    pyaVectorField("run ids", runs.map(run => run.runId)),
    "prah",
    ""
  ];
  for (const run of runs) {
    lines.push(
      `exists su name criterion run entry ${run.runId} be json map def`,
      pyaTextField("run id", run.runId),
      pyaTextField("criterion", run.criterion),
      pyaTextField("benchmark", run.benchmark),
      pyaTextField("status", run.status),
      pyaTextField("started timestamp", run.startedAt),
      pyaTextField("finished timestamp", run.finishedAt),
      pyaTextField("host", run.host),
      `su name sample count ob num ${run.sampleCount} ya`,
      pyaVectorField("models", run.models),
      `su name report path ob filename ${pyaText(run.reportPath)} be filename ya`,
      `su name manifest path ob filename ${pyaText(run.manifestPath)} be filename ya`,
      `su name jsonl path ob filename ${pyaText(run.jsonlPath)} be filename ya`,
      "prah",
      ""
    );
  }
  return lines.join("\n");
}

async function writeRunIndex(root, runs, refreshedAt) {
  const directory = path.resolve(root, "criterion", "results");
  const indexPath = path.join(directory, INDEX_FILENAME);
  const temporaryPath = `${indexPath}.${process.pid}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, renderRunIndexPya(runs, refreshedAt), "utf8");
    await fs.rename(temporaryPath, indexPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return indexPath;
}

function includes(value, query) {
  return !query || String(value ?? "").toLocaleLowerCase().includes(String(query).toLocaleLowerCase());
}

function matchesFilters(run, { model, benchmark, status, host }) {
  return includes(run.models.join(" "), model)
    && includes(`${run.benchmark} ${run.criterion}`, benchmark)
    && includes(run.status, status)
    && includes(run.host, host);
}

export function renderCriterionRuns(runs, { totalRuns, indexPath = "criterion/results/index.pya" } = {}) {
  const lines = [
    `Criterion runs: showing ${runs.length} of ${totalRuns} matching runs`,
    `Index refreshed at ${indexPath}`,
    "",
    "| Started (UTC) | Status | Benchmark | Models | Samples | Host | Run ID |",
    "| --- | --- | --- | --- | ---: | --- | --- |"
  ];
  if (!runs.length) lines.push("| - | - | No matching runs | - | 0 | - | - |");
  for (const run of runs) {
    const cell = value => String(value ?? "-").replace(/[|\r\n]+/gu, " ");
    lines.push(`| ${cell(run.startedAt || "-")} | ${cell(run.status)} | ${cell(run.benchmark)} | ${cell(run.models.join(", ") || "-")} | ${run.sampleCount} | ${cell(run.host)} | ${cell(run.runId)} |`);
  }
  return `${lines.join("\n")}\n`;
}

export async function listCriterionRuns({
  root = process.cwd(),
  model = "",
  benchmark = "",
  status = "",
  host = "",
  limit = DEFAULT_LIMIT,
  now = () => new Date()
} = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("criterion runs limit must be a positive integer");
  const directory = path.resolve(root, "criterion", "results");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const manifests = entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".pya") && entry.name !== INDEX_FILENAME)
    .map(entry => path.join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));
  const discovered = [];
  for (const filepath of manifests) discovered.push(await readRunManifest(filepath));
  const unique = new Map(discovered.map(run => [run.runId, run]));
  const allRuns = [...unique.values()].sort((a, b) =>
    (b.startedAt || "").localeCompare(a.startedAt || "") || a.runId.localeCompare(b.runId)
  );
  const indexPath = await writeRunIndex(root, allRuns, now().toISOString());
  const filtered = allRuns.filter(run => matchesFilters(run, { model, benchmark, status, host }));
  return {
    runs: filtered.slice(0, limit),
    totalRuns: allRuns.length,
    matchingRuns: filtered.length,
    indexPath
  };
}
