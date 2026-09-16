import fs from "node:fs/promises";
import path from "node:path";

import { collectMachineMetadata } from "./machine.mjs";
import { loadSuiteSamples } from "./datasets.mjs";
import { mean, parseJsonOutput, percentile, rougeScores, sha256, stableJson, stripThinking, tokenize } from "./metrics.mjs";
import { readOllamaMetadata, resolveOllamaBaseUrl, runOllamaChat } from "./ollama.mjs";
import { runCriterion } from "./run.mjs";
import { createHuggingFaceJudgeExecutor } from "./huggingface.mjs";
import { writeRunArtifacts } from "./report.mjs";

export const MEETINGBANK_JUDGE_PILOT_MODE = "meetingbank-unirrm-pilot";
export const UNIRRM_MODEL_ID = "SUSTech-NLP/UniRRM-8B";
export const UNIRRM_JUDGE_NAME = "judge:unirrm-8b";
export const MEETINGBANK_JUDGE_PILOT_MODELS = Object.freeze([
  "qwen3.5:9b",
  "hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M",
  "qwen3.8:27b"
]);
export const MEETINGBANK_JUDGE_PILOT_SELECTION_SEED = "meetingbank-unirrm-pilot-20260915";
export const MEETINGBANK_JUDGE_PILOT_PROMPT = "You are summarizing one city-council meeting transcript for a municipal publication. Write one concise, factual meeting summary based only on the transcript. Include the main topics, decisions and resolutions, motions and votes, action items and responsible parties, important dates and deadlines, and any uncertainty that remains in the transcript. Preserve exact names, numbers, dates, ordinance or resolution identifiers, and vote outcomes when present. Do not invent details or add commentary about this evaluation. Output plain text suitable for municipal minutes, with no title, labels, bullets, preamble, analysis, or explanation.";
export const MEETINGBANK_JUDGE_PILOT_PROMPT_HASH = sha256(MEETINGBANK_JUDGE_PILOT_PROMPT);
export const UNIRRM_NATIVE_SCALE = Object.freeze({ min: 1, max: 5, formula: "((score - 1) / 4) * 100" });

const DEFAULT_SELECTION_COUNT = 10;
const DEFAULT_JUDGE_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_JUDGE_TEMPERATURE = 0;

function text(value) { return String(value ?? "").trim(); }

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function csvEscape(value) {
  const result = value === null || value === undefined ? "" : String(value);
  return /[",\n]/u.test(result) ? `"${result.replace(/"/gu, '""')}"` : result;
}

function formatNumber(value, digits = 2) {
  const number = numeric(value);
  return number === null ? "-" : number.toFixed(digits);
}

function formatPercent(value) {
  const number = numeric(value);
  return number === null ? "-" : `${number.toFixed(1)}%`;
}

function hashRank(seed, id) {
  return sha256(`${seed}\u0000${id}`);
}

function diversityKey(sample) {
  const metadata = sample.metadata ?? {};
  const length = Number(metadata.transcriptTokens ?? tokenize(sample.input ?? "").length);
  const lengthBand = length <= 1000 ? "short" : length <= 3000 ? "medium" : "long";
  return `${text(metadata.type) || "unspecified"}:${lengthBand}`;
}

export function selectMeetingBankJudgePilotSamples(samples, {
  count = DEFAULT_SELECTION_COUNT,
  seed = MEETINGBANK_JUDGE_PILOT_SELECTION_SEED
} = {}) {
  const ranked = [...(samples ?? [])]
    .filter(sample => sample?.id !== undefined && sample?.id !== null)
    .map(sample => ({ sample, rank: hashRank(seed, sample.id) }))
    .sort((left, right) => left.rank.localeCompare(right.rank) || String(left.sample.id).localeCompare(String(right.sample.id)));
  const selected = [];
  const usedGroups = new Set();
  for (const item of ranked) {
    if (selected.length >= count) break;
    const group = diversityKey(item.sample);
    if (usedGroups.has(group)) continue;
    selected.push(item.sample);
    usedGroups.add(group);
  }
  for (const item of ranked) {
    if (selected.length >= count) break;
    if (!selected.some(sample => String(sample.id) === String(item.sample.id))) selected.push(item.sample);
  }
  return selected;
}

async function readJsonl(filepath) {
  try {
    const raw = await fs.readFile(filepath, "utf8");
    return raw.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonl(filepath, rows) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

async function readOllamaTags(baseUrl, fetchImpl = globalThis.fetch) {
  const base = resolveOllamaBaseUrl(baseUrl);
  try {
    const response = await fetchImpl(`${base}/api/tags`);
    if (!response.ok) throw new Error(`Ollama tags request failed: ${response.status}`);
    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    return {
      baseUrl: base,
      available: true,
      models: models.map(model => ({ name: text(model.name), digest: model.digest ?? null, details: model.details ?? null })),
      error: null
    };
  } catch (error) {
    return { baseUrl: base, available: false, models: [], error: error?.message ?? String(error) };
  }
}

export async function resolvePilotModels({ models = MEETINGBANK_JUDGE_PILOT_MODELS, baseUrl, fetchImpl = globalThis.fetch } = {}) {
  const requested = [...models].map(text).filter(Boolean);
  const tags = await readOllamaTags(baseUrl, fetchImpl);
  const listed = new Map(tags.models.map(model => [model.name, model]));
  const resolved = requested.map(requestedModel => ({
    requestedModel,
    resolvedModel: listed.has(requestedModel) ? requestedModel : null,
    available: listed.has(requestedModel),
    digest: listed.get(requestedModel)?.digest ?? null,
    pullCommand: `ssh mriczo ollama pull '${requestedModel.replace(/'/gu, "'\\''")}'`
  }));
  return { ...tags, requested, resolved };
}

function generationSettings(row) {
  return {
    profile: row.profile,
    contextLength: row.contextLength,
    effectiveThink: row.effectiveThink,
    reasoningMode: row.reasoningMode,
    sampling: row.provider?.sampling ?? null
  };
}

function generationRowFor(rows, model, sampleId) {
  return rows.find(row => row.model === model && String(row.sampleId) === String(sampleId) && row.status === "ok") ?? null;
}

function nativeScore(value) {
  const result = numeric(value);
  return result === null ? null : result;
}

function scoreValue(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) return nativeScore(object[key]);
  }
  return null;
}

function scorePercentage(score) {
  const value = nativeScore(score);
  if (value === null) return null;
  if (value >= UNIRRM_NATIVE_SCALE.min && value <= UNIRRM_NATIVE_SCALE.max) {
    return ((value - UNIRRM_NATIVE_SCALE.min) / (UNIRRM_NATIVE_SCALE.max - UNIRRM_NATIVE_SCALE.min)) * 100;
  }
  return value >= 0 && value <= 1 ? value * 100 : null;
}

function evaluationFor(parsed, responseId = null) {
  const evaluations = Array.isArray(parsed?.evaluations) ? parsed.evaluations : [];
  return evaluations.find(item => responseId && String(item?.response_id ?? item?.responseId ?? item?.id) === String(responseId)) ?? evaluations[0] ?? {};
}

export function parseUniRrmOutput(rawOutput) {
  const stripped = stripThinking(rawOutput).trim();
  if (!stripped) return { valid: false, value: null, error: "empty judge output" };
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu)?.[1];
  const candidate = (fenced ?? stripped).trim();
  const direct = parseJsonOutput(candidate);
  if (direct.valid && direct.value && typeof direct.value === "object") return direct;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(candidate.slice(start, end + 1));
      if (value && typeof value === "object") return { valid: true, value, error: null };
    } catch { /* bounded repair is handled by the caller */ }
  }
  return { valid: false, value: null, error: direct.error ?? "judge output did not contain valid JSON" };
}

export function normalizeUniRrmJudgement(parsed, { mode = "pointwise" } = {}) {
  const point = evaluationFor(parsed, mode === "pairwise" ? "Response1" : null);
  const source = { ...(point ?? {}), ...(parsed ?? {}) };
  const fields = {
    overallScore: scoreValue(source, ["overall_score", "overallScore", "score", "final_score", "finalScore"]),
    faithfulnessScore: scoreValue(source, ["faithfulness_score", "faithfulnessScore", "faithfulness"]),
    completenessScore: scoreValue(source, ["completeness_score", "completenessScore", "completeness"]),
    decisionActionCoverageScore: scoreValue(source, ["decision_action_coverage_score", "decisionActionCoverageScore", "decision_coverage"]),
    relevanceConcisenessScore: scoreValue(source, ["relevance_conciseness_score", "relevanceConcisenessScore", "relevance_score"]),
    municipalSummarySuitabilityScore: scoreValue(source, ["municipal_summary_suitability_score", "municipalSummarySuitabilityScore", "suitability_score"])
  };
  const normalizedPercentages = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key.replace(/Score$/u, "Percentage"), scorePercentage(value)]));
  return {
    overall_score: fields.overallScore,
    faithfulness_score: fields.faithfulnessScore,
    completeness_score: fields.completenessScore,
    decision_action_coverage_score: fields.decisionActionCoverageScore,
    relevance_conciseness_score: fields.relevanceConcisenessScore,
    municipal_summary_suitability_score: fields.municipalSummarySuitabilityScore,
    normalizedPercentages,
    scale: UNIRRM_NATIVE_SCALE,
    unsupported_claims: Array.isArray(source.unsupported_claims) ? source.unsupported_claims : [],
    contradicted_claims: Array.isArray(source.contradicted_claims) ? source.contradicted_claims : [],
    omitted_important_items: Array.isArray(source.omitted_important_items) ? source.omitted_important_items : [],
    evidence: Array.isArray(source.evidence) ? source.evidence : [],
    confidence: scoreValue(source, ["confidence"]),
    reasoning: text(source.reasoning ?? source.Analysis_process),
    final_verdict: text(source.final_verdict ?? source.verdict ?? source.best_id),
    raw: parsed
  };
}

function pilotJudgePrompt({ sourceText, summaryText, pairwise = false, displayed = null, repair = false } = {}) {
  const rubric = "Score each applicable dimension from 1 (poor) to 5 (excellent). Ground every finding in SOURCE. Check factual faithfulness, coverage of decisions/actions, concise relevance, and suitability for municipal minutes. Identify unsupported or contradicted claims and omitted important items with source evidence.";
  const schema = '{"overall_score":1,"faithfulness_score":1,"completeness_score":1,"decision_action_coverage_score":1,"relevance_conciseness_score":1,"municipal_summary_suitability_score":1,"unsupported_claims":[],"contradicted_claims":[],"omitted_important_items":[],"evidence":[],"confidence":1,"reasoning":"","final_verdict":""}';
  const candidates = pairwise
    ? `<Response1 model="${displayed?.[0] ?? "A"}">\n${displayed?.[2] ?? ""}\n</Response1>\n<Response2 model="${displayed?.[1] ?? "B"}">\n${displayed?.[3] ?? ""}\n</Response2>`
    : `<CandidateSummary>\n${summaryText}\n</CandidateSummary>`;
  return [
    "You are UniRRM evaluating a municipal meeting-summary task.",
    "Return one JSON object only. Do not expose analysis outside the JSON object.",
    "The reference summary is intentionally withheld. Judge the candidate only against the transcript and task rubric.",
    "TASK: Produce a concise, source-grounded municipal meeting summary covering topics, decisions, motions, votes, action items, names, dates, amounts, deadlines and uncertainty without invention.",
    `RUBRIC: ${rubric}`,
    `REQUIRED JSON SHAPE: ${schema}`,
    repair ? "Repair the previous response into valid JSON matching the required shape. Preserve the substantive judgement; do not add prose." : "",
    `SOURCE:\n${sourceText}`,
    candidates
  ].filter(Boolean).join("\n\n");
}

function classifyJudgeError(error) {
  const message = text(error?.message ?? error);
  return /fetch|network|timeout|ECONN|HTTP|request failed/iu.test(message) ? "transport-error" : "model-error";
}

async function judgeOne({ executor, sample, prompt, mode, identity, now = () => new Date(), maxRepair = 1 }) {
  const attempts = [];
  let repair = false;
  for (let attempt = 0; attempt <= maxRepair; attempt += 1) {
    try {
      const response = await executor({ model: UNIRRM_MODEL_ID, prompt: repair ? `${prompt}\n\nPREVIOUS INVALID RESPONSE:\n${text(attempts.at(-1)?.raw).slice(0, 12000)}` : prompt, sample, operation: "judge" });
      const raw = String(response?.text ?? "");
      const parsed = parseUniRrmOutput(raw);
      attempts.push({ attempt: attempt + 1, raw, parseError: parsed.valid ? null : parsed.error, repaired: repair, timing: response?.timing ?? null });
      if (parsed.valid) {
        return {
          status: "ok",
          identity,
          mode,
          judgement: normalizeUniRrmJudgement(parsed.value, { mode }),
          rawResponse: raw,
          attempts,
          repairAttempted: attempt > 0,
          repairStatus: attempt > 0 ? "succeeded" : "not-needed",
          judgeMetadata: response?.metadata?.modelMetadata ?? response?.metadata ?? null,
          timing: response?.timing ?? {},
          finishedAt: now().toISOString()
        };
      }
      repair = true;
    } catch (error) {
      attempts.push({ attempt: attempt + 1, raw: "", parseError: null, repaired: repair, error: text(error?.message ?? error) });
      return {
        status: classifyJudgeError(error),
        identity,
        mode,
        judgement: null,
        rawResponse: "",
        attempts,
        repairAttempted: attempt > 0,
        repairStatus: attempt > 0 ? "failed-transport" : "not-started",
        error: text(error?.message ?? error),
        finishedAt: now().toISOString()
      };
    }
  }
  return { status: "malformed-output", identity, mode, judgement: null, rawResponse: "", attempts, repairAttempted: true, repairStatus: "exhausted", error: "UniRRM output remained malformed after one repair retry", finishedAt: now().toISOString() };
}

function pointwiseRow({ runId, sample, generationRow, result, judgeSettings }) {
  return {
    runId,
    identity: result.identity,
    kind: "pointwise",
    status: result.status,
    sampleId: sample.id,
    model: generationRow.model,
    modelDigest: generationRow.modelDigest ?? generationRow.modelMetadata?.modelDigest ?? null,
    sourceHash: generationRow.inputHash,
    candidateOutputHash: generationRow.outputHash,
    judge: { name: UNIRRM_JUDGE_NAME, modelId: UNIRRM_MODEL_ID, provider: "huggingface", ...judgeSettings, ...result.judgeMetadata },
    judgement: result.judgement,
    rawResponse: result.rawResponse,
    attempts: result.attempts,
    repairAttempted: result.repairAttempted,
    repairStatus: result.repairStatus,
    timing: result.timing ?? {},
    error: result.error ?? null,
    finishedAt: result.finishedAt
  };
}

function displayedWinner(value, displayedModels) {
  const raw = text(value).toLowerCase();
  if (["tie", "draw", "equal", "none"].includes(raw)) return "tie";
  if (raw.includes("response1") || raw === "a" || raw === "1") return displayedModels[0];
  if (raw.includes("response2") || raw === "b" || raw === "2") return displayedModels[1];
  return displayedModels.find(model => model.toLowerCase() === raw) ?? null;
}

function pairwiseRow({ runId, sample, left, right, primary, swapped, displayed }) {
  const primaryWinner = displayedWinner(primary.judgement?.final_verdict, displayed);
  const swappedWinnerDisplayed = displayedWinner(swapped?.judgement?.final_verdict, [displayed[1], displayed[0]]);
  const swappedWinner = swappedWinnerDisplayed === displayed[1] ? displayed[0] : swappedWinnerDisplayed === displayed[0] ? displayed[1] : swappedWinnerDisplayed;
  const positionAgreement = primaryWinner && swappedWinner ? primaryWinner === swappedWinner : null;
  const primaryScores = primary.judgement?.raw?.evaluations ?? [];
  const margin = numeric(primary.judgement?.raw?.margin ?? primary.judgement?.raw?.score_margin);
  return {
    runId,
    identity: primary.identity,
    kind: "pairwise",
    status: primary.status === "ok" ? "ok" : primary.status,
    sampleId: sample.id,
    modelA: left.model,
    modelB: right.model,
    candidateOutputHashes: { [left.model]: left.outputHash, [right.model]: right.outputHash },
    sourceHash: left.inputHash,
    judge: { name: UNIRRM_JUDGE_NAME, modelId: UNIRRM_MODEL_ID, provider: "huggingface" },
    displayedOrder: displayed,
    primary: primary.status === "ok" ? { winner: primaryWinner, judgement: primary.judgement, rawResponse: primary.rawResponse, attempts: primary.attempts, timing: primary.timing } : null,
    orderSwap: swapped ? { winner: swappedWinner, judgement: swapped.judgement, rawResponse: swapped.rawResponse, attempts: swapped.attempts, timing: swapped.timing } : null,
    winner: primaryWinner,
    margin,
    positionAgreement,
    confidence: primary.judgement?.confidence ?? null,
    rawResponse: primary.rawResponse,
    error: primary.error ?? null,
    evaluationsSeen: primaryScores.length
  };
}

function latestByIdentity(rows) {
  const latest = new Map();
  for (const row of rows) {
    const key = row.identity ?? `${row.kind}\u0000${row.sampleId}\u0000${row.model ?? `${row.modelA}\u0000${row.modelB}`}`;
    latest.set(key, row);
  }
  return [...latest.values()];
}

function aggregateGeneration(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const latencies = successful.map(row => numeric(row.metrics?.totalElapsedMs)).filter(value => value !== null);
  return {
    sampleCount: rows.length,
    successfulCount: successful.length,
    failureCount: rows.filter(row => row.status === "error").length,
    rouge1: mean(successful.map(row => numeric(row.scores?.rouge1)).filter(value => value !== null)),
    rouge2: mean(successful.map(row => numeric(row.scores?.rouge2)).filter(value => value !== null)),
    rougeL: mean(successful.map(row => numeric(row.scores?.rougeL)).filter(value => value !== null)),
    averageOutputTokens: mean(successful.map(row => numeric(row.metrics?.outputTokens)).filter(value => value !== null)),
    averageLatencyMs: mean(latencies),
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    generationTokensPerSecond: mean(successful.map(row => numeric(row.metrics?.generationTokensPerSecond)).filter(value => value !== null))
  };
}

function aggregatePointwise(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const average = field => mean(successful.map(row => numeric(row.judgement?.normalizedPercentages?.[field])).filter(value => value !== null));
  return {
    sampleCount: rows.length,
    successfulCount: successful.length,
    failureCount: rows.filter(row => row.status !== "ok").length,
    overallPercentage: average("overallPercentage"),
    faithfulnessPercentage: average("faithfulnessPercentage"),
    completenessPercentage: average("completenessPercentage"),
    decisionActionCoveragePercentage: average("decisionActionCoveragePercentage"),
    relevanceConcisenessPercentage: average("relevanceConcisenessPercentage"),
    municipalSummarySuitabilityPercentage: average("municipalSummarySuitabilityPercentage"),
    unsupportedClaimCount: successful.reduce((sum, row) => sum + (row.judgement?.unsupported_claims?.length ?? 0), 0),
    contradictedClaimCount: successful.reduce((sum, row) => sum + (row.judgement?.contradicted_claims?.length ?? 0), 0),
    omittedImportantItemCount: successful.reduce((sum, row) => sum + (row.judgement?.omitted_important_items?.length ?? 0), 0),
    averageConfidence: mean(successful.map(row => numeric(row.judgement?.confidence)).filter(value => value !== null))
  };
}

function aggregatePairwise(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const pair = new Map();
  for (const row of successful) {
    const key = `${row.modelA} vs ${row.modelB}`;
    if (!pair.has(key)) pair.set(key, []);
    pair.get(key).push(row);
  }
  return [...pair.entries()].map(([comparison, values]) => {
    const winsA = values.filter(row => row.winner === row.modelA).length;
    const winsB = values.filter(row => row.winner === row.modelB).length;
    const ties = values.filter(row => row.winner === "tie" || !row.winner).length;
    return {
      comparison,
      modelA: values[0].modelA,
      modelB: values[0].modelB,
      sampleCount: values.length,
      winRateA: winsA / values.length,
      winRateB: winsB / values.length,
      tieRate: ties / values.length,
      averageMargin: mean(values.map(row => numeric(row.margin)).filter(value => value !== null)),
      orderSwappedAgreement: mean(values.map(row => numeric(row.positionAgreement)).filter(value => value !== null))
    };
  });
}

function renderPilotMarkdown(run) {
  const lines = [
    `# MeetingBank UniRRM judge pilot: ${run.runId}`,
    "",
    `- Status: ${run.status}`,
    `- Generation run: ${run.generationRunId}`,
    `- Evaluation mode: ${run.evaluationMode}`,
    `- Dataset split/hash: ${run.actualSplit}/${run.datasetHash}`,
    `- Selection seed: ${run.selection.seed}`,
    `- Selected samples: ${run.selection.sampleIds.join(", ")}`,
    `- Ollama endpoint: ${run.ollama.baseUrl}`,
    `- Judge: ${run.judge.name} (${run.judge.modelId}) via ${run.judge.provider}`,
    "",
    "ROUGE is reference-summary similarity; UniRRM is a provisional model-generated evaluation estimate. The reference summary was withheld from the judge.",
    "",
    "## Model availability",
    "",
    "| Requested model | Resolved tag | Available | Digest |",
    "| --- | --- | --- | --- |",
    ...run.ollama.resolved.map(model => `| ${model.requestedModel} | ${model.resolvedModel ?? "-"} | ${model.available ? "yes" : "no"} | ${model.digest ?? "-"} |`),
    "",
    "## Generation comparison",
    "",
    "| Model | Samples | Successes | Failures | ROUGE-1 | ROUGE-2 | ROUGE-L | Avg output tokens | Avg latency ms | Median ms | P95 ms | Gen tok/s |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...run.generationAggregates.map(row => `| ${row.model} | ${row.aggregate.sampleCount} | ${row.aggregate.successfulCount} | ${row.aggregate.failureCount} | ${formatPercent(row.aggregate.rouge1 * 100)} | ${formatPercent(row.aggregate.rouge2 * 100)} | ${formatPercent(row.aggregate.rougeL * 100)} | ${formatNumber(row.aggregate.averageOutputTokens, 1)} | ${formatNumber(row.aggregate.averageLatencyMs, 1)} | ${formatNumber(row.aggregate.medianLatencyMs, 1)} | ${formatNumber(row.aggregate.p95LatencyMs, 1)} | ${formatNumber(row.aggregate.generationTokensPerSecond, 1)} |`),
    "",
    "## UniRRM pointwise comparison",
    "",
    "| Model | Rows | Successes | Overall | Faithfulness | Completeness | Decision/action | Relevance/conciseness | Municipal suitability | Unsupported | Contradicted | Omitted | Confidence |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...run.pointwiseAggregates.map(row => `| ${row.model} | ${row.aggregate.sampleCount} | ${row.aggregate.successfulCount} | ${formatPercent(row.aggregate.overallPercentage)} | ${formatPercent(row.aggregate.faithfulnessPercentage)} | ${formatPercent(row.aggregate.completenessPercentage)} | ${formatPercent(row.aggregate.decisionActionCoveragePercentage)} | ${formatPercent(row.aggregate.relevanceConcisenessPercentage)} | ${formatPercent(row.aggregate.municipalSummarySuitabilityPercentage)} | ${row.aggregate.unsupportedClaimCount} | ${row.aggregate.contradictedClaimCount} | ${row.aggregate.omittedImportantItemCount} | ${formatNumber(row.aggregate.averageConfidence, 2)} |`),
    "",
    "## Pairwise comparisons",
    "",
    "| Comparison | Samples | A win rate | B win rate | Ties | Avg margin | Order-swapped agreement |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...run.pairwiseAggregates.map(row => `| ${row.comparison} | ${row.sampleCount} | ${formatPercent(row.winRateA * 100)} | ${formatPercent(row.winRateB * 100)} | ${formatPercent(row.tieRate * 100)} | ${formatNumber(row.averageMargin, 2)} | ${formatPercent(row.orderSwappedAgreement * 100)} |`),
    "",
    "## Per-sample review",
    "",
    ...run.selection.sampleIds.map(sampleId => {
      const sample = run.sampleMetadata.find(item => String(item.sampleId) === String(sampleId));
      return `### ${sampleId}\n\n- Meeting: ${sample?.meetingId ?? "-"}; city: ${sample?.city ?? "-"}; type: ${sample?.type ?? "-"}; transcript tokens: ${sample?.transcriptTokens ?? "-"}\n- Reference: ${sample?.reference ?? "-"}\n${run.models.map(model => {
        const generated = run.generationRows.find(row => row.model === model && String(row.sampleId) === String(sampleId));
        const judged = run.pointwiseRows.find(row => row.model === model && String(row.sampleId) === String(sampleId));
        return `- ${model}: ${generated?.output ?? "[generation unavailable]"}\n  ROUGE-L: ${formatPercent((generated?.scores?.rougeL ?? null) * 100)}; UniRRM overall: ${formatPercent(judged?.judgement?.normalizedPercentages?.overallPercentage)}; unsupported: ${judged?.judgement?.unsupported_claims?.length ?? "-"}; contradicted: ${judged?.judgement?.contradicted_claims?.length ?? "-"}`;
      }).join("\n")}`;
    }),
    "",
    "## Provenance",
    "",
    `- Dataset source: ${run.suite.sourceUrls.join(", ")}`,
    `- Prompt hash: ${run.promptHash}`,
    `- Judge scale: ${run.judge.scale.min}-${run.judge.scale.max}; normalization: ${run.judge.scale.formula}`,
    `- Judge parse failures: ${run.judgeStats.malformedOutput}`,
    `- Judge transport failures: ${run.judgeStats.transportError}`,
    `- Pairwise order seed: ${run.pairwiseSeed}`,
    ""
  ];
  return lines.join("\n");
}

function renderPilotCsv(run) {
  const headers = ["kind", "sample_id", "model", "model_a", "model_b", "status", "rouge1", "rouge2", "rougeL", "overall_percentage", "faithfulness_percentage", "completeness_percentage", "decision_action_percentage", "relevance_conciseness_percentage", "municipal_suitability_percentage", "unsupported_claims", "contradicted_claims", "omitted_items", "winner", "position_agreement", "latency_ms", "output_tokens", "generation_tokens_per_second", "source_hash", "output_hash", "judge_model", "error"];
  const rows = [headers.join(",")];
  for (const row of run.generationRows) rows.push(["generation", row.sampleId, row.model, "", "", row.status, row.scores?.rouge1, row.scores?.rouge2, row.scores?.rougeL, ...Array(9).fill(""), row.metrics?.totalElapsedMs, row.metrics?.outputTokens, row.metrics?.generationTokensPerSecond, row.inputHash, row.outputHash, "", row.error].map(csvEscape).join(","));
  for (const row of run.pointwiseRows) rows.push(["pointwise", row.sampleId, row.model, "", "", row.status, ...Array(3).fill(""), row.judgement?.normalizedPercentages?.overallPercentage, row.judgement?.normalizedPercentages?.faithfulnessPercentage, row.judgement?.normalizedPercentages?.completenessPercentage, row.judgement?.normalizedPercentages?.decisionActionCoveragePercentage, row.judgement?.normalizedPercentages?.relevanceConcisenessPercentage, row.judgement?.normalizedPercentages?.municipalSummarySuitabilityPercentage, row.judgement?.unsupported_claims?.length, row.judgement?.contradicted_claims?.length, row.judgement?.omitted_important_items?.length, "", "", row.timing?.totalElapsedMs, "", "", row.sourceHash, row.candidateOutputHash, row.judge?.modelId, row.error].map(csvEscape).join(","));
  for (const row of run.pairwiseRows) rows.push(["pairwise", row.sampleId, "", row.modelA, row.modelB, row.status, ...Array(15).fill(""), row.winner, row.positionAgreement, "", "", "", row.sourceHash, "", row.judge?.modelId, row.error].map(csvEscape).join(","));
  return `${rows.join("\n")}\n`;
}

function renderPilotHtml(run) {
  const escape = value => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
  const rows = run.selection.sampleIds.flatMap(sampleId => run.models.map(model => {
    const generated = run.generationRows.find(row => row.model === model && String(row.sampleId) === String(sampleId));
    const judged = run.pointwiseRows.find(row => row.model === model && String(row.sampleId) === String(sampleId));
    return `<tr><td>${escape(sampleId)}</td><td>${escape(model)}</td><td><pre>${escape(generated?.output ?? "")}</pre></td><td>${escape(formatPercent((generated?.scores?.rougeL ?? null) * 100))}</td><td>${escape(formatPercent(judged?.judgement?.normalizedPercentages?.overallPercentage))}</td><td><pre>${escape(JSON.stringify(judged?.judgement?.evidence ?? []))}</pre></td></tr>`;
  }));
  return `<!doctype html><html><head><meta charset="utf-8"><title>MeetingBank UniRRM judge pilot</title><style>body{font-family:system-ui,sans-serif;max-width:1400px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;vertical-align:top}pre{white-space:pre-wrap;max-height:18rem;overflow:auto}</style></head><body><h1>MeetingBank UniRRM judge pilot</h1><p>Run ${escape(run.runId)}. ROUGE is reference similarity; UniRRM is a provisional external judge estimate.</p><table><thead><tr><th>Sample</th><th>Model</th><th>Summary</th><th>ROUGE-L</th><th>UniRRM overall</th><th>Evidence</th></tr></thead><tbody>${rows.join("")}</tbody></table></body></html>`;
}

export async function runMeetingBankJudgePilot({
  root = process.cwd(),
  datasetPath,
  split = "test",
  runId = null,
  models = MEETINGBANK_JUDGE_PILOT_MODELS,
  selectionSeed = MEETINGBANK_JUDGE_PILOT_SELECTION_SEED,
  selectionCount = DEFAULT_SELECTION_COUNT,
  profile = "summary_direct",
  contextLength = null,
  baseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? "http://mriczo:11434",
  gpuHousekeeperUrl = process.env.PYA_GPU_HOUSEKEEPER_URL ?? null,
  gpuId = process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0",
  huggingFaceRevision = process.env.PYA_HUGGINGFACE_REVISION ?? null,
  huggingFaceDtype = process.env.PYA_HF_DTYPE ?? "auto",
  judgeModel = UNIRRM_MODEL_ID,
  judgeProvider = "huggingface",
  judgeTemperature = DEFAULT_JUDGE_TEMPERATURE,
  judgeMaxOutputTokens = DEFAULT_JUDGE_MAX_OUTPUT_TOKENS,
  resume = false,
  smoke = false,
  fetchImpl = globalThis.fetch,
  generationRunner = null,
  judgeExecutor = null,
  now = () => new Date()
} = {}) {
  if (!datasetPath) throw new Error("MeetingBank judge pilot requires --dataset <meetingbank test file>");
  const id = String(runId ?? `meetingbank-qwen-unirrm-pilot-${now().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`);
  const loaded = await loadSuiteSamples({ benchmark: "meetingbank", datasetPath, split });
  const effectiveSelectionSeed = text(selectionSeed) || MEETINGBANK_JUDGE_PILOT_SELECTION_SEED;
  const selection = selectMeetingBankJudgePilotSamples(loaded.samples, { count: smoke ? Math.min(5, selectionCount) : selectionCount, seed: effectiveSelectionSeed });
  const pilotModels = [...models].map(text).filter(Boolean);
  const ollama = await resolvePilotModels({ models: pilotModels, baseUrl, fetchImpl });
  const availability = new Map(ollama.resolved.map(item => [item.requestedModel, item]));
  const generationRunId = `${id}-generation`;
  const generationMetadataProvider = async ({ model }) => {
    const entry = availability.get(model);
    if (!entry?.available) return { model, requestedModel: model, resolvedModel: null, unavailable: true, engine: "ollama" };
    return { ...(await readOllamaMetadata({ model: entry.resolvedModel, baseUrl: ollama.baseUrl, fetchImpl })), requestedModel: model, resolvedModel: entry.resolvedModel };
  };
  const generationExecutor = async input => {
    const entry = availability.get(input.model);
    if (!entry?.available) throw new Error(`requested Ollama model unavailable: ${input.model}`);
    return runOllamaChat({ ...input, model: entry.resolvedModel, baseUrl: ollama.baseUrl, profile, contextLength, fetchImpl });
  };
  const generationRun = generationRunner
    ? await generationRunner({ id: generationRunId, samples: selection, models: pilotModels, resume })
    : await runCriterion({
      benchmark: "meetingbank",
      datasetPath,
      split,
      sampleIds: selection.map(sample => sample.id),
      limit: null,
      models: pilotModels,
      profile,
      contextLength,
      runId: generationRunId,
      root,
      resume,
      smoke,
      engine: "ollama",
      executor: generationExecutor,
      metadataProvider: generationMetadataProvider,
      promptTransform: sample => `${MEETINGBANK_JUDGE_PILOT_PROMPT}\n\nTRANSCRIPT:\n${sample.input}`,
      promptVariant: "summary_meetingbank_judge_pilot",
      promptTemplateHash: MEETINGBANK_JUDGE_PILOT_PROMPT_HASH,
      recordPrompt: true,
      replayCommand: `node command/criterion.mjs meetingbank-judge-pilot --dataset ${datasetPath} --run-id ${id} --resume`
    });

  const pilotCheckpointPath = path.resolve(root, "criterion", "results", `${id}.jsonl`);
  const priorRows = resume ? await readJsonl(pilotCheckpointPath) : [];
  const checkpointRows = [...priorRows];
  const priorSuccessful = new Set(priorRows.filter(row => row.status === "ok").map(row => row.identity));
  const currentRows = new Map();
  for (const row of priorRows) currentRows.set(row.identity, row);
  const addRow = row => {
    checkpointRows.push(row);
    currentRows.set(row.identity, row);
  };
  const generationRows = generationRun.results ?? [];
  const judgeSettings = { temperature: judgeTemperature, maxOutputTokens: judgeMaxOutputTokens, promptVersion: "meetingbank-unirrm-rubric-v1" };
  let adapter = null;
  let executeJudge = judgeExecutor;
  if (!executeJudge) {
    adapter = await createHuggingFaceJudgeExecutor({ model: judgeModel, root, runId: id, housekeeperUrl: gpuHousekeeperUrl, gpuId, revision: huggingFaceRevision, dtype: huggingFaceDtype, generation: { maxInputTokens: 32768, maxOutputTokens: judgeMaxOutputTokens, minOutputTokens: 1, numBeams: 1, doSample: false, repetitionPenalty: 1.05 } });
    executeJudge = adapter.executor;
  }
  try {
    for (const model of pilotModels) {
      for (const sample of selection) {
        const generationRow = generationRowFor(generationRows, model, sample.id);
        if (!generationRow) continue;
        const identity = `pointwise\u0000${model}\u0000${sample.id}`;
        if (priorSuccessful.has(identity)) continue;
        const result = await judgeOne({ executor: executeJudge, sample, prompt: pilotJudgePrompt({ sourceText: sample.input, summaryText: generationRow.output }), mode: "pointwise", identity, now });
        addRow(pointwiseRow({ runId: id, sample, generationRow, result, judgeSettings }));
        await writeJsonl(pilotCheckpointPath, checkpointRows);
      }
    }

    const successfulBySample = new Map();
    for (const sample of selection) {
      const rows = pilotModels.map(model => generationRowFor(generationRows, model, sample.id)).filter(Boolean);
      if (rows.length >= 2) successfulBySample.set(String(sample.id), rows);
    }
    const pairs = [];
    for (let left = 0; left < pilotModels.length; left += 1) for (let right = left + 1; right < pilotModels.length; right += 1) pairs.push([pilotModels[left], pilotModels[right]]);
    for (const sample of selection) {
      const availableRows = successfulBySample.get(String(sample.id)) ?? [];
      for (const [modelA, modelB] of pairs) {
        const left = availableRows.find(row => row.model === modelA);
        const right = availableRows.find(row => row.model === modelB);
        if (!left || !right) continue;
        const identity = `pairwise\u0000${sample.id}\u0000${modelA}\u0000${modelB}`;
        if (priorSuccessful.has(identity)) continue;
        const swappedFirst = hashRank(`${effectiveSelectionSeed}:pairwise`, `${sample.id}:${modelA}:${modelB}`).charCodeAt(0) % 2 === 0;
        const displayed = swappedFirst ? [modelB, modelA, right.output, left.output] : [modelA, modelB, left.output, right.output];
        const primary = await judgeOne({ executor: executeJudge, sample, prompt: pilotJudgePrompt({ sourceText: sample.input, pairwise: true, displayed }), mode: "pairwise", identity, now });
        const swapped = await judgeOne({ executor: executeJudge, sample, prompt: pilotJudgePrompt({ sourceText: sample.input, pairwise: true, displayed: [displayed[1], displayed[0], displayed[3], displayed[2]] }), mode: "pairwise", identity: `${identity}\u0000swap`, now });
        addRow(pairwiseRow({ runId: id, sample, left, right, primary, swapped, displayed: [displayed[0], displayed[1]] }));
        await writeJsonl(pilotCheckpointPath, checkpointRows);
      }
    }
  } finally {
    if (adapter) await adapter.close();
  }

  const allPilotRows = latestByIdentity([...currentRows.values()]);
  const pointwiseRows = allPilotRows.filter(row => row.kind === "pointwise");
  const pairwiseRows = allPilotRows.filter(row => row.kind === "pairwise");
  const sampleMetadata = selection.map(sample => ({ sampleId: sample.id, meetingId: sample.metadata?.meetingId ?? null, city: sample.metadata?.city ?? null, type: sample.metadata?.type ?? null, transcriptTokens: sample.metadata?.transcriptTokens ?? tokenize(sample.input).length, reference: sample.reference ?? "" }));
  const judgeStats = Object.fromEntries(["malformed-output", "transport-error", "model-error", "ok"].map(status => [status === "malformed-output" ? "malformedOutput" : status === "transport-error" ? "transportError" : status === "model-error" ? "modelError" : "success", [...pointwiseRows, ...pairwiseRows].filter(row => row.status === status).length]));
  const generationAggregates = pilotModels.map(model => ({ model, aggregate: aggregateGeneration(generationRows.filter(row => row.model === model)) }));
  const pointwiseAggregates = pilotModels.map(model => ({ model, aggregate: aggregatePointwise(pointwiseRows.filter(row => row.model === model)) }));
  const finishedAt = now().toISOString();
  const finalRun = await writeRunArtifacts({
    runId: id,
    criterion: "meetingbank-judge-pilot",
    suite: {
      key: "meetingbank-judge-pilot",
      name: "MeetingBank Qwen UniRRM judge pilot",
      version: "ten-sample generation plus UniRRM pointwise/pairwise judging",
      sourceUrls: ["https://meetingbank.github.io/dataset/", "https://huggingface.co/SUSTech-NLP/UniRRM-8B", "https://arxiv.org/html/2609.05910v1"],
      licenseUrls: ["https://meetingbank.github.io/license/"]
    },
    status: [...generationRows, ...pointwiseRows, ...pairwiseRows].some(row => row.status !== "ok") ? "partial" : "completed",
    evaluationMode: MEETINGBANK_JUDGE_PILOT_MODE,
    split,
    actualSplit: loaded.actualSplit,
    availableSplits: loaded.availableSplits,
    datasetPath,
    datasetHash: loaded.datasetHash,
    datasetRevision: process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned",
    models: pilotModels,
    engine: "ollama-plus-huggingface-judge",
    profile,
    contextLength,
    promptHash: MEETINGBANK_JUDGE_PILOT_PROMPT_HASH,
    generationPrompt: { name: "summary_meetingbank_judge_pilot", hash: MEETINGBANK_JUDGE_PILOT_PROMPT_HASH, text: MEETINGBANK_JUDGE_PILOT_PROMPT },
    generationRunId,
    generationRows,
    pointwiseRows,
    pairwiseRows,
    results: [...generationRows, ...pointwiseRows, ...pairwiseRows],
    generationAggregates,
    pointwiseAggregates,
    pairwiseAggregates: aggregatePairwise(pairwiseRows),
    selection: { seed: effectiveSelectionSeed, count: selection.length, sampleIds: selection.map(sample => sample.id), datasetHash: loaded.datasetHash },
    sampleMetadata,
    ollama,
    judge: { name: UNIRRM_JUDGE_NAME, modelId: judgeModel, provider: judgeProvider, scale: UNIRRM_NATIVE_SCALE, temperature: judgeTemperature, maxOutputTokens: judgeMaxOutputTokens, referenceHidden: true },
    secondaryJudges: { skywork: { status: "unavailable", reason: "managed Hugging Face protocol exposes text generation only; no sequence-classification endpoint" } },
    judgeStats,
    pairwiseSeed: `${effectiveSelectionSeed}:pairwise`,
    machine: await collectMachineMetadata(),
    smoke,
    runScope: smoke ? "smoke" : "pilot",
    mode: "criterion-judge-pilot",
    createdAt: now().toISOString(),
    startedAt: now().toISOString(),
    finishedAt,
    totalWallClockMs: 0,
    replayCommand: `node command/criterion.mjs meetingbank-judge-pilot --dataset ${datasetPath} --run-id ${id} --resume`
  }, { root, checkpointResults: checkpointRows });
  return finalRun;
}

export { renderPilotCsv, renderPilotHtml, renderPilotMarkdown };
