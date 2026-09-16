import fs from "node:fs/promises";
import path from "node:path";

import { collectMachineMetadata } from "./machine.mjs";
import { loadSuiteSamples } from "./datasets.mjs";
import { createHuggingFaceJudgeExecutor } from "./huggingface.mjs";
import { isTransientOllamaError, readOllamaMetadata, resolveOllamaBaseUrl, runOllamaChat } from "./ollama.mjs";
import { runCriterion } from "./run.mjs";
import { writeRunArtifacts } from "./report.mjs";
import { mean, parseJsonOutput, sha256, stripThinking, tokenize } from "./metrics.mjs";
import { parseUniRrmOutput, selectMeetingBankJudgePilotSamples } from "./judge-pilot.mjs";

export const MEETINGBANK_FACTUALITY_MODE = "meetingbank-qwen-factuality-pilot";
export const MEETINGBANK_FACTUALITY_RUN_ID = "meetingbank-qwen-factuality-pilot-20260916";
export const MEETINGBANK_FACTUALITY_MODELS = Object.freeze([
  "qwen3.5:9b",
  "hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M",
  "qwen3.8:27b"
]);
export const MEETINGBANK_FACTUALITY_SELECTION_SEED = "meetingbank-unirrm-pilot-20260915";
export const MEETINGBANK_FACTUALITY_PROMPT = "You are summarizing one city-council meeting transcript for a municipal publication. Write one concise, factual meeting summary based only on the transcript. Include the main topics, decisions and resolutions, motions and votes, action items and responsible parties, important dates and deadlines, and any uncertainty that remains in the transcript. Preserve exact names, numbers, dates, ordinance or resolution identifiers, and vote outcomes when present. Do not invent details or add commentary about this evaluation. Output plain text suitable for municipal minutes, with no title, labels, bullets, preamble, analysis, or explanation.";
export const MEETINGBANK_FACTUALITY_PROMPT_HASH = sha256(MEETINGBANK_FACTUALITY_PROMPT);
export const UNIRRM_FACTUALITY_MODEL = "SUSTech-NLP/UniRRM-8B";
export const UNIRRM_FACTUALITY_NAME = "judge:unirrm-8b";
export const UNIRRM_FACTUALITY_PROMPT_VERSION = "meetingbank-transcript-grounded-v2";

const CLAIM_LIMIT = 20;
const SOURCE_ITEM_LIMIT = 20;
const JUDGE_MAX_OUTPUT_TOKENS = 2048;
const CLAIM_TYPES = ["topic", "discussion", "decision", "motion", "vote", "action-item", "responsible-party", "date-or-deadline", "financial-or-number", "attribution", "other"];
const STOP_WORDS = new Set("a an and are as at be by for from had has have in into is it of on or that the their this to was were with will would".split(" "));

function text(value) { return String(value ?? "").trim(); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function percentage(value) { const score = finite(value); return score === null ? null : score >= 1 && score <= 5 ? ((score - 1) / 4) * 100 : score >= 0 && score <= 1 ? score * 100 : null; }
function csv(value) { const result = value === null || value === undefined ? "" : String(value); return /[",\n]/u.test(result) ? `"${result.replace(/"/gu, '""')}"` : result; }
function hashRank(seed, id) { return sha256(`${seed}\u0000${id}`); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function sentenceParts(value) {
  return String(value ?? "")
    .replace(/\r/gu, "")
    .split(/(?<=[.!?])\s+|\n+/u)
    .map(item => item.replace(/^\s*(?:\[[^\]]+\]|\d{1,2}:\d{2}(?::\d{2})?|[^:]{1,80}:)\s*/u, "").trim())
    .filter(item => item.length >= 12);
}

function sourceTurns(transcript) {
  return sentenceParts(transcript).map((sentence, index) => ({
    turnId: `turn-${index + 1}`,
    sentenceId: `source-${index + 1}`,
    text: sentence,
    speaker: null,
    timestamp: null
  }));
}

function terms(value) {
  return unique(tokenize(value).filter(token => token.length > 2 && !STOP_WORDS.has(token)));
}

function claimType(value) {
  const lower = value.toLowerCase();
  if (/\b(motion|moved|seconded|resolution|ordinance)\b/u.test(lower)) return "motion";
  if (/\b(vote|voted|ayes?|nay|unanim|passes?|approved|rejected|denied|adopted)\b/u.test(lower)) return "vote";
  if (/\b(action|directed|will prepare|must|shall|assigned|staff should|follow[- ]?up|next step)\b/u.test(lower)) return "action-item";
  if (/\b(by|before|deadline|due|on monday|on tuesday|on wednesday|on thursday|on friday|on saturday|on sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/u.test(lower)) return "date-or-deadline";
  if (/\$?\d[\d,.]*|\b\d+(?:\.\d+)?%\b/u.test(lower)) return "financial-or-number";
  if (/\b(councilmember|mayor|chair|director|manager|department|staff|spoke|said|reported)\b/u.test(lower)) return "attribution";
  if (/\b(discussed|discussion|concern|question|comment|requested|presented|reviewed)\b/u.test(lower)) return "discussion";
  if (/\b(agenda|topic|meeting|hearing|item|project|issue)\b/u.test(lower)) return "topic";
  return "other";
}

export function extractCandidateClaims(summary, { limit = CLAIM_LIMIT } = {}) {
  const sentences = sentenceParts(summary).slice(0, Math.max(1, limit));
  const claims = sentences.map((claim, index) => ({
    claimId: `claim-${index + 1}`,
    sentenceId: `summary-${index + 1}`,
    text: claim,
    claimType: claimType(claim),
    importance: /\b(motion|vote|approved|rejected|decision|action|deadline|due|amount|resolution|ordinance)\b/iu.test(claim) ? "high" : "material",
    namedEntities: unique(claim.match(/\b[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3}/gu) ?? []),
    numbersAndDates: unique(claim.match(/\$?\d[\d,.]*(?:%|\b)|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gu) ?? [])
  }));
  return { status: sentences.length ? "ok" : "empty", parser: "deterministic-sentence-claims-v1", raw: summary, claims };
}

export function retrieveTranscriptEvidence(claim, turns, { limit = 3 } = {}) {
  const claimTerms = new Set(terms(claim.text));
  const ranked = turns.map(turn => {
    const overlap = terms(turn.text).filter(token => claimTerms.has(token));
    const keywordBoost = claim.claimType !== "other" && claimType(turn.text) === claim.claimType ? 0.25 : 0;
    return { ...turn, overlap, score: overlap.length / Math.max(1, claimTerms.size) + keywordBoost };
  }).filter(turn => turn.score > 0).sort((left, right) => right.score - left.score || left.turnId.localeCompare(right.turnId)).slice(0, limit);
  return {
    method: "lexical-overlap-with-claim-type-boost-v1",
    evidenceHash: sha256(ranked.map(item => `${item.turnId}:${item.text}`).join("\n")),
    turns: ranked.map(item => ({ turnId: item.turnId, sentenceId: item.sentenceId, quote: item.text, speaker: item.speaker, timestamp: item.timestamp, retrievalScore: item.score }))
  };
}

export function buildSourceInventory(transcript, { limit = SOURCE_ITEM_LIMIT } = {}) {
  const turns = sourceTurns(transcript);
  const candidates = turns.filter(turn => /\b(motion|vote|approved|rejected|decision|action|deadline|due|amount|resolution|ordinance|will|shall|directed)\b/iu.test(turn.text));
  const fallback = turns.filter(turn => !candidates.includes(turn));
  const items = [...candidates, ...fallback].slice(0, Math.max(1, limit)).map((turn, index) => ({
    itemId: `source-item-${index + 1}`,
    sourceTurnIds: [turn.turnId],
    text: turn.text,
    itemType: claimType(turn.text),
    importance: index < candidates.length ? "high" : "material"
  }));
  return { status: items.length ? "ok" : "empty", parser: "deterministic-source-inventory-v1", turns, items };
}

function nativeEvaluations(parsed) {
  return Array.isArray(parsed?.evaluations) ? parsed.evaluations : [];
}

function classification(explanation, score, { coverage = false } = {}) {
  const lower = text(explanation).toLowerCase();
  const marker = lower.match(/(?:label|decision|classification|verdict)\s*[:=]\s*(supported|partially supported|partial|unsupported|contradicted|unclear|covered|partially covered|omitted)/u)?.[1];
  if (marker) {
    if (marker === "partial" || marker === "partially supported") return "partially-supported";
    if (marker === "partially covered") return "partially-covered";
    return marker;
  }
  if (/contradict/iu.test(lower)) return "contradicted";
  if (coverage && /omit|not mention|missing|absent/iu.test(lower)) return "omitted";
  if (/unsupported|not supported|invent/iu.test(lower)) return "unsupported";
  if (/partial|incomplete|somewhat/iu.test(lower)) return coverage ? "partially-covered" : "partially-supported";
  const numeric = finite(score);
  if (numeric === null) return "unclear";
  if (numeric >= 4) return coverage ? "covered" : "supported";
  if (numeric >= 3) return coverage ? "partially-covered" : "partially-supported";
  if (numeric >= 2) return coverage ? "omitted" : "unsupported";
  return "contradicted";
}

function evidenceIds(explanation, fallback = []) {
  const matches = text(explanation).match(/(?:turn|source|summary|claim)[-_][\w-]+/giu) ?? [];
  return unique(matches.map(item => item.replace(/[),.;:]$/u, ""))).length ? unique(matches) : fallback;
}

export function normalizeNativeJudgeResponse(raw, { responseIds = [], coverage = false } = {}) {
  const parsed = parseUniRrmOutput(raw);
  if (!parsed.valid) return { status: "malformed-output", parsed: null, error: parsed.error, evaluations: [] };
  const evaluations = nativeEvaluations(parsed.value);
  const normalized = responseIds.map((id, index) => {
    const evaluation = evaluations.find(item => String(item?.response_id ?? item?.responseId ?? item?.id) === String(id)) ?? evaluations[index] ?? {};
    const score = finite(evaluation.final_score ?? evaluation.finalScore ?? evaluation.score ?? parsed.value?.final_score);
    const explanation = text(evaluation.explanation ?? evaluation.reasoning ?? parsed.value?.Analysis_process);
    return {
      responseId: id,
      nativeScore: score,
      percentage: percentage(score),
      classification: classification(explanation, score, { coverage }),
      explanation,
      evidenceIds: evidenceIds(explanation),
      raw: evaluation
    };
  });
  return { status: normalized.length && evaluations.length ? "ok" : "incomplete", parsed: parsed.value, error: normalized.length ? null : "native response contained no evaluations", evaluations: normalized };
}

function nativePrompt({ stage, transcript, summary, entries, previousRaw = "" }) {
  const base = [
    "You are evaluating a municipal meeting summary against SOURCE TRANSCRIPT evidence.",
    `PASS: ${stage}`,
    "Use the native UniRRM JSON format: Analysis_process, rubrics, evaluations, best_id.",
    "Return one evaluation for every ResponseN. In each explanation begin with LABEL: followed by the requested classification, then cite exact evidence IDs in brackets.",
    "Do not use the reference summary. Do not invent evidence. Keep each explanation short enough to fit the output limit.",
    `SOURCE TRANSCRIPT:\n${transcript}`
  ];
  if (summary) base.push(`CANDIDATE SUMMARY:\n${summary}`);
  if (entries?.length) base.push(entries.map(entry => `<Response${entry.index} id="${entry.id}">${entry.text}</Response${entry.index}>`).join("\n"));
  if (previousRaw) base.push(`REPAIR THE FOLLOWING INVALID RESPONSE AS NATIVE JSON ONLY:\n${previousRaw.slice(0, 24000)}`);
  return base.join("\n\n");
}

async function judgePass({ executor, sample, identity, stage, prompt, responseIds, coverage = false, maxRepair = 1 }) {
  const attempts = [];
  let requestPrompt = prompt;
  for (let attempt = 0; attempt <= maxRepair; attempt += 1) {
    try {
      const response = await executor({
        model: UNIRRM_FACTUALITY_MODEL,
        prompt: requestPrompt,
        messages: [
          { role: "system", content: "Return concise native UniRRM JSON only. Do not output analysis outside the JSON object." },
          { role: "user", content: requestPrompt }
        ],
        sample,
        identity,
        operation: "judge"
      });
      const raw = stripThinking(response?.text ?? "");
      const normalized = normalizeNativeJudgeResponse(raw, { responseIds, coverage });
      attempts.push({ attempt: attempt + 1, raw, status: normalized.status, error: normalized.error, responseHash: sha256(raw), timing: response?.timing ?? null });
      if (normalized.status === "ok") return { status: "ok", attempts, normalized, metadata: response?.metadata ?? null, timing: response?.timing ?? {}, rawResponse: raw };
      if (attempt < maxRepair) requestPrompt = nativePrompt({ stage, transcript: sample.input, summary: "", entries: [], previousRaw: raw }) + "\n\nThe required response IDs were: " + responseIds.join(", ") + ".";
    } catch (error) {
      attempts.push({ attempt: attempt + 1, raw: "", status: isTransientOllamaError(error) ? "transport-error" : "model-error", error: text(error?.message ?? error) });
      return { status: attempts.at(-1).status, attempts, normalized: null, error: text(error?.message ?? error), metadata: null, timing: {} };
    }
  }
  return { status: "malformed-output", attempts, normalized: null, error: "native UniRRM response remained unavailable after one repair retry", metadata: null, timing: {} };
}

function weightedFaithfulness(claimResults) {
  if (!claimResults.length) return null;
  const points = claimResults.reduce((sum, item) => sum + (item.classification === "supported" ? 1 : item.classification === "partially-supported" ? 0.5 : 0), 0);
  return points / claimResults.length * 100;
}

function coveragePercentage(items) {
  if (!items.length) return null;
  return items.reduce((sum, item) => sum + (item.classification === "covered" ? 1 : item.classification === "partially-covered" ? 0.5 : 0), 0) / items.length * 100;
}

function subsetCoverage(items, types) { return coveragePercentage(items.filter(item => types.includes(item.itemType))); }

function averageTiming(passes) {
  return mean(passes.map(pass => finite(pass?.timing?.totalElapsedMs)).filter(value => value !== null));
}

function aggregateRows(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const average = key => mean(successful.map(row => finite(row.scores?.[key])).filter(value => value !== null));
  return {
    sampleCount: rows.length,
    successfulCount: successful.length,
    failureCount: rows.filter(row => row.status !== "ok").length,
    faithfulnessPercentage: average("faithfulnessPercentage"),
    coveragePercentage: average("coveragePercentage"),
    decisionFidelityPercentage: average("decisionFidelityPercentage"),
    actionFidelityPercentage: average("actionFidelityPercentage"),
    relevancePercentage: average("relevancePercentage"),
    concisenessPercentage: average("concisenessPercentage"),
    unsupportedClaimCount: successful.reduce((sum, row) => sum + (row.scores?.unsupportedClaimCount ?? 0), 0),
    contradictionCount: successful.reduce((sum, row) => sum + (row.scores?.contradictionCount ?? 0), 0),
    evidenceCoveragePercentage: average("evidenceCoveragePercentage"),
    averageLatencyMs: mean(successful.map(row => finite(row.generation?.timing?.totalElapsedMs)).filter(value => value !== null)),
    generationTokensPerSecond: mean(successful.map(row => finite(row.generation?.timing?.generationTokensPerSecond)).filter(value => value !== null))
  };
}

function renderMarkdown(run) {
  const lines = [
    `# MeetingBank factuality pilot: ${run.runId}`,
    "",
    `- Status: ${run.status}`,
    `- Evaluation: transcript-grounded, judge-estimated, provisional` ,
    `- Dataset: ${run.actualSplit}; hash ${run.datasetHash}`,
    `- Selection seed: ${run.selection.seed}`,
    `- Sample IDs: ${run.selection.sampleIds.join(", ")}`,
    `- Judge: ${run.judge.modelId} (${run.judge.revision ?? "unknown revision"})`,
    `- Judge output protocol: native UniRRM evaluations mapped to Criterion evidence; one bounded repair retry`,
    "",
    "ROUGE is intentionally excluded from this factuality lane. Historical reference similarity remains available only in the prior pilot artifacts.",
    "",
    "## Factuality comparison",
    "",
    "| Model | Faithfulness | Coverage | Decision fidelity | Action fidelity | Relevance | Conciseness | Unsupported claims | Contradictions | Successful rows | Avg latency ms | Gen tok/s |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...run.aggregates.map(row => `| ${row.model} | ${pct(row.aggregate.faithfulnessPercentage)} | ${pct(row.aggregate.coveragePercentage)} | ${pct(row.aggregate.decisionFidelityPercentage)} | ${pct(row.aggregate.actionFidelityPercentage)} | ${pct(row.aggregate.relevancePercentage)} | ${pct(row.aggregate.concisenessPercentage)} | ${row.aggregate.unsupportedClaimCount} | ${row.aggregate.contradictionCount} | ${row.aggregate.successfulCount}/${row.aggregate.sampleCount} | ${num(row.aggregate.averageLatencyMs, 1)} | ${num(row.aggregate.generationTokensPerSecond, 1)} |`),
    "",
    "No overall winner is declared; these dimensions require human-labelled calibration before a composite ranking is appropriate.",
    "",
    "## Operational evidence",
    "",
    `- Generation rows: ${run.generationStats.successful}/${run.generationStats.attempted} successful; transient retries ${run.generationStats.transientRetries}; permanent failures ${run.generationStats.permanentFailures}`,
    `- Judge rows: ${run.judgeStats.successful}/${run.judgeStats.attempted} complete; malformed ${run.judgeStats.malformed}; transport ${run.judgeStats.transport}; incomplete ${run.judgeStats.incomplete}`,
    `- Ollama endpoint: ${run.ollama.baseUrl}`,
    `- Ollama preflight: ${run.ollama.preflight.status}`,
    `- UniRRM VRAM discharge: ${run.judge.discharge.status}`,
    "",
    "## Per-sample evidence",
    "",
    ...run.results.map(row => `### ${row.model} / ${row.sampleId}\n\n- Status: ${row.status}; source hash: ${row.sourceHash}; summary hash: ${row.summaryHash}\n- Claims: ${row.claims.length}; source items: ${row.sourceInventory.items.length}\n- Scores: faithfulness ${pct(row.scores?.faithfulnessPercentage)}, coverage ${pct(row.scores?.coveragePercentage)}, decision ${pct(row.scores?.decisionFidelityPercentage)}, action ${pct(row.scores?.actionFidelityPercentage)}, relevance ${pct(row.scores?.relevancePercentage)}, conciseness ${pct(row.scores?.concisenessPercentage)}\n- Unsupported: ${row.scores?.unsupportedClaimCount ?? "-"}; contradictions: ${row.scores?.contradictionCount ?? "-"}\n- Evidence: ${JSON.stringify(row.claimEvidence ?? [])}\n- Summary: ${row.summary ?? "[unavailable]"}`),
    "",
    "## Provenance",
    "",
    `- Generation prompt hash: ${run.promptHash}`,
    `- Judge prompt version: ${run.judge.promptVersion}`,
    `- Judge model digest: ${run.judge.digest ?? "unknown"}`,
    `- Source/reference separation: ${run.judge.referenceHidden ? "reference hidden from judge" : "invalid"}`,
    ""
  ];
  return lines.join("\n");
}

function pct(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${Number(value).toFixed(1)}%`; }
function num(value, digits = 2) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : Number(value).toFixed(digits); }

function renderCsv(run) {
  const headers = ["model", "sample_id", "status", "faithfulness_percentage", "coverage_percentage", "decision_fidelity_percentage", "action_fidelity_percentage", "relevance_percentage", "conciseness_percentage", "unsupported_claims", "contradictions", "evidence_coverage_percentage", "generation_latency_ms", "generation_tokens_per_second", "judge_status", "source_hash", "summary_hash", "error"];
  const rows = [headers.join(",")];
  for (const row of run.results) rows.push([row.model, row.sampleId, row.status, row.scores?.faithfulnessPercentage, row.scores?.coveragePercentage, row.scores?.decisionFidelityPercentage, row.scores?.actionFidelityPercentage, row.scores?.relevancePercentage, row.scores?.concisenessPercentage, row.scores?.unsupportedClaimCount, row.scores?.contradictionCount, row.scores?.evidenceCoveragePercentage, row.generation?.timing?.totalElapsedMs, row.generation?.timing?.generationTokensPerSecond, row.judgeStatus, row.sourceHash, row.summaryHash, row.error].map(csv).join(","));
  return `${rows.join("\n")}\n`;
}

function renderHtml(run) {
  const escape = value => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(run.runId)}</title><style>body{font-family:system-ui;max-width:1400px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;vertical-align:top}pre{white-space:pre-wrap;max-height:18rem;overflow:auto}</style></head><body><h1>${escape(run.runId)}</h1><p>Transcript-grounded, judge-estimated, provisional. ROUGE is excluded.</p><table><thead><tr><th>Model</th><th>Sample</th><th>Summary</th><th>Scores</th><th>Claim evidence</th><th>Judge evidence</th></tr></thead><tbody>${run.results.map(row => `<tr><td>${escape(row.model)}</td><td>${escape(row.sampleId)}</td><td><pre>${escape(row.summary)}</pre></td><td>${escape(JSON.stringify(row.scores))}</td><td><pre>${escape(JSON.stringify(row.claimEvidence))}</pre></td><td><pre>${escape(JSON.stringify(row.judgePasses))}</pre></td></tr>`).join("")}</tbody></table></body></html>`;
}

async function readRows(filepath) {
  try { return (await fs.readFile(filepath, "utf8")).split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function writeRows(filepath, rows) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

async function fetchJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, options);
  if (!response.ok) { const error = new Error(`Ollama preflight failed: ${response.status} ${response.statusText ?? ""}`); error.status = response.status; throw error; }
  return response.json();
}

export async function preflightOllama({ baseUrl, models, sample, fetchImpl = globalThis.fetch } = {}) {
  const base = resolveOllamaBaseUrl(baseUrl);
  const startedAt = new Date().toISOString();
  const result = { status: "ok", baseUrl: base, startedAt, version: null, models: [], requests: [] };
  try {
    result.version = await fetchJson(`${base}/api/version`, {}, fetchImpl);
    const tags = await fetchJson(`${base}/api/tags`, {}, fetchImpl);
    const available = new Map((tags.models ?? []).map(model => [model.name, model]));
    result.models = models.map(model => ({ requestedModel: model, available: available.has(model), digest: available.get(model)?.digest ?? null }));
    for (const model of models) {
      if (!available.has(model)) throw new Error(`requested Ollama model unavailable: ${model}`);
      for (const [kind, prompt] of [["warmup", "Reply with exactly OK."], ["meeting", `${MEETINGBANK_FACTUALITY_PROMPT}\n\nTRANSCRIPT:\n${sample.input}`]]) {
        try {
          const response = await runOllamaChat({ model, prompt, profile: "summary_direct", contextLength: 32768, baseUrl: base, fetchImpl, requestTimeoutMs: 180000, maxRetries: 2 });
          result.requests.push({ model, kind, status: "ok", timing: response.timing, request: response.request });
        } catch (error) {
          result.requests.push({ model, kind, status: isTransientOllamaError(error) ? "transient-error" : "error", error: text(error?.message ?? error), request: error?.request ?? null });
          throw error;
        }
      }
    }
  } catch (error) {
    result.status = "failed";
    result.error = text(error?.message ?? error);
  }
  return result;
}

async function reliableExecutor({ input, baseUrl, fetchImpl }) {
  return runOllamaChat({ ...input, baseUrl, fetchImpl, requestTimeoutMs: 180000, maxRetries: 3, retryBaseMs: 1000 });
}

function scoreFromPass(pass, responseId = null) {
  const item = pass?.normalized?.evaluations?.find(entry => String(entry.responseId) === String(responseId)) ?? pass?.normalized?.evaluations?.[0];
  return item ?? null;
}

export async function runMeetingBankFactualityPilot({
  root = process.cwd(), datasetPath, split = "test", runId = MEETINGBANK_FACTUALITY_RUN_ID,
  models = MEETINGBANK_FACTUALITY_MODELS, selectionSeed = MEETINGBANK_FACTUALITY_SELECTION_SEED,
  selectionCount = 10, baseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? "http://mriczo:11434",
  gpuHousekeeperUrl = process.env.PYA_GPU_HOUSEKEEPER_URL ?? null, gpuId = process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0",
  resume = false, smoke = false, fetchImpl = globalThis.fetch, generationRunner = null, judgeExecutor = null,
  now = () => new Date()
} = {}) {
  if (!datasetPath) throw new Error("MeetingBank factuality pilot requires --dataset <meetingbank test file>");
  const id = String(runId);
  const loaded = await loadSuiteSamples({ benchmark: "meetingbank", datasetPath, split });
  const selection = selectMeetingBankJudgePilotSamples(loaded.samples, { count: smoke ? Math.min(5, selectionCount) : selectionCount, seed: selectionSeed });
  if (!selection.length) throw new Error("MeetingBank factuality pilot selected no samples");
  const ollama = await preflightOllama({ baseUrl, models, sample: selection[0], fetchImpl });
  if (ollama.status !== "ok") throw new Error(`Ollama preflight failed: ${ollama.error}`);
  const availability = new Map(ollama.models.map(item => [item.requestedModel, item]));
  const generationRunId = `${id}-generation`;
  const metadataProvider = async ({ model }) => ({ ...(await readOllamaMetadata({ model, baseUrl: ollama.baseUrl, fetchImpl })), requestedModel: model, resolvedModel: model });
  const generationExecutor = input => reliableExecutor({ input: { ...input, model: input.model }, baseUrl: ollama.baseUrl, fetchImpl });
  const generation = generationRunner ? await generationRunner({ id: generationRunId, samples: selection, models, resume }) : await runCriterion({
    benchmark: "meetingbank", datasetPath, split, sampleIds: selection.map(sample => sample.id), models, profile: "summary_direct", contextLength: 32768,
    runId: generationRunId, root, resume, engine: "ollama", executor: generationExecutor, metadataProvider,
    promptTransform: sample => `${MEETINGBANK_FACTUALITY_PROMPT}\n\nTRANSCRIPT:\n${sample.input}`,
    promptVariant: "summary_meetingbank_factuality", promptTemplateHash: MEETINGBANK_FACTUALITY_PROMPT_HASH, recordPrompt: true,
    replayCommand: `node command/criterion.mjs meetingbank-factuality-pilot --dataset ${datasetPath} --run-id ${id} --resume`
  });
  const checkpointPath = path.resolve(root, "criterion", "results", `${id}.jsonl`);
  const prior = resume ? await readRows(checkpointPath) : [];
  const rows = new Map(prior.map(row => [row.identity, row]));
  const generationRows = generation.results ?? [];
  const judge = { modelId: UNIRRM_FACTUALITY_MODEL, name: UNIRRM_FACTUALITY_NAME, promptVersion: UNIRRM_FACTUALITY_PROMPT_VERSION, temperature: 0, maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS, referenceHidden: true, discharge: { status: "pending" } };
  let adapter = null;
  const executor = judgeExecutor ?? (adapter = await createHuggingFaceJudgeExecutor({ model: UNIRRM_FACTUALITY_MODEL, root, runId: id, housekeeperUrl: gpuHousekeeperUrl, gpuId, generation: { maxInputTokens: 8192, maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS, minOutputTokens: 1, numBeams: 1, doSample: false, enableThinking: false, repetitionPenalty: 1.05 }, dischargeOnClose: true })).executor;
  try {
    for (const model of models) for (const sample of selection) {
      const generationRow = generationRows.find(row => row.model === model && String(row.sampleId) === String(sample.id) && row.status === "ok");
      const identity = `${model}\u0000${sample.id}`;
      if (rows.get(identity)?.status === "ok") continue;
      if (!generationRow) {
        rows.set(identity, { runId: id, identity, model, sampleId: sample.id, status: "generation-error", summary: "", sourceHash: sha256(sample.input), summaryHash: sha256(""), error: "generation row unavailable", claims: [], sourceInventory: buildSourceInventory(sample.input), judgeStatus: "not-run" });
        await writeRows(checkpointPath, [...rows.values()]);
        continue;
      }
      const inventory = buildSourceInventory(sample.input);
      const extraction = extractCandidateClaims(generationRow.output);
      const claims = extraction.claims.map(claim => ({ ...claim, evidence: retrieveTranscriptEvidence(claim, inventory.turns) }));
      const faithEntries = claims.map((claim, index) => ({ index: index + 1, id: claim.claimId, text: `${claim.text}\nEVIDENCE CANDIDATES: ${claim.evidence.turns.map(turn => `[${turn.turnId}] ${turn.quote}`).join(" | ") || "none"}` }));
      const sourceEntries = inventory.items.map((item, index) => ({ index: index + 1, id: item.itemId, text: `${item.text}\nEVIDENCE: ${item.sourceTurnIds.map(id => `[${id}]`).join(" ")}` }));
      const passes = {};
      passes.faithfulness = await judgePass({ executor, sample, identity: `${identity}\u0000faithfulness`, stage: "faithfulness", prompt: nativePrompt({ stage: "faithfulness", transcript: sample.input, summary: generationRow.output, entries: faithEntries }), responseIds: claims.map(claim => claim.claimId) });
      passes.coverage = await judgePass({ executor, sample, identity: `${identity}\u0000coverage`, stage: "source coverage", prompt: nativePrompt({ stage: "source coverage", transcript: sample.input, summary: generationRow.output, entries: sourceEntries }), responseIds: inventory.items.map(item => item.itemId), coverage: true });
      passes.relevance = await judgePass({ executor, sample, identity: `${identity}\u0000relevance`, stage: "relevance", prompt: nativePrompt({ stage: "relevance", transcript: sample.input, summary: generationRow.output, entries: [{ index: 1, id: "summary", text: generationRow.output }] }), responseIds: ["summary"] });
      passes.conciseness = await judgePass({ executor, sample, identity: `${identity}\u0000conciseness`, stage: "conciseness", prompt: nativePrompt({ stage: "conciseness", transcript: sample.input, summary: generationRow.output, entries: [{ index: 1, id: "summary", text: generationRow.output }] }), responseIds: ["summary"] });
      const faithResults = passes.faithfulness.normalized?.evaluations ?? [];
      const coverageResults = passes.coverage.normalized?.evaluations ?? [];
      const claimEvidence = claims.map(claim => ({ ...claim, judge: faithResults.find(result => result.responseId === claim.claimId) ?? null }));
      const coverageItems = inventory.items.map(item => ({ ...item, judge: coverageResults.find(result => result.responseId === item.itemId) ?? null, classification: coverageResults.find(result => result.responseId === item.itemId)?.classification ?? "unclear" }));
      const faithClasses = claimEvidence.map(item => item.judge?.classification).filter(Boolean);
      const decisionItems = coverageItems.filter(item => ["decision", "motion", "vote"].includes(item.itemType));
      const actionItems = coverageItems.filter(item => ["action-item", "responsible-party"].includes(item.itemType));
      const judgeStatuses = Object.values(passes).map(pass => pass.status);
      const complete = judgeStatuses.every(status => status === "ok") && claimEvidence.length > 0 && coverageItems.length > 0;
      const row = {
        runId: id, identity, model, sampleId: sample.id, status: complete ? "ok" : "incomplete", judgeStatus: complete ? "complete" : "incomplete",
        meetingMetadata: sample.metadata ?? {}, sourceHash: sha256(sample.input), summary: generationRow.output, summaryHash: generationRow.outputHash ?? sha256(generationRow.output),
        referenceHiddenFromJudge: true, claims: extraction.claims, claimEvidence, sourceInventory: { ...inventory, items: coverageItems },
        scores: {
          faithfulnessPercentage: weightedFaithfulness(faithClasses.map(classificationValue => ({ classification: classificationValue }))),
          coveragePercentage: coveragePercentage(coverageItems.map(item => ({ classification: item.classification }))),
          decisionFidelityPercentage: subsetCoverage(coverageItems.map(item => ({ ...item, classification: item.classification })), ["decision", "motion", "vote"]),
          actionFidelityPercentage: subsetCoverage(coverageItems.map(item => ({ ...item, classification: item.classification })), ["action-item", "responsible-party"]),
          relevancePercentage: scoreFromPass(passes.relevance, "summary")?.percentage ?? null,
          concisenessPercentage: scoreFromPass(passes.conciseness, "summary")?.percentage ?? null,
          unsupportedClaimCount: faithClasses.filter(value => value === "unsupported").length,
          contradictionCount: faithClasses.filter(value => value === "contradicted").length,
          unclearClaimCount: faithClasses.filter(value => value === "unclear").length,
          evidenceCoveragePercentage: claims.length ? claims.filter(claim => claim.evidence.turns.length).length / claims.length * 100 : null
        },
        generation: { status: generationRow.status, outputHash: generationRow.outputHash, timing: generationRow.metrics ?? {}, modelMetadata: generationRow.modelMetadata ?? null },
        judgePasses: Object.fromEntries(Object.entries(passes).map(([key, pass]) => [key, { status: pass.status, attempts: pass.attempts, timing: pass.timing, rawResponse: pass.rawResponse ?? "", normalized: pass.normalized ?? null, error: pass.error ?? null }])),
        provenance: { datasetHash: loaded.datasetHash, split: loaded.actualSplit, sampleId: sample.id, sourceHash: sha256(sample.input), generationRunId, generationPromptHash: MEETINGBANK_FACTUALITY_PROMPT_HASH, judgeModel: UNIRRM_FACTUALITY_MODEL, judgePromptVersion: UNIRRM_FACTUALITY_PROMPT_VERSION },
        error: complete ? null : judgeStatuses.map((status, index) => status === "ok" ? null : ["faithfulness", "coverage", "relevance", "conciseness"][index]).filter(Boolean).join(", ") || "judge evidence incomplete",
        finishedAt: now().toISOString()
      };
      rows.set(identity, row);
      await writeRows(checkpointPath, [...rows.values()]);
    }
  } finally {
    if (adapter) {
      try { const discharge = await adapter.close(); judge.discharge = discharge?.success === false && !discharge?.skipped ? { status: "failed", detail: discharge } : { status: "completed", detail: discharge }; }
      catch (error) { judge.discharge = { status: "failed", error: text(error?.message ?? error) }; }
    } else judge.discharge = { status: "not-managed-by-adapter" };
  }
  const resultRows = [...rows.values()];
  const aggregates = models.map(model => ({ model, aggregate: aggregateRows(resultRows.filter(row => row.model === model)) }));
  const finalRun = await writeRunArtifacts({
    runId: id, criterion: "meetingbank-factuality-pilot", evaluationMode: MEETINGBANK_FACTUALITY_MODE, suite: { key: "meetingbank-factuality-pilot", name: "MeetingBank transcript-grounded factuality pilot", version: "factuality-v2", sourceUrls: ["https://meetingbank.github.io/dataset/", "https://huggingface.co/SUSTech-NLP/UniRRM-8B", "https://arxiv.org/html/2609.05910v1"], licenseUrls: ["https://meetingbank.github.io/license/"] },
    status: resultRows.some(row => row.status !== "ok") ? "partial" : "completed", split, actualSplit: loaded.actualSplit, datasetPath, datasetHash: loaded.datasetHash, datasetRevision: process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned", models, engine: "ollama-plus-huggingface-judge", profile: "summary_direct", contextLength: 32768, promptHash: MEETINGBANK_FACTUALITY_PROMPT_HASH, generationPrompt: { name: "summary_meetingbank_factuality", hash: MEETINGBANK_FACTUALITY_PROMPT_HASH, text: MEETINGBANK_FACTUALITY_PROMPT }, generationRunId, selection: { seed: selectionSeed, count: selection.length, sampleIds: selection.map(sample => sample.id), datasetHash: loaded.datasetHash }, results: resultRows, aggregates,
    generationStats: { attempted: generationRows.length, successful: generationRows.filter(row => row.status === "ok").length, transientRetries: generationRows.reduce((sum, row) => sum + Number(row.metrics?.transportRetries ?? 0), 0), permanentFailures: generationRows.filter(row => row.status === "error").length },
    judgeStats: { attempted: resultRows.length, successful: resultRows.filter(row => row.status === "ok").length, malformed: resultRows.filter(row => Object.values(row.judgePasses ?? {}).some(pass => pass.status === "malformed-output")).length, transport: resultRows.filter(row => Object.values(row.judgePasses ?? {}).some(pass => pass.status === "transport-error")).length, incomplete: resultRows.filter(row => row.status !== "ok").length },
    ollama: { ...ollama, preflight: ollama }, judge: { ...judge, revision: null, digest: null, referenceHidden: true }, machine: await collectMachineMetadata(), smoke, runScope: smoke ? "smoke" : "pilot", createdAt: now().toISOString(), startedAt: now().toISOString(), finishedAt: now().toISOString(), totalWallClockMs: 0, replayCommand: `node command/criterion.mjs meetingbank-factuality-pilot --dataset ${datasetPath} --run-id ${id} --resume`
  }, { root, checkpointResults: resultRows, renderMarkdown, renderCsv, renderHtml });
  return finalRun;
}

function classificationValue(value) { return value; }
