import fs from "node:fs/promises";
import path from "node:path";

import { sha256, stableJson } from "./metrics.mjs";
import { clearExchangeRecorder, recordArtifact, setExchangeRecorder, setExchangeRunId } from "../../bridge/exchange.mjs";

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || value === "") return "-";
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
}

function formatPercent(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "-" : `${Number(value).toFixed(1)}%`;
}

function isFactRun(run) {
  return run?.engine === "posthoc-fact" || Boolean(run?.evaluationMode?.includes?.("omnicseval") || run?.evaluationMode === "automated_proxy");
}

function factReportLines(run) {
  if (!isFactRun(run)) return [];
  const mode = run.evaluationMode ?? "unknown";
  const judge = run.judge ?? {};
  const rows = run.aggregates ?? [];
  const claimIssues = (run.results ?? []).flatMap(row => (row.factEvidence?.verifications ?? [])
    .filter(item => ["unsupported", "contradiction"].includes(item.support))
    .map(item => ({ model: row.model, sampleId: row.sampleId, claimText: row.factEvidence?.claims?.find(claim => claim.id === item.claimId)?.text ?? null, ...item }))
  ).slice(0, 20);
  return [
    "## Fact evaluation",
    "",
    `- Evaluation mode: ${mode}`,
    `- Fact scorer: ${judge.scorerVersion ?? "unknown"}`,
    `- Judge: ${judge.provider ?? "unknown"} / ${judge.model ?? "not recorded"}`,
    `- Judge prompt: ${judge.promptVersion ?? "unknown"}`,
    `- Annotation samples: ${run.annotationCount ?? "not applicable"}`,
    `- Exact compatibility uses released key-fact annotations; automated proxy extracts facts and claims with the configured external judge.`,
    "",
    "| Model | Samples | Completeness | Conciseness | Faithfulness | Key facts | Matched facts | Summary sentences | Claims | Supported | Unsupported | Contradictions | Unresolved | Failures | Skipped |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(row => {
      const aggregate = row.aggregate ?? {};
      return `| ${row.model} | ${aggregate.sampleCount ?? 0} | ${formatPercent(aggregate.completenessPercent)} | ${formatPercent(aggregate.concisenessPercent)} | ${formatPercent(aggregate.faithfulnessPercent)} | ${aggregate.keyFactCount ?? 0} | ${aggregate.matchedKeyFactCount ?? 0} | ${aggregate.summarySentenceCount ?? 0} | ${aggregate.atomicClaimCount ?? 0} | ${aggregate.supportedClaimCount ?? 0} | ${aggregate.unsupportedClaimCount ?? 0} | ${aggregate.contradictionCount ?? 0} | ${aggregate.unresolvedJudgeCount ?? 0} | ${aggregate.failureCount ?? 0} | ${aggregate.skippedCount ?? 0} |`;
    }),
    "",
    `- Unmatched joins: ${run.unmatchedJoins?.length ?? 0}`,
    `- Matched joins: ${run.matchedJoins?.length ?? 0}`,
    `- Source-text hash mismatches: ${run.sourceHashMismatches?.length ?? 0}`,
    "",
    "### Fact evidence groups",
    "",
    ...Object.entries(run.groupAggregates ?? {}).flatMap(([group, values]) => [
      `- ${group}: ${values.length ? values.map(value => `${value.model}/${value[group] ?? value.type ?? value.chunked}: ${formatPercent(value.aggregate?.faithfulnessPercent)} faithfulness`).join("; ") : "none"}`
    ]),
    "",
    "### Unsupported or decision-related claims",
    "",
    ...(claimIssues.length
      ? claimIssues.map(item => `- ${item.model}/${item.sampleId}: ${item.support}${item.claimText ? ` — ${item.claimText}` : ""} — ${item.explanation ?? "no explanation"}`)
      : ["No unsupported or contradictory claim evidence recorded in the selected review rows."]),
    ""
  ];
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
    ["dataset hash", run.datasetHash],
    ["split", run.actualSplit ?? run.split],
    ["run scope", run.runScope ?? (run.smoke ? "smoke" : "full")],
    ["engine", run.engine],
    ["profile", run.profile],
    ["effective think", run.sampling?.think],
    ["total wall clock ms", run.totalWallClockMs],
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
  const longContext = ["longbench", "longbench-summary"].includes(run?.suite?.key) ? best("accuracy")?.model ?? best("rougeL")?.model ?? null : null;
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
    `- Dataset hash: ${run.datasetHash ?? "unknown"}`,
    `- Split: ${run.actualSplit ?? run.split ?? "unknown"}`,
    `- Run scope: ${run.runScope ?? (run.smoke ? "smoke" : "full")}`,
    `- Engine: ${run.engine ?? "ollama"}`,
    `- Context length: ${run.contextLength}`,
    `- Inference profile: ${run.profile}`,
    `- Effective think: ${run.sampling?.think ?? "unknown"}`,
    `- Total wall-clock time: ${formatNumber(run.totalWallClockMs, 1)} ms`,
    `- Replay: \`${run.replayCommand}\``,
    "",
    "## Comparison",
    "",
    `### ${run.runScope ?? (run.smoke ? "smoke" : "full")} aggregate`,
    "",
    "| Benchmark | Model | Samples | Pass | Accuracy | ROUGE-1 | ROUGE-2 | ROUGE-L | Schema | Avg input tokens | Avg output tokens | Prompt tok/s | Generation tok/s | Avg ms | Median ms | p95 ms | Quality/sec | Failures | Skipped |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(row => `| ${run.suite?.name ?? run.criterion} | ${row.model} | ${row.aggregate.sampleCount} | ${row.aggregate.passEvaluatedCount ? `${row.aggregate.passCount}/${row.aggregate.passEvaluatedCount}` : "-"} | ${formatNumber(row.aggregate.accuracy)} | ${formatNumber(row.aggregate.rouge1)} | ${formatNumber(row.aggregate.rouge2)} | ${formatNumber(row.aggregate.rougeL)} | ${formatNumber(row.aggregate.schemaValidity)} | ${formatNumber(row.aggregate.averageInputTokens, 1)} | ${formatNumber(row.aggregate.averageOutputTokens, 1)} | ${formatNumber(row.aggregate.promptTokensPerSecond, 1)} | ${formatNumber(row.aggregate.generationTokensPerSecond, 1)} | ${formatNumber(row.aggregate.averageLatencyMs, 1)} | ${formatNumber(row.aggregate.medianLatencyMs, 1)} | ${formatNumber(row.aggregate.p95LatencyMs, 1)} | ${formatNumber(row.aggregate.qualityPerSecond, 4)} | ${row.aggregate.failureCount} | ${row.aggregate.skippedCount} |`),
    "",
    ...factReportLines(run),
    "## Evaluation modes",
    "",
    ...(run.evaluationAggregates?.length
      ? ["| Mode | Model | Samples | ROUGE-L | Avg latency ms | Quality/sec | Failures |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |", ...run.evaluationAggregates.map(row => `| ${row.evaluationMode} | ${row.model} | ${row.aggregate.sampleCount} | ${formatNumber(row.aggregate.rougeL)} | ${formatNumber(row.aggregate.averageLatencyMs, 1)} | ${formatNumber(row.aggregate.qualityPerSecond, 4)} | ${row.aggregate.failureCount} |`)]
      : ["No separate evaluation-mode breakdown for this suite."]),
    "",
    "## Task breakdown",
    "",
    ...(run.taskAggregates?.length
      ? ["| Task | Model | Samples | ROUGE-L | Avg latency ms | Quality/sec | Failures |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |", ...run.taskAggregates.map(row => `| ${row.task} | ${row.model} | ${row.aggregate.sampleCount} | ${formatNumber(row.aggregate.rougeL)} | ${formatNumber(row.aggregate.averageLatencyMs, 1)} | ${formatNumber(row.aggregate.qualityPerSecond, 4)} | ${row.aggregate.failureCount} |`), ...(run.taskMacroAggregates ?? []).map(row => `| ${row.task} | ${row.model} | ${row.aggregate.groupCount} tasks | ${formatNumber(row.aggregate.rougeL)} | ${formatNumber(row.aggregate.averageLatencyMs, 1)} | ${formatNumber(row.aggregate.qualityPerSecond, 4)} | ${row.aggregate.failureCount} |`)]
      : ["No task-level aggregation for this suite."]),
    "",
    "## Category breakdown",
    "",
    ...(run.categoryAggregates?.length
      ? ["| Category | Model | Samples | Accuracy | Avg latency ms | Quality/sec | Failures |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |", ...run.categoryAggregates.map(row => `| ${row.category} | ${row.model} | ${row.aggregate.sampleCount} | ${formatNumber(row.aggregate.accuracy)} | ${formatNumber(row.aggregate.averageLatencyMs, 1)} | ${formatNumber(row.aggregate.qualityPerSecond, 4)} | ${row.aggregate.failureCount} |`)]
      : ["No category-level aggregation for this suite."]),
    "",
    "## Context buckets",
    "",
    ...rows.flatMap(row => Object.entries(row.aggregate.contextBuckets ?? {}).map(([bucket, aggregate]) => `- ${row.model} / ${bucket}: ${aggregate.sampleCount} samples, ROUGE-L ${formatNumber(aggregate.rougeL)}, p50 ${formatNumber(aggregate.p50LatencyMs, 1)} ms`)),
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
    `- License URLs: ${(run.suite?.licenseUrls ?? []).join(", ") || "see local dataset terms"}`,
    "",
    "## Notes",
    "",
    `Per-sample outputs are explicit benchmark evidence. ${run.engine === "baseline" ? "This is a deterministic baseline and makes no Ollama request; generation speed is not applicable." : "Thinking blocks are excluded from scoring; raw provider timing remains in JSONL."} Missing datasets, unavailable models, and skipped context windows are reported rather than converted into scores.`,
    ""
  ];
  return lines.join("\n");
}

export function renderRunCsv(run) {
  const headers = ["run_id", "run_scope", "engine", "benchmark", "task", "model", "sample_id", "status", "accuracy", "rouge1", "rouge2", "rougeL", "schema_validity", "factual_accuracy", "completeness_percent", "conciseness_percent", "faithfulness_percent", "key_fact_count", "matched_key_fact_count", "summary_sentence_count", "atomic_claim_count", "supported_claim_count", "unsupported_claim_count", "contradiction_count", "unresolved_judge_count", "input_tokens", "output_tokens", "prompt_tokens_per_second", "generation_tokens_per_second", "latency_ms", "processing_latency_ms", "quality_per_second", "effective_think", "reasoning_mode", "failure", "skip_reason", "input_hash", "prompt_hash", "output_hash"];
  const rows = [headers.join(",")];
  for (const row of run.results ?? []) {
    rows.push([
      run.runId, run.runScope ?? (run.smoke ? "smoke" : "full"), run.engine ?? "ollama", run.criterion, row.metadata?.task, row.model, row.sampleId, row.status,
      row.scores?.accuracy, row.scores?.rouge1, row.scores?.rouge2, row.scores?.rougeL,
      row.scores?.schemaValidity, row.scores?.factualAccuracy, row.scores?.completenessPercent, row.scores?.concisenessPercent, row.scores?.faithfulnessPercent,
      row.scores?.keyFactCount, row.scores?.matchedKeyFactCount, row.scores?.summarySentenceCount, row.scores?.atomicClaimCount,
      row.scores?.supportedClaimCount, row.scores?.unsupportedClaimCount, row.scores?.contradictionCount, row.scores?.unresolvedJudgeCount,
      row.inputTokens, row.metrics?.outputTokens, row.metrics?.promptTokensPerSecond, row.metrics?.generationTokensPerSecond,
      row.metrics?.totalElapsedMs, row.metrics?.processingLatencyMs, (() => { const quality = Number(row.scores?.rougeL ?? row.scores?.accuracy ?? row.scores?.factualAccuracy ?? row.scores?.instructionAccuracy); const elapsed = Number(row.metrics?.totalElapsedMs); return Number.isFinite(quality) && elapsed > 0 ? quality / (elapsed / 1000) : null; })(),
      row.effectiveThink, row.reasoningMode, row.error, row.skipReason, row.inputHash, row.promptHash, row.outputHash
    ].map(csvEscape).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function renderReviewHtml(run) {
  const rows = (run.results ?? []).filter(row => row.status === "ok").slice(0, 20);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Criterion review ${escapeHtml(run.runId)}</title><style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;vertical-align:top}pre{white-space:pre-wrap;max-height:20rem;overflow:auto}</style></head><body><h1>Criterion review: ${escapeHtml(run.criterion)}</h1><p>Run ${escapeHtml(run.runId)}. Review samples are selected deterministically from the run. Mode: ${escapeHtml(run.evaluationMode ?? "standard")}</p><table><thead><tr><th>Sample</th><th>Model</th><th>Reference</th><th>Output</th><th>Scores</th><th>Fact evidence</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.sampleId)}</td><td>${escapeHtml(row.model)}</td><td><pre>${escapeHtml(row.reference)}</pre></td><td><pre>${escapeHtml(row.output)}</pre></td><td>${escapeHtml(JSON.stringify(row.scores))}</td><td><pre>${escapeHtml(JSON.stringify(row.factEvidence ?? null))}</pre></td></tr>`).join("")}</tbody></table></body></html>`;
}

export async function writeRunArtifacts(run, { root = process.cwd(), checkpointResults = null } = {}) {
  const artifacts = [];
  const jsonlResults = checkpointResults ?? run.results ?? [];
  const jsonl = jsonlResults.map(row => JSON.stringify(row)).join("\n") + (jsonlResults.length ? "\n" : "");
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
    "| Run | Scope | Engine | Benchmark | Model | Samples | Accuracy | ROUGE-L | Completeness | Conciseness | Faithfulness | Schema | p50 latency ms | p95 latency ms |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];
  for (const run of runs) for (const row of run.aggregates ?? []) {
    lines.push(`| ${run.runId} | ${run.runScope ?? (run.smoke ? "smoke" : "full")} | ${run.engine ?? "ollama"} | ${run.suite?.name ?? run.criterion} | ${row.model} | ${row.aggregate.sampleCount} | ${formatNumber(row.aggregate.accuracy)} | ${formatNumber(row.aggregate.rougeL)} | ${formatPercent(row.aggregate.completenessPercent)} | ${formatPercent(row.aggregate.concisenessPercent)} | ${formatPercent(row.aggregate.faithfulnessPercent)} | ${formatNumber(row.aggregate.schemaValidity)} | ${formatNumber(row.aggregate.p50LatencyMs, 1)} | ${formatNumber(row.aggregate.p95LatencyMs, 1)} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function reportSubject(run) {
  const name = run.suite?.name ?? run.criterion ?? "criterion";
  return `Pyash criterion: ${name} ${run.runId}`;
}

export { artifactPath, stableJson };
