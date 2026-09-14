import fs from "node:fs/promises";
import path from "node:path";

import { sha256, stableJson } from "./metrics.mjs";
import { clearExchangeRecorder, recordArtifact, setExchangeRecorder, setExchangeRunId } from "../../bridge/exchange.mjs";

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || value === "") return "-";
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function artifactPath(hash, extension = "") {
  return path.join("criterion", "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${extension}`);
}

async function writeFileWithArtifact(root, relativePath, content, artifacts) {
  const bytes = Buffer.from(String(content), "utf8");
  const hash = sha256(bytes);
  const absolute = path.resolve(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);
  const contentAddressed = artifactPath(hash, path.extname(relativePath));
  const caAbsolute = path.resolve(root, contentAddressed);
  await fs.mkdir(path.dirname(caAbsolute), { recursive: true });
  await fs.writeFile(caAbsolute, bytes);
  recordArtifact({ locator: relativePath, producer: "criterion", bytes, kind: "criterion result" });
  artifacts.push({ path: relativePath, hash, bytes: bytes.length, contentAddressed });
  return absolute;
}

function renderPya(run) {
  const payload = JSON.stringify(run);
  const fields = [
    ["run id", run.runId],
    ["criterion name", run.criterion],
    ["suite name", run.suite?.name],
    ["status", run.status],
    ["dataset revision", run.datasetRevision],
    ["results jsonl", `criterion/results/${run.runId}.jsonl`],
    ["results markdown", `criterion/results/${run.runId}.md`],
    ["results csv", `criterion/results/${run.runId}.csv`],
    ["replay command", run.replayCommand],
    ["run payload", payload]
  ];
  return [
    `# criterion run ${run.runId}`,
    `exists su name criterion ${run.runId} be map def`,
    ...fields.map(([name, value]) => `su name ${name} ob text ${JSON.stringify(String(value ?? ""))} be text ya`),
    "prah",
    ""
  ].join("\n");
}

function recommendation(rows, run) {
  const ok = rows.filter(row => Number(row.aggregate?.successfulCount) > 0);
  if (!ok.length) return {};
  const best = (score, direction = "max") => [...ok].sort((a, b) => {
    const av = Number(a.aggregate?.[score]);
    const bv = Number(b.aggregate?.[score]);
    if (!Number.isFinite(av)) return 1;
    if (!Number.isFinite(bv)) return -1;
    return direction === "min" ? av - bv : bv - av;
  })[0];
  const structured = ok.filter(row => Number.isFinite(Number(row.aggregate?.provenanceValidity)));
  const longContext = run?.suite?.key === "longbench" ? best("accuracy")?.model ?? null : null;
  return {
    routineSectionSummaries: best("rougeL")?.model ?? best("accuracy")?.model ?? null,
    wholeMeetingSynthesis: best("rougeL")?.model ?? null,
    longContextProcessing: longContext,
    structuredOutput: structured.length ? [...structured].sort((a, b) => Number(b.aggregate.provenanceValidity) - Number(a.aggregate.provenanceValidity))[0].model : null,
    fastestConfiguration: best("p50LatencyMs", "min")?.model ?? null,
    highestQualityConfiguration: best("rougeL")?.model ?? best("accuracy")?.model ?? null
  };
}

export function renderRunMarkdown(run) {
  const rows = run.aggregates ?? [];
  const lines = [
    `# Criterion run: ${run.runId}`,
    "",
    `- Suite: ${run.suite?.name ?? run.criterion}`,
    `- Status: ${run.status}`,
    `- Dataset revision: ${run.datasetRevision ?? "unknown"}`,
    `- Context length: ${run.contextLength}`,
    `- Inference profile: ${run.profile}`,
    `- Replay: \`${run.replayCommand}\``,
    "",
    "## Comparison",
    "",
    "| Benchmark | Model | Samples | Pass | Accuracy | ROUGE-1 | ROUGE-2 | ROUGE-L | Schema | Avg output tokens | Prompt tok/s | Generation tok/s | p50 ms | p95 ms | Failures | Skipped |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(row => `| ${run.suite?.name ?? run.criterion} | ${row.model} | ${row.aggregate.sampleCount} | ${row.aggregate.passEvaluatedCount ? `${row.aggregate.passCount}/${row.aggregate.passEvaluatedCount}` : "-"} | ${formatNumber(row.aggregate.accuracy)} | ${formatNumber(row.aggregate.rouge1)} | ${formatNumber(row.aggregate.rouge2)} | ${formatNumber(row.aggregate.rougeL)} | ${formatNumber(row.aggregate.schemaValidity)} | ${formatNumber(row.aggregate.averageOutputTokens, 1)} | ${formatNumber(row.aggregate.promptTokensPerSecond, 1)} | ${formatNumber(row.aggregate.generationTokensPerSecond, 1)} | ${formatNumber(row.aggregate.p50LatencyMs, 1)} | ${formatNumber(row.aggregate.p95LatencyMs, 1)} | ${row.aggregate.failureCount} | ${row.aggregate.skippedCount} |`),
    "",
    "## Recommendations",
    "",
    ...Object.entries(recommendation(rows, run)).map(([key, value]) => `- ${key}: ${value ?? "insufficient evidence"}`),
    "",
    "## Provenance",
    "",
    `- Created: ${run.createdAt}`,
    `- Machine: ${run.machine?.hostname ?? "unknown"}`,
    `- OS: ${run.machine?.platform ?? "unknown"}`,
    `- CPU: ${run.machine?.cpu ?? "unknown"}`,
    `- GPU: ${run.machine?.gpu ?? "unknown"}`,
    `- Source URLs: ${(run.suite?.sourceUrls ?? []).join(", ") || "local adapter"}`,
    "",
    "## Notes",
    "",
    "Per-sample outputs are explicit benchmark evidence. Thinking blocks are excluded from scoring; raw provider timing remains in JSONL. Missing datasets, unavailable models, and skipped context windows are reported rather than converted into scores.",
    ""
  ];
  return lines.join("\n");
}

export function renderRunCsv(run) {
  const headers = ["run_id", "benchmark", "model", "sample_id", "status", "accuracy", "rouge1", "rouge2", "rougeL", "schema_validity", "factual_accuracy", "unsupported_claim_count", "output_tokens", "prompt_tokens_per_second", "generation_tokens_per_second", "latency_ms", "failure", "skip_reason", "input_hash", "prompt_hash", "output_hash"];
  const rows = [headers.join(",")];
  for (const row of run.results ?? []) {
    rows.push([
      run.runId, run.criterion, row.model, row.sampleId, row.status,
      row.scores?.accuracy, row.scores?.rouge1, row.scores?.rouge2, row.scores?.rougeL,
      row.scores?.schemaValidity, row.scores?.factualAccuracy, row.scores?.unsupportedClaimCount,
      row.metrics?.outputTokens, row.metrics?.promptTokensPerSecond, row.metrics?.generationTokensPerSecond,
      row.metrics?.totalElapsedMs, row.error, row.skipReason, row.inputHash, row.promptHash, row.outputHash
    ].map(csvEscape).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function renderReviewHtml(run) {
  const rows = (run.results ?? []).filter(row => row.status === "ok").slice(0, 20);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Criterion review ${escapeHtml(run.runId)}</title><style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;vertical-align:top}pre{white-space:pre-wrap;max-height:20rem;overflow:auto}</style></head><body><h1>Criterion review: ${escapeHtml(run.criterion)}</h1><p>Run ${escapeHtml(run.runId)}. Review samples are selected deterministically from the run.</p><table><thead><tr><th>Sample</th><th>Model</th><th>Reference</th><th>Output</th><th>Scores</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.sampleId)}</td><td>${escapeHtml(row.model)}</td><td><pre>${escapeHtml(row.reference)}</pre></td><td><pre>${escapeHtml(row.output)}</pre></td><td>${escapeHtml(JSON.stringify(row.scores))}</td></tr>`).join("")}</tbody></table></body></html>`;
}

export async function writeRunArtifacts(run, { root = process.cwd() } = {}) {
  const artifacts = [];
  const jsonl = (run.results ?? []).map(row => JSON.stringify(row)).join("\n") + ((run.results ?? []).length ? "\n" : "");
  const markdown = renderRunMarkdown(run);
  const csv = renderRunCsv(run);
  const html = renderReviewHtml(run);
  const exchangeEvents = [];
  setExchangeRecorder({ runRoot: root, record: sentence => exchangeEvents.push(sentence) });
  setExchangeRunId(run.runId);
  try {
    await writeFileWithArtifact(root, path.join("criterion", "results", `${run.runId}.jsonl`), jsonl, artifacts);
    await writeFileWithArtifact(root, path.join("criterion", "results", `${run.runId}.md`), markdown, artifacts);
    await writeFileWithArtifact(root, path.join("criterion", "results", `${run.runId}.csv`), csv, artifacts);
    await writeFileWithArtifact(root, path.join("criterion", "results", `${run.runId}.pya`), renderPya({ ...run, artifacts }), artifacts);
    await writeFileWithArtifact(root, path.join("criterion", "review", `${run.runId}.html`), html, artifacts);
  } finally {
    clearExchangeRecorder();
  }
  const finalRun = { ...run, artifacts, artifactEvents: exchangeEvents };
  const json = `${JSON.stringify(finalRun, null, 2)}\n`;
  const jsonAbsolute = path.resolve(root, "criterion", "results", `${run.runId}.json`);
  await fs.writeFile(jsonAbsolute, json, "utf8");
  const jsonHash = sha256(json);
  const jsonContentAddressed = path.resolve(root, artifactPath(jsonHash, ".json"));
  await fs.mkdir(path.dirname(jsonContentAddressed), { recursive: true });
  await fs.writeFile(jsonContentAddressed, json, "utf8");
  return finalRun;
}

export async function loadRun(runId, { root = process.cwd() } = {}) {
  const filepath = path.resolve(root, "criterion", "results", `${runId}.json`);
  return JSON.parse(await fs.readFile(filepath, "utf8"));
}

export function renderComparison(runs) {
  const lines = [
    "# Criterion comparison",
    "",
    "| Run | Benchmark | Model | Samples | Accuracy | ROUGE-L | Schema | p50 latency ms | p95 latency ms |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];
  for (const run of runs) for (const row of run.aggregates ?? []) {
    lines.push(`| ${run.runId} | ${run.suite?.name ?? run.criterion} | ${row.model} | ${row.aggregate.sampleCount} | ${formatNumber(row.aggregate.accuracy)} | ${formatNumber(row.aggregate.rougeL)} | ${formatNumber(row.aggregate.schemaValidity)} | ${formatNumber(row.aggregate.p50LatencyMs, 1)} | ${formatNumber(row.aggregate.p95LatencyMs, 1)} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function reportSubject(run) {
  const name = run.suite?.name ?? run.criterion ?? "criterion";
  return `Pyash criterion: ${name} ${run.runId}`;
}

export { artifactPath, stableJson };
