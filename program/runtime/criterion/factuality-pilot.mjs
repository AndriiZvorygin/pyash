import fs from "node:fs/promises";
import path from "node:path";

import { collectMachineMetadata } from "./machine.mjs";
import { loadSuiteSamples } from "./datasets.mjs";
import { createHuggingFaceJudgeExecutor } from "./huggingface.mjs";
import { isTransientOllamaError, readOllamaMetadata, resolveOllamaBaseUrl, runOllamaChat } from "./ollama.mjs";
import { runCriterion } from "./run.mjs";
import { writeRunArtifacts } from "./report.mjs";
import { mean, parseJsonOutput, sha256, stripThinking, tokenize } from "./metrics.mjs";
import { parseUniRrmOutput, selectMeetingBankJudgePilotSamples, UNIRRM_SYSTEM_PROMPT } from "./judge-pilot.mjs";

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
export const UNIRRM_FACTUALITY_HF_MODEL = "SUSTech-NLP/UniRRM-8B";
export const UNIRRM_FACTUALITY_MODEL = "hf.co/mradermacher/UniRRM-8B-GGUF:Q4_K_M";
export const UNIRRM_FACTUALITY_NAME = "judge:unirrm-8b";
export const UNIRRM_FACTUALITY_PROMPT_VERSION = "meetingbank-transcript-grounded-single-request-v3";

const CLAIM_LIMIT = 12;
const PROMPT_CLAIM_LIMIT = 6;
const JUDGE_MAX_OUTPUT_TOKENS = Number(process.env.PYA_CRITERION_FACTUALITY_JUDGE_MAX_OUTPUT_TOKENS || 2048);
const JUDGE_CONTEXT_LENGTH = Number(process.env.PYA_CRITERION_FACTUALITY_JUDGE_CONTEXT_LENGTH || 16384);
const DIMENSIONS = Object.freeze([
  ["faithfulnessPercentage", ["faithfulness_score", "faithfulnessScore", "faithfulness"]],
  ["completenessPercentage", ["completeness_score", "completenessScore", "completeness"]],
  ["decisionActionPercentage", ["decision_action_score", "decisionActionScore", "decision_action_coverage_score", "decisionActionCoverageScore"]],
  ["relevancePercentage", ["relevance_score", "relevanceScore", "relevance"]],
  ["concisenessPercentage", ["conciseness_score", "concisenessScore", "conciseness"]],
  ["publicationSuitabilityPercentage", ["publication_suitability_score", "publicationSuitabilityScore", "municipal_summary_suitability_score", "municipalSummarySuitabilityScore", "publication_suitability"]]
]);

function text(value) { return String(value ?? "").trim(); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function csv(value) { const result = value === null || value === undefined ? "" : String(value); return /[",\n]/u.test(result) ? `"${result.replace(/"/gu, '""')}"` : result; }
function pct(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : `${Number(value).toFixed(1)}%`; }
function num(value, digits = 2) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? "-" : Number(value).toFixed(digits); }

function scorePercentage(value) {
  const score = finite(value);
  if (score === null) return null;
  if (score >= 1 && score <= 5) return ((score - 1) / 4) * 100;
  return score >= 0 && score <= 1 ? score * 100 : null;
}

function sentenceParts(value) {
  return String(value ?? "").replace(/\r/gu, "").split(/(?<=[.!?])\s+|\n+/u).map(item => item.trim()).filter(item => item.length >= 12);
}

function sourceTurns(transcript) {
  const lines = String(transcript ?? "").split(/\r?\n/u).filter(line => line.trim());
  const turns = [];
  for (const line of lines.length ? lines : [String(transcript ?? "")]) {
    const match = line.match(/^\s*(?:\[([^\]]+)\]\s*)?([^:]{1,80}):\s*(.*)$/u);
    const speaker = match?.[2]?.trim() || null;
    const timestamp = match?.[1] || null;
    const body = match?.[3] || line;
    for (const sentence of sentenceParts(body)) turns.push({ turnId: `turn-${turns.length + 1}`, sentenceId: `source-${turns.length + 1}`, text: sentence, speaker, timestamp });
  }
  return turns.length ? turns : sentenceParts(transcript).map((sentence, index) => ({ turnId: `turn-${index + 1}`, sentenceId: `source-${index + 1}`, text: sentence, speaker: null, timestamp: null }));
}

function terms(value) { return unique(tokenize(value).filter(token => token.length > 2)); }

function claimType(value) {
  const lower = text(value).toLowerCase();
  if (/\b(motion|moved|seconded|resolution|ordinance)\b/u.test(lower)) return "motion";
  if (/\b(vote|voted|ayes?|nay|unanim|passes?|approved|rejected|denied|adopted)\b/u.test(lower)) return "vote";
  if (/\b(action|directed|will prepare|must|shall|assigned|staff should|follow[- ]?up|next step)\b/u.test(lower)) return "action-item";
  if (/\b(by|before|deadline|due|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/u.test(lower)) return "date-or-deadline";
  if (/\$?\d[\d,.]*|\b\d+(?:\.\d+)?%\b/u.test(lower)) return "financial-or-number";
  if (/\b(councilmember|mayor|chair|director|manager|department|staff|spoke|said|reported)\b/u.test(lower)) return "attribution";
  if (/\b(discussed|discussion|concern|question|comment|requested|presented|reviewed)\b/u.test(lower)) return "discussion";
  if (/\b(agenda|topic|meeting|hearing|item|project|issue)\b/u.test(lower)) return "topic";
  return "other";
}

export function extractCandidateClaims(summary, { limit = CLAIM_LIMIT } = {}) {
  const claims = sentenceParts(summary).slice(0, Math.max(1, limit)).map((claim, index) => ({
    claimId: `claim-${index + 1}`,
    sentenceId: `summary-${index + 1}`,
    text: claim,
    claimType: claimType(claim),
    importance: /\b(motion|vote|approved|rejected|decision|action|deadline|due|amount|resolution|ordinance)\b/iu.test(claim) ? "high" : "material",
    namedEntities: unique(claim.match(/\b[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3}/gu) ?? []),
    numbersAndDates: unique(claim.match(/\$?\d[\d,.]*(?:%|\b)|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gu) ?? [])
  }));
  return { status: claims.length ? "ok" : "empty", parser: "deterministic-sentence-claims-v1", raw: summary, claims };
}

export function retrieveTranscriptEvidence(claim, turns, { limit = 3 } = {}) {
  const claimTerms = new Set(terms(claim.text));
  const ranked = turns.map(turn => {
    const overlap = terms(turn.text).filter(token => claimTerms.has(token));
    return { ...turn, score: overlap.length / Math.max(1, claimTerms.size) };
  }).filter(turn => turn.score > 0).sort((left, right) => right.score - left.score || left.turnId.localeCompare(right.turnId)).slice(0, limit);
  return { method: "lexical-overlap-v1", evidenceHash: sha256(ranked.map(item => `${item.turnId}:${item.text}`).join("\n")), turns: ranked.map(item => ({ turnId: item.turnId, sentenceId: item.sentenceId, quote: item.text, speaker: item.speaker, timestamp: item.timestamp, retrievalScore: item.score })) };
}

export function buildSourceInventory(transcript, { limit = CLAIM_LIMIT } = {}) {
  const turns = sourceTurns(transcript);
  const items = turns.slice(0, Math.max(1, limit)).map((turn, index) => ({ itemId: `source-item-${index + 1}`, sourceTurnIds: [turn.turnId], text: turn.text, itemType: claimType(turn.text), importance: index < 12 ? "material" : "low" }));
  return { status: items.length ? "ok" : "empty", parser: "deterministic-source-turn-inventory-v1", turns, items };
}

function nestedValue(objects, keys) {
  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of keys) if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

function normalizeStatus(value) {
  return { partially_supported: "partially-supported", partiallySupported: "partially-supported" }[value] ?? value;
}

function parseClaims(value, explanation) {
  let claims = Array.isArray(value) ? value : [];
  if (!claims.length) {
    const marker = text(explanation).match(/CLAIMS_JSON\s*[:=]\s*(\[[\s\S]*\])/iu)?.[1];
    if (marker) claims = parseJsonOutput(marker).value ?? [];
  }
  return claims.slice(0, CLAIM_LIMIT).map((claim, index) => ({
    claimId: text(claim.claimId ?? claim.id) || `claim-${index + 1}`,
    claim: text(claim.claim ?? claim.text),
    claimType: text(claim.claimType ?? claim.type) || claimType(claim.claim ?? claim.text),
    status: normalizeStatus(text(claim.status).toLowerCase()) || "unclear",
    importance: text(claim.importance).toLowerCase() || "material",
    evidence: text(claim.evidence ?? claim.quote),
    transcriptTurnIds: unique((Array.isArray(claim.transcript_turn_ids) ? claim.transcript_turn_ids : Array.isArray(claim.transcriptTurnIds) ? claim.transcriptTurnIds : []).map(String)),
    explanation: text(claim.explanation)
  }));
}

function parseCriterionPayload(explanation) {
  const source = text(explanation);
  const candidates = [source, source.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1], source.match(/(?:CRITERION_JSON|EVALUATION_JSON)\s*[:=]\s*([\s\S]+)/iu)?.[1]];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = parseJsonOutput(candidate).value;
    if (parsed && typeof parsed === "object" && (parsed.faithfulness_score !== undefined || parsed.claims !== undefined)) return parsed;
  }
  return {};
}

function dimensionValue(objects, keys, explanation) {
  const direct = nestedValue(objects, keys);
  if (direct !== null) return finite(direct);
  const escaped = keys.map(key => key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  return finite(text(explanation).match(new RegExp(`(?:${escaped})\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "iu"))?.[1]);
}

export function normalizeNativeJudgeResponse(raw, { maxClaims = CLAIM_LIMIT } = {}) {
  const parsed = parseUniRrmOutput(raw);
  if (!parsed.valid) return { status: /(?:unfinished|truncated|maximum|length)/iu.test(text(parsed.error)) ? "truncated-output" : "malformed-output", parsed: null, error: parsed.error, claims: [] };
  const native = parsed.value;
  const evaluation = Array.isArray(native.evaluations) ? (native.evaluations[0] ?? {}) : {};
  const explanation = text(evaluation.explanation ?? native.Analysis_process ?? native.reasoning);
  const criterion = evaluation.criterion ?? native.criterion ?? parseCriterionPayload(explanation);
  const objects = [criterion, evaluation, native];
  const claims = parseClaims(criterion.claims ?? native.claims ?? evaluation.claims, explanation).slice(0, maxClaims);
  const scores = Object.fromEntries(DIMENSIONS.map(([name, keys]) => [name, scorePercentage(dimensionValue(objects, keys, explanation))]));
  const confidence = finite(nestedValue(objects, ["confidence"]) ?? text(explanation).match(/CONFIDENCE\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/iu)?.[1]);
  const omitted = nestedValue(objects, ["omitted_important_items", "omittedImportantItems"]) ?? [];
  const evidenceCount = claims.filter(claim => claim.evidence || claim.transcriptTurnIds.length).length;
  const complete = Boolean(Array.isArray(native.evaluations) && native.evaluations.length && claims.length && Object.values(scores).every(value => value !== null) && evidenceCount > 0);
  return { status: complete ? "ok" : "incomplete", parsed: native, error: complete ? null : "native response omitted required dimensions, claims, or transcript evidence", nativeScore: finite(evaluation.final_score ?? evaluation.finalScore ?? native.final_score), scores, confidence, claims, omittedImportantItems: Array.isArray(omitted) ? omitted : [], finalVerdict: text(native.final_verdict ?? native.finalVerdict ?? native.best_id ?? evaluation.verdict), reasoning: text(criterion.reasoning ?? native.reasoning ?? native.Analysis_process), explanation, evidenceCount };
}

function nativePrompt({ transcript, summary, sourceTurnsForPrompt, previousRaw = "" }) {
  const source = sourceTurnsForPrompt.map(turn => `[${turn.turnId}] ${turn.speaker ? `${turn.speaker}: ` : ""}${turn.text}`).join("\n");
  const task = "Evaluate one municipal meeting summary using only the transcript. The reference summary is withheld. Assess factuality and practical publication usefulness, not wording similarity.";
  const contract = `Use the native UniRRM outer JSON format: {"Analysis_process":"...","rubrics":[...],"evaluations":[{"response_id":"Response1","explanation":"...","final_score":1}],"best_id":"Response1"}. Keep that outer format. Put the Criterion evaluation as one compact JSON object encoded inside the evaluations[0].explanation string, not as prose and not as a new top-level format. The encoded object must have exactly these fields: faithfulness_score, completeness_score, decision_action_score, relevance_score, conciseness_score, publication_suitability_score, confidence, claims, omitted_important_items, reasoning, final_verdict. Each score is 1-5. Each claims entry must have claim, status (supported|partially_supported|unsupported|contradicted|unclear), importance, evidence, transcript_turn_ids, explanation. Include evidence for every material claim. Keep rubrics to names only, use at most ${PROMPT_CLAIM_LIMIT} material claims, use one short evidence quote and a brief explanation per claim, and return JSON only.`;
  const prompt = [`<User_Input>\n${task}\n\n${contract}\n\nSOURCE TRANSCRIPT WITH STABLE TURN IDS:\n${source}\n</User_Input>`, `<Response1>\n${summary}\n</Response1>`, `Use at most ${PROMPT_CLAIM_LIMIT} material claims. Keep every string concise; do not repeat the transcript or rubric descriptions.`];
  if (previousRaw) prompt.push(`Repair the previous response into valid native JSON without dropping criterion fields:\n${previousRaw.slice(0, 30000)}`);
  return prompt.join("\n\n");
}

function judgeErrorStatus(error) { return isTransientOllamaError(error) ? "transport-error" : "model-error"; }

async function judgeSummary({ executor, model = UNIRRM_FACTUALITY_MODEL, sample, summary, identity, maxRepair = 1, maxOutputTokens = JUDGE_MAX_OUTPUT_TOKENS }) {
  const turns = sourceTurns(sample.input);
  const prompt = nativePrompt({ transcript: sample.input, summary, sourceTurnsForPrompt: turns });
  const attempts = [];
  for (let attempt = 0; attempt <= maxRepair; attempt += 1) {
    const requestPrompt = attempt ? nativePrompt({ transcript: sample.input, summary, sourceTurnsForPrompt: turns, previousRaw: attempts.at(-1)?.raw }) : prompt;
    try {
      const response = await executor({ model, prompt: requestPrompt, messages: [{ role: "system", content: UNIRRM_SYSTEM_PROMPT }, { role: "user", content: requestPrompt }], sample, identity: attempt ? `${identity}:repair` : identity, operation: "judge" });
      const raw = String(response?.text ?? "");
      const metadata = response?.metadata ?? {};
      const normalized = normalizeNativeJudgeResponse(stripThinking(raw));
      const outputLimitReached = Boolean(metadata.truncated) || Number(metadata.outputTokens) >= maxOutputTokens;
      const status = outputLimitReached && normalized.status !== "ok" ? "truncated-output" : normalized.status;
      attempts.push({ attempt: attempt + 1, raw, status, parseError: normalized.error, responseHash: sha256(raw), timing: response?.timing ?? null, outputTokens: metadata.outputTokens ?? null });
      if (status === "ok") return { status, normalized, rawResponse: raw, attempts, repairRetries: attempt, timing: response?.timing ?? {}, metadata: response?.metadata ?? null };
    } catch (error) {
      attempts.push({ attempt: attempt + 1, raw: "", status: judgeErrorStatus(error), error: text(error?.message ?? error) });
      return { status: attempts.at(-1).status, normalized: null, rawResponse: "", attempts, repairRetries: attempt, error: text(error?.message ?? error), timing: {}, metadata: null };
    }
  }
  return { status: attempts.at(-1)?.status === "truncated-output" ? "truncated-output" : "malformed-output", normalized: null, rawResponse: attempts.at(-1)?.raw ?? "", attempts, repairRetries: maxRepair, error: "native response remained incomplete after one repair retry", timing: {}, metadata: null };
}

function claimMetrics(claims) {
  const counts = { supported: 0, "partially-supported": 0, unsupported: 0, contradicted: 0, unclear: 0 };
  for (const claim of claims) counts[claim.status] = (counts[claim.status] ?? 0) + 1;
  const total = claims.length;
  return { ...counts, total, faithfulnessPercentage: total ? (counts.supported + counts["partially-supported"] * 0.5) / total * 100 : null, evidenceCoveragePercentage: total ? claims.filter(claim => claim.evidence || claim.transcriptTurnIds.length).length / total * 100 : null };
}

function aggregateRows(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const average = key => mean(successful.map(row => finite(row.scores?.[key])).filter(value => value !== null));
  return { sampleCount: rows.length, successfulCount: successful.length, failureCount: rows.filter(row => row.status !== "ok").length, faithfulnessPercentage: average("faithfulnessPercentage"), completenessPercentage: average("completenessPercentage"), decisionActionPercentage: average("decisionActionPercentage"), relevancePercentage: average("relevancePercentage"), concisenessPercentage: average("concisenessPercentage"), publicationSuitabilityPercentage: average("publicationSuitabilityPercentage"), unsupportedClaimCount: successful.reduce((sum, row) => sum + (row.scores?.unsupportedClaimCount ?? 0), 0), contradictionCount: successful.reduce((sum, row) => sum + (row.scores?.contradictionCount ?? 0), 0), averageLatencyMs: mean(successful.map(row => finite(row.generation?.timing?.totalElapsedMs)).filter(value => value !== null)), generationTokensPerSecond: mean(successful.map(row => finite(row.generation?.timing?.generationTokensPerSecond)).filter(value => value !== null)) };
}

function renderMarkdown(run) {
  const lines = [
    `# MeetingBank factuality pilot: ${run.runId}`, "", `- Status: ${run.status}
- Evaluation: transcript-grounded, judge-estimated, provisional
- Dataset: ${run.actualSplit}; hash ${run.datasetHash}
- Selection seed: ${run.selection.seed}
- Sample IDs: ${run.selection.sampleIds.join(", ")}
- Judge: ${run.judge.modelId} (${run.judge.revision ?? "unknown revision"})
- Judge requests: one initial request per successful summary; one bounded repair retry`, "",
    "ROUGE is intentionally excluded. Earlier ROUGE reports remain historical reference-similarity artifacts.", "", "## Factuality comparison", "",
    "| Model | Faithfulness | Completeness | Decision/action fidelity | Relevance | Conciseness | Unsupported claims | Contradictions | Judge success | Avg latency | Gen tok/s |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...run.aggregates.map(row => `| ${row.model} | ${pct(row.aggregate.faithfulnessPercentage)} | ${pct(row.aggregate.completenessPercentage)} | ${pct(row.aggregate.decisionActionPercentage)} | ${pct(row.aggregate.relevancePercentage)} | ${pct(row.aggregate.concisenessPercentage)} | ${row.aggregate.unsupportedClaimCount} | ${row.aggregate.contradictionCount} | ${row.aggregate.successfulCount}/${row.aggregate.sampleCount} | ${num(row.aggregate.averageLatencyMs, 1)} | ${num(row.aggregate.generationTokensPerSecond, 1)} |`), "",
    "No overall winner is declared; these judge-estimated dimensions are provisional until human-labelled calibration.", "", "## Operational evidence", "",
    `- Generation: ${run.generationStats.successful}/${run.generationStats.attempted} successful; transient retries ${run.generationStats.transientRetries}; permanent failures ${run.generationStats.permanentFailures}`,
    `- Judge requests: ${run.judgeStats.initialRequests} initial; repair retries ${run.judgeStats.repairRetries}; successful ${run.judgeStats.successful}; malformed ${run.judgeStats.malformed}; truncated ${run.judgeStats.truncated}; transport ${run.judgeStats.transport}; incomplete ${run.judgeStats.incomplete}`,
    `- Ollama endpoint: ${run.ollama.baseUrl}; preflight ${run.ollama.preflight.status}; Qwen discharge before judging ${run.ollama.discharge?.preJudge?.verified ? "verified" : run.ollama.discharge?.preJudge?.status ?? "not-recorded"}`, `- UniRRM discharge: ${run.judge.discharge?.verified ? "verified" : run.judge.discharge?.status ?? "not-recorded"}`, "", "## Per-sample evidence", "",
    ...run.results.map(row => `### ${row.model} / ${row.sampleId}\n\n- Status: ${row.status}; source hash: ${row.sourceHash}; summary hash: ${row.summaryHash}\n- Scores: faithfulness ${pct(row.scores?.faithfulnessPercentage)} (${row.claimCounts?.total ?? 0} claims); completeness ${pct(row.scores?.completenessPercentage)}; decision/action ${pct(row.scores?.decisionActionPercentage)}; relevance ${pct(row.scores?.relevancePercentage)}; conciseness ${pct(row.scores?.concisenessPercentage)}; publication ${pct(row.scores?.publicationSuitabilityPercentage)}\n- Claim counts: supported ${row.claimCounts?.supported ?? 0}, partial ${row.claimCounts?.["partially-supported"] ?? 0}, unsupported ${row.claimCounts?.unsupported ?? 0}, contradicted ${row.claimCounts?.contradicted ?? 0}, unclear ${row.claimCounts?.unclear ?? 0}\n- Judge attempts: ${row.judge?.attempts?.length ?? 0}; evidence coverage ${pct(row.scores?.evidenceCoveragePercentage)}\n- Claims/evidence: ${JSON.stringify(row.claims ?? [])}\n- Summary: ${row.summary ?? "[unavailable]"}`), "", "## Provenance", "", `- Generation prompt hash: ${run.promptHash}`, `- Judge prompt version: ${run.judge.promptVersion}`, `- Judge model digest: ${run.judge.digest ?? "unknown"}`, `- Reference summary: ${run.judge.referenceHidden ? "hidden from judge" : "invalid"}`, ""
  ];
  return lines.join("\n");
}

function renderCsv(run) {
  const headers = ["model", "sample_id", "status", "faithfulness_percentage", "completeness_percentage", "decision_action_percentage", "relevance_percentage", "conciseness_percentage", "publication_suitability_percentage", "supported_claims", "partial_claims", "unsupported_claims", "contradictions", "unclear_claims", "judge_status", "judge_attempts", "repair_retries", "evidence_coverage_percentage", "generation_latency_ms", "generation_tokens_per_second", "source_hash", "summary_hash", "error"];
  const rows = [headers.join(",")];
  for (const row of run.results) rows.push([row.model, row.sampleId, row.status, row.scores?.faithfulnessPercentage, row.scores?.completenessPercentage, row.scores?.decisionActionPercentage, row.scores?.relevancePercentage, row.scores?.concisenessPercentage, row.scores?.publicationSuitabilityPercentage, row.claimCounts?.supported, row.claimCounts?.["partially-supported"], row.claimCounts?.unsupported, row.claimCounts?.contradicted, row.claimCounts?.unclear, row.judge?.status, row.judge?.attempts?.length, row.judge?.repairRetries, row.scores?.evidenceCoveragePercentage, row.generation?.timing?.totalElapsedMs, row.generation?.timing?.generationTokensPerSecond, row.sourceHash, row.summaryHash, row.error].map(csv).join(","));
  return `${rows.join("\n")}\n`;
}

function renderHtml(run) {
  const escape = value => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(run.runId)}</title><style>body{font-family:system-ui;max-width:1400px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;vertical-align:top}pre{white-space:pre-wrap;max-height:20rem;overflow:auto}</style></head><body><h1>${escape(run.runId)}</h1><p>Transcript-grounded, judge-estimated, provisional. ROUGE excluded.</p><table><thead><tr><th>Model</th><th>Sample</th><th>Scores</th><th>Claims and evidence</th><th>Raw judge attempts</th></tr></thead><tbody>${run.results.map(row => `<tr><td>${escape(row.model)}</td><td>${escape(row.sampleId)}</td><td><pre>${escape(JSON.stringify(row.scores))}</pre></td><td><pre>${escape(JSON.stringify(row.claims))}</pre></td><td><pre>${escape(JSON.stringify(row.judge?.attempts))}</pre></td></tr>`).join("")}</tbody></table></body></html>`;
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

export async function preflightOllamaModel({ baseUrl, model, sample, fetchImpl = globalThis.fetch } = {}) {
  const base = resolveOllamaBaseUrl(baseUrl);
  const result = { status: "ok", baseUrl: base, model, requests: [] };
  try {
    for (const [kind, prompt] of [["warmup", "Reply with exactly OK."], ["meeting", `${MEETINGBANK_FACTUALITY_PROMPT}\n\nTRANSCRIPT:\n${sample.input}`]]) {
      try {
        const response = await runOllamaChat({ model, prompt, profile: "summary_direct", contextLength: 32768, baseUrl: base, fetchImpl, requestTimeoutMs: 180000, maxRetries: 2 });
        result.requests.push({ model, kind, status: "ok", timing: response.timing, request: response.request });
      } catch (error) {
        result.requests.push({ model, kind, status: isTransientOllamaError(error) ? "transient-error" : "error", error: text(error?.message ?? error), request: error?.request ?? null });
        throw error;
      }
    }
  } catch (error) { result.status = "failed"; result.error = text(error?.message ?? error); }
  return result;
}

export async function preflightOllama({ baseUrl, models, sample, fetchImpl = globalThis.fetch, probeModels = true } = {}) {
  const base = resolveOllamaBaseUrl(baseUrl);
  const result = { status: "ok", baseUrl: base, startedAt: new Date().toISOString(), version: null, models: [], requests: [] };
  try {
    result.version = await fetchJson(`${base}/api/version`, {}, fetchImpl);
    const tags = await fetchJson(`${base}/api/tags`, {}, fetchImpl);
    const available = new Map((tags.models ?? []).map(model => [model.name, model]));
    result.models = models.map(model => ({ requestedModel: model, resolvedModel: available.has(model) ? model : null, available: available.has(model), digest: available.get(model)?.digest ?? null }));
    for (const model of models) {
      if (!available.has(model)) throw new Error(`requested Ollama model unavailable: ${model}`);
      if (probeModels) {
        const probe = await preflightOllamaModel({ baseUrl: base, model, sample, fetchImpl });
        result.requests.push(...probe.requests);
        if (probe.status !== "ok") throw new Error(probe.error);
      }
    }
  } catch (error) { result.status = "failed"; result.error = text(error?.message ?? error); }
  return result;
}

export async function dischargeOllamaModels({ baseUrl, models, fetchImpl = globalThis.fetch, verifyRelease = false, waitMs = 30000, pollMs = 250 } = {}) {
  const base = resolveOllamaBaseUrl(baseUrl);
  const results = [];
  for (const model of models) {
    try {
      const response = await fetchImpl(`${base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: 0 })
      });
      if (!response.ok) throw new Error(`Ollama discharge failed for ${model}: ${response.status}`);
      results.push({ model, status: "ok", requestedAt: new Date().toISOString() });
    } catch (error) {
      results.push({ model, status: "failed", error: text(error?.message ?? error) });
    }
  }
  if (!verifyRelease || results.some(result => result.status !== "ok")) {
    return { baseUrl: base, results, status: results.every(result => result.status === "ok") ? "ok" : "partial", verified: false };
  }
  const wanted = new Set(models.map(String));
  const deadline = Date.now() + Math.max(1, Number(waitMs) || 30000);
  let lastLoaded = [];
  while (Date.now() <= deadline) {
    try {
      const ps = await fetchJson(`${base}/api/ps`, {}, fetchImpl);
      lastLoaded = (ps.models ?? []).map(row => String(row.name ?? row.model ?? "")).filter(name => wanted.has(name));
      if (!lastLoaded.length) return { baseUrl: base, results, status: "ok", verified: true, verifiedAt: new Date().toISOString() };
    } catch (error) {
      return { baseUrl: base, results, status: "partial", verified: false, verificationError: text(error?.message ?? error) };
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Number(pollMs) || 250)));
  }
  return { baseUrl: base, results, status: "partial", verified: false, remainingModels: lastLoaded, verificationError: "Ollama models remained resident after discharge timeout" };
}

export function createOllamaFactualityJudge({ model = UNIRRM_FACTUALITY_MODEL, baseUrl, fetchImpl = globalThis.fetch, maxOutputTokens = JUDGE_MAX_OUTPUT_TOKENS, contextLength = JUDGE_CONTEXT_LENGTH } = {}) {
  return async ({ prompt }) => {
    const response = await runOllamaChat({
      model,
      baseUrl,
      fetchImpl,
      prompt: `${UNIRRM_SYSTEM_PROMPT}\n\n${prompt}`,
      profile: "summary_direct",
      contextLength,
      sampling: { temperature: 0, format: "json", num_predict: maxOutputTokens },
      requestTimeoutMs: Number(process.env.PYA_CRITERION_FACTUALITY_JUDGE_TIMEOUT_MS || 900000),
      maxRetries: 2,
      retryBaseMs: 1000
    });
    return {
      text: response.text,
      metadata: { engine: "ollama", model, quantization: "Q4_K_M", contextLength, maxOutputTokens, effectiveThink: response.effectiveThink },
      timing: response.timing,
      request: response.request
    };
  };
}

async function reliableExecutor({ input, baseUrl, fetchImpl }) {
  return runOllamaChat({ ...input, baseUrl, fetchImpl, requestTimeoutMs: 180000, maxRetries: 3, retryBaseMs: 1000 });
}

async function completeGenerationCheckpoint({ root, runId, model, selection, resume }) {
  if (!resume) return null;
  const rows = await readRows(path.resolve(root, "criterion", "results", `${runId}.jsonl`));
  const bySample = new Map(rows.filter(row => row.model === model && row.status === "ok").map(row => [String(row.sampleId), row]));
  const selected = selection.map(sample => bySample.get(String(sample.id))).filter(Boolean);
  return selected.length === selection.length ? selected : null;
}

export async function runMeetingBankFactualityPilot({
  root = process.cwd(), datasetPath, split = "test", runId = MEETINGBANK_FACTUALITY_RUN_ID,
  models = MEETINGBANK_FACTUALITY_MODELS, selectionSeed = MEETINGBANK_FACTUALITY_SELECTION_SEED,
  selectionCount = 10, baseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? "http://mriczo:11434",
  gpuHousekeeperUrl = process.env.PYA_GPU_HOUSEKEEPER_URL ?? null, gpuId = process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0",
  judgeEngine = process.env.PYA_CRITERION_FACTUALITY_JUDGE_ENGINE ?? "ollama",
  judgeModel = process.env.PYA_CRITERION_FACTUALITY_JUDGE_MODEL ?? UNIRRM_FACTUALITY_MODEL,
  judgeMaxOutputTokens = JUDGE_MAX_OUTPUT_TOKENS,
  judgeContextLength = JUDGE_CONTEXT_LENGTH,
  resume = false, smoke = false, fetchImpl = globalThis.fetch, generationRunner = null, judgeExecutor = null,
  now = () => new Date()
} = {}) {
  if (!datasetPath) throw new Error("MeetingBank factuality pilot requires --dataset <meetingbank test file>");
  const id = String(runId);
  const loaded = await loadSuiteSamples({ benchmark: "meetingbank", datasetPath, split });
  const selection = selectMeetingBankJudgePilotSamples(loaded.samples, { count: smoke ? Math.min(5, selectionCount) : selectionCount, seed: selectionSeed });
  if (!selection.length) throw new Error("MeetingBank factuality pilot selected no samples");
  const ollamaModels = judgeExecutor || judgeEngine !== "ollama" ? models : [...models, judgeModel];
  const ollama = await preflightOllama({ baseUrl, models: ollamaModels, sample: selection[0], fetchImpl, probeModels: false });
  if (ollama.status !== "ok") throw new Error(`Ollama preflight failed: ${ollama.error}`);
  const metadataProvider = async ({ model }) => ({ ...(await readOllamaMetadata({ model, baseUrl: ollama.baseUrl, fetchImpl })), requestedModel: model, resolvedModel: model });
  const generationExecutor = input => reliableExecutor({ input: { ...input, model: input.model }, baseUrl: ollama.baseUrl, fetchImpl });
  const generationRuns = {};
  const generationRows = [];
  const generationReuse = {};
  const ollamaDischarge = { status: "pending", results: [] };
  for (const model of models) {
    const generationRunId = `${id}-generation-${sha256(model).slice(0, 12)}`;
    generationRuns[model] = generationRunId;
    let generation;
    const checkpointRows = await completeGenerationCheckpoint({ root, runId: generationRunId, model, selection, resume });
    if (checkpointRows) {
      generationRows.push(...checkpointRows);
      generationReuse[model] = { runId: generationRunId, reused: true, rows: checkpointRows.length };
      continue;
    }
    try {
      const probe = await preflightOllamaModel({ baseUrl: ollama.baseUrl, model, sample: selection[0], fetchImpl });
      ollama.requests.push(...probe.requests);
      if (probe.status !== "ok") throw new Error(`Ollama preflight failed for ${model}: ${probe.error}`);
      generation = generationRunner ? await generationRunner({ id: generationRunId, samples: selection, models: [model], resume }) : await runCriterion({
        benchmark: "meetingbank", datasetPath, split, sampleIds: selection.map(sample => sample.id), models: [model], profile: "summary_direct", contextLength: 32768,
        runId: generationRunId, root, resume, engine: "ollama", executor: generationExecutor, metadataProvider,
        promptTransform: sample => `${MEETINGBANK_FACTUALITY_PROMPT}\n\nTRANSCRIPT:\n${sample.input}`,
        promptVariant: "summary_meetingbank_factuality", promptTemplateHash: MEETINGBANK_FACTUALITY_PROMPT_HASH, recordPrompt: true,
        replayCommand: `node command/criterion.mjs meetingbank-factuality-pilot --dataset ${datasetPath} --run-id ${id} --resume`
      });
      generationRuns[model] = generationRunId;
      generationRows.push(...(generation.results ?? []));
    } finally {
      const discharge = await dischargeOllamaModels({ baseUrl: ollama.baseUrl, models: [model], fetchImpl, verifyRelease: true });
      ollamaDischarge.results.push(...discharge.results);
      generationReuse[model] = { runId: generationRunId, reused: false, rows: generation?.results?.length ?? 0, dischargeVerified: discharge.verified === true };
    }
  }
  ollamaDischarge.status = ollamaDischarge.results.every(result => result.status === "ok") ? "ok" : "partial";
  const preJudgeDischarge = await dischargeOllamaModels({ baseUrl: ollama.baseUrl, models, fetchImpl, verifyRelease: true });
  ollamaDischarge.preJudge = preJudgeDischarge;
  if (preJudgeDischarge.status !== "ok" || preJudgeDischarge.verified !== true) {
    throw new Error(`Ollama Qwen discharge could not be verified before judging: ${preJudgeDischarge.verificationError ?? preJudgeDischarge.status}`);
  }
  const checkpointPath = path.resolve(root, "criterion", "results", `${id}.jsonl`);
  const prior = resume ? await readRows(checkpointPath) : [];
  const rows = new Map(prior.map(row => [row.identity, row]));
  const judge = { modelId: judgeModel, name: UNIRRM_FACTUALITY_NAME, engine: judgeEngine, sourceModel: judgeEngine === "ollama" ? UNIRRM_FACTUALITY_MODEL : UNIRRM_FACTUALITY_HF_MODEL, quantization: judgeEngine === "ollama" ? "Q4_K_M" : null, contextLength: judgeContextLength, promptVersion: UNIRRM_FACTUALITY_PROMPT_VERSION, temperature: 0, maxOutputTokens: judgeMaxOutputTokens, referenceHidden: true, discharge: { status: "pending" } };
  let adapter = null;
  const executor = judgeExecutor ?? (judgeEngine === "ollama"
    ? createOllamaFactualityJudge({ model: judgeModel, baseUrl: ollama.baseUrl, fetchImpl, maxOutputTokens: judgeMaxOutputTokens, contextLength: judgeContextLength })
    : (adapter = await createHuggingFaceJudgeExecutor({ model: judgeModel || UNIRRM_FACTUALITY_HF_MODEL, root, runId: id, housekeeperUrl: gpuHousekeeperUrl, gpuId, generation: { maxInputTokens: judgeContextLength, maxOutputTokens: judgeMaxOutputTokens, minOutputTokens: 1, numBeams: 1, doSample: false, enableThinking: false, repetitionPenalty: 1.05 }, dischargeOnClose: true })).executor);
  try {
    for (const model of models) for (const sample of selection) {
      const generationRow = generationRows.find(row => row.model === model && String(row.sampleId) === String(sample.id) && row.status === "ok");
      const identity = `${model}\u0000${sample.id}`;
      if (rows.get(identity)?.status === "ok") continue;
      if (!generationRow) {
        rows.set(identity, { runId: id, identity, model, sampleId: sample.id, status: "generation-error", summary: "", sourceHash: sha256(sample.input), summaryHash: sha256(""), error: "generation row unavailable", judgeStatus: "not-run" });
        await writeRows(checkpointPath, [...rows.values()]);
        continue;
      }
      const result = await judgeSummary({ executor, model: judgeModel, sample, summary: generationRow.output, identity, maxOutputTokens: judgeMaxOutputTokens });
      const normalized = result.normalized;
      const claims = normalized?.claims ?? [];
      const claimCounts = claimMetrics(claims);
      const complete = result.status === "ok";
      const scores = {
        faithfulnessPercentage: complete ? claimCounts.faithfulnessPercentage : normalized?.scores?.faithfulnessPercentage ?? null,
        completenessPercentage: normalized?.scores?.completenessPercentage ?? null,
        decisionActionPercentage: normalized?.scores?.decisionActionPercentage ?? null,
        relevancePercentage: normalized?.scores?.relevancePercentage ?? null,
        concisenessPercentage: normalized?.scores?.concisenessPercentage ?? null,
        publicationSuitabilityPercentage: normalized?.scores?.publicationSuitabilityPercentage ?? null,
        unsupportedClaimCount: claimCounts.unsupported,
        contradictionCount: claimCounts.contradicted,
        evidenceCoveragePercentage: claimCounts.evidenceCoveragePercentage,
        omittedImportantItems: normalized?.omittedImportantItems ?? []
      };
      rows.set(identity, {
        runId: id, identity, model, sampleId: sample.id, status: complete ? "ok" : result.status, judgeStatus: result.status,
        meetingMetadata: sample.metadata ?? {}, sourceHash: sha256(sample.input), summary: generationRow.output, summaryHash: generationRow.outputHash ?? sha256(generationRow.output), referenceHiddenFromJudge: true,
        claims, claimCounts, scores, generation: { status: generationRow.status, outputHash: generationRow.outputHash, timing: generationRow.metrics ?? {}, modelMetadata: generationRow.modelMetadata ?? null },
        judge: { status: result.status, attempts: result.attempts, repairRetries: result.repairRetries, rawResponse: result.rawResponse ?? "", normalized: normalized ?? null, error: result.error ?? null, metadata: result.metadata ?? null, timing: result.timing ?? {} },
        provenance: { datasetHash: loaded.datasetHash, split: loaded.actualSplit, sampleId: sample.id, sourceHash: sha256(sample.input), generationRunId: generationRuns[model], generationPromptHash: MEETINGBANK_FACTUALITY_PROMPT_HASH, judgeModel, judgeEngine, judgePromptVersion: UNIRRM_FACTUALITY_PROMPT_VERSION, referenceHidden: true },
        error: complete ? null : normalized?.error ?? result.error ?? "judge evidence incomplete", finishedAt: now().toISOString()
      });
      await writeRows(checkpointPath, [...rows.values()]);
    }
  } finally {
    if (adapter) {
      try { const discharge = await adapter.close(); judge.discharge = discharge?.success === false && !discharge?.skipped ? { status: "failed", detail: discharge } : { status: "completed", detail: discharge }; }
      catch (error) { judge.discharge = { status: "failed", error: text(error?.message ?? error) }; }
    } else if (!judgeExecutor && judgeEngine === "ollama") {
      try {
        judge.discharge = await dischargeOllamaModels({ baseUrl: ollama.baseUrl, models: [judgeModel], fetchImpl, verifyRelease: true });
      } catch (error) { judge.discharge = { status: "failed", error: text(error?.message ?? error) }; }
    } else judge.discharge = { status: "not-managed-by-adapter" };
  }
  const resultRows = [...rows.values()];
  const aggregates = models.map(model => ({ model, aggregate: aggregateRows(resultRows.filter(row => row.model === model)) }));
  const judgeRows = resultRows.map(row => row.judge).filter(Boolean);
  const judgeStats = { initialRequests: judgeRows.length, repairRetries: judgeRows.reduce((sum, row) => sum + Number(row.repairRetries ?? 0), 0), successful: resultRows.filter(row => row.status === "ok").length, malformed: judgeRows.filter(row => row.status === "malformed-output").length, truncated: judgeRows.filter(row => row.status === "truncated-output").length, transport: judgeRows.filter(row => row.status === "transport-error").length, incomplete: judgeRows.filter(row => row.status === "incomplete").length };
  const finalRun = await writeRunArtifacts({
    runId: id, criterion: "meetingbank-factuality-pilot", evaluationMode: MEETINGBANK_FACTUALITY_MODE, suite: { key: "meetingbank-factuality-pilot", name: "MeetingBank transcript-grounded factuality pilot", version: "factuality-v4-q4-model-major", sourceUrls: ["https://meetingbank.github.io/dataset/", "https://huggingface.co/SUSTech-NLP/UniRRM-8B", "https://arxiv.org/html/2609.05910v1"], licenseUrls: ["https://meetingbank.github.io/license/"] }, status: resultRows.some(row => row.status !== "ok") ? "partial" : "completed", split, actualSplit: loaded.actualSplit, datasetPath, datasetHash: loaded.datasetHash, datasetRevision: process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned", models, engine: `ollama-plus-${judgeEngine}-judge`, profile: "summary_direct", contextLength: 32768, promptHash: MEETINGBANK_FACTUALITY_PROMPT_HASH, generationPrompt: { name: "summary_meetingbank_factuality", hash: MEETINGBANK_FACTUALITY_PROMPT, text: MEETINGBANK_FACTUALITY_PROMPT }, generationRunIds: generationRuns, generationReuse, selection: { seed: selectionSeed, count: selection.length, sampleIds: selection.map(sample => sample.id), datasetHash: loaded.datasetHash }, execution: { generationCompletedForAllModelsBeforeJudging: true, generationOrder: models, judgingOrder: models }, results: resultRows, aggregates,
    generationStats: { attempted: generationRows.length, successful: generationRows.filter(row => row.status === "ok").length, transientRetries: generationRows.reduce((sum, row) => sum + Number(row.metrics?.transportRetries ?? 0), 0), permanentFailures: generationRows.filter(row => row.status === "error").length }, judgeStats,
    ollama: { ...ollama, preflight: ollama, discharge: ollamaDischarge }, judge: { ...judge, revision: null, digest: null, referenceHidden: true }, machine: await collectMachineMetadata(), smoke, runScope: smoke ? "smoke" : "pilot", createdAt: now().toISOString(), startedAt: now().toISOString(), finishedAt: now().toISOString(), totalWallClockMs: 0, replayCommand: `node command/criterion.mjs meetingbank-factuality-pilot --dataset ${datasetPath} --run-id ${id} --resume`
  }, { root, checkpointResults: resultRows, renderMarkdown, renderCsv, renderHtml });
  return finalRun;
}
