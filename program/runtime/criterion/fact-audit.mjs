import fs from "node:fs/promises";
import path from "node:path";

import { loadSuiteSamples, readDatasetFile } from "./datasets.mjs";
import { runOllamaChat } from "./ollama.mjs";
import { parseJsonOutput, sha256, stableJson, tokenize } from "./metrics.mjs";
import { loadRun, writeRunArtifacts } from "./report.mjs";

export const FACT_EVALUATION_MODES = Object.freeze({
  exact: "omnicseval-meeting",
  automatedProxy: "meetingbank-fact-audit"
});

export const FACT_SCORER_VERSION = "omnicseval-style-v1";
export const FACT_JUDGE_PROMPT_VERSION = "meetingbank-fact-judge-v1";

const MUNICIPAL_FLAGS = Object.freeze({
  motion: /\b(?:motion|moved|move to)\b/iu,
  amendment: /\bamend(?:ment|ed)?\b/iu,
  vote: /\b(?:vote|voted|voting|ayes?|nays?|roll call|unanimous)\b/iu,
  approvalOrRejection: /\b(?:approv(?:e|ed|al)|reject(?:ed|ion)?|den(?:y|ied|ial))\b/iu,
  deferral: /\b(?:defer(?:red|ral)?|postpon(?:e|ed|ement)|table[sd]?)\b/iu,
  name: /\b(?:named?|name|called)\b|\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/u,
  date: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b/iu,
  monetaryAmount: /(?:[$€£]\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d+)?\s*(?:dollars?|million|billion|thousand)\b)/iu,
  departmentOrResponsiblePerson: /\b(?:department|division|office|agency|director|manager|secretary|clerk|chair|councilmember|responsible)\b/iu,
  deadline: /\b(?:deadline|due|by|before|until|no later than)\b/iu,
  finalOutcome: /\b(?:therefore|ultimately|final(?:ly)?|result(?:ed)?|carried|passed|failed|adopted|approved|rejected|deferred)\b/iu
});

function asText(value) {
  if (value && typeof value === "object") return String(value.text ?? value.value ?? value.claim ?? value.fact ?? "").trim();
  return String(value ?? "").trim();
}

function firstDefined(value, keys, fallback = null) {
  for (const key of keys) if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
  return fallback;
}

export function splitFactSentences(value) {
  const text = String(value ?? "").replace(/\r\n?/gu, "\n").trim();
  if (!text) return [];
  const segments = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)].map(item => ({ text: item.segment.trim(), start: item.index, end: item.index + item.segment.length }))
    : [...text.matchAll(/[^.!?\n]+(?:[.!?]+|$)/gu)].map(match => ({ text: match[0].trim(), start: match.index, end: match.index + match[0].length }));
  return segments.filter(item => item.text).map((item, index) => ({ id: `s${index + 1}`, index, ...item }));
}

export function municipalClaimFlags(value) {
  const text = asText(value);
  return Object.fromEntries(Object.entries(MUNICIPAL_FLAGS).map(([key, pattern]) => [key, pattern.test(text)]));
}

function normalizeItems(items, prefix, fallback = []) {
  const source = Array.isArray(items) ? items : fallback;
  return source.map((item, index) => {
    const text = asText(item);
    const object = item && typeof item === "object" ? item : {};
    const id = String(object.id ?? object.factId ?? object.claimId ?? `${prefix}${index + 1}`);
    return {
      id,
      text,
      sourceSentenceRefs: object.sourceSentenceRefs ?? object.sourceSentences ?? object.sourceSpan ?? null,
      sentenceId: object.sentenceId ?? object.summarySentenceId ?? object.summary_sentence_id ?? null,
      flags: object.flags ?? municipalClaimFlags(text),
      ...object
    };
  }).filter(item => item.text);
}

function normalizeMatches(rawMatches = []) {
  if (!Array.isArray(rawMatches)) return [];
  return rawMatches.map((match, index) => {
    const item = match && typeof match === "object" ? match : {};
    return {
      id: String(item.id ?? `match${index + 1}`),
      keyFactId: String(item.keyFactId ?? item.factId ?? item.fact_id ?? item.key_fact_id ?? ""),
      summarySentenceId: String(item.summarySentenceId ?? item.sentenceId ?? item.summary_sentence_id ?? ""),
      matched: item.matched === undefined ? item.match === undefined ? item.decision === "matched" || item.status === "matched" : Boolean(item.match) : Boolean(item.matched),
      decision: item.decision ?? (item.matched ? "matched" : "unmatched"),
      explanation: item.explanation ?? item.reason ?? null,
      confidence: item.confidence ?? null,
      sourceSentenceRefs: item.sourceSentenceRefs ?? item.sourceSpan ?? null,
      ...item
    };
  }).filter(item => item.keyFactId || item.summarySentenceId);
}

function normalizeVerifications(rawVerifications = [], claims = []) {
  const source = Array.isArray(rawVerifications) ? rawVerifications : [];
  const byClaim = new Map(source.map(item => [String(item?.claimId ?? item?.id ?? ""), item]));
  return claims.map((claim, index) => {
    const item = byClaim.get(String(claim.id)) ?? source[index] ?? {};
    const decision = String(item.support ?? item.decision ?? item.status ?? "unresolved").toLowerCase();
    const support = ["supported", "support", "yes", "true"].includes(decision)
      ? "supported"
      : ["unsupported", "unsupported_claim", "no"].includes(decision)
        ? "unsupported"
        : ["contradiction", "contradicted"].includes(decision) ? "contradiction" : "unresolved";
    return {
      ...item,
      claimId: claim.id,
      support,
      explanation: item.explanation ?? item.reason ?? null,
      confidence: item.confidence ?? null,
      sourceSentenceRefs: item.sourceSentenceRefs ?? item.sourceSpan ?? null
    };
  });
}

export function normalizeFactEvidence(raw = {}, { sourceText = "", summaryText = "" } = {}) {
  const sourceSentences = splitFactSentences(sourceText);
  const summarySentences = splitFactSentences(summaryText);
  const keyFacts = normalizeItems(raw.keyFacts ?? raw.key_facts ?? raw.facts, "fact", sourceSentences.map(sentence => ({ text: sentence.text, sourceSentenceRefs: [sentence.id], flags: municipalClaimFlags(sentence.text) })));
  const rawClaims = raw.claims ?? raw.summaryClaims ?? raw.summary_claims;
  const summaryClaims = Array.isArray(rawClaims) ? normalizeItems(rawClaims, "claim") : [];
  const claims = summaryClaims.length ? summaryClaims : summarySentences.map(sentence => ({ ...sentence, id: `claim-${sentence.id}`, text: sentence.text, sentenceId: sentence.id, flags: municipalClaimFlags(sentence.text) }));
  const matches = normalizeMatches(raw.matches ?? raw.keyFactMatches ?? raw.key_fact_matches);
  const verifications = normalizeVerifications(raw.verifications ?? raw.claimVerifications ?? raw.claim_verifications, claims);
  const informativeSentenceIds = new Set(summarySentences.filter(sentence => tokenize(sentence.text).length > 2).map(sentence => sentence.id));
  return {
    sourceSentences,
    summarySentences,
    keyFacts,
    claims,
    matches,
    verifications,
    informativeSentenceIds: [...informativeSentenceIds],
    judgeAgreement: raw.agreement ?? raw.judgeAgreement ?? null,
    municipalFlags: {
      source: municipalClaimFlags(sourceText),
      summary: municipalClaimFlags(summaryText)
    }
  };
}

function ratio(numerator, denominator) { return denominator > 0 ? numerator / denominator : null; }

export function computeFactMetrics({ keyFacts = [], summarySentences = [], matches = [], claims = [], verifications = [], informativeSentenceCount = null } = {}) {
  const factIds = new Set(keyFacts.map(fact => String(fact.id)));
  const sentenceIds = new Set(summarySentences.map(sentence => String(sentence.id)));
  const matchedFactIds = new Set(matches.filter(match => match.matched && factIds.has(String(match.keyFactId))).map(match => String(match.keyFactId)));
  const matchedSentenceIds = new Set(matches.filter(match => match.matched && sentenceIds.has(String(match.summarySentenceId))).map(match => String(match.summarySentenceId)));
  const supportedClaimIds = new Set(verifications.filter(item => item.support === "supported").map(item => String(item.claimId)));
  const unsupportedClaimIds = new Set(verifications.filter(item => item.support === "unsupported").map(item => String(item.claimId)));
  const contradictionCount = verifications.filter(item => item.support === "contradiction").length;
  const unresolvedJudgeCount = verifications.filter(item => item.support === "unresolved").length;
  const matchedKeyFactCount = matchedFactIds.size;
  const summarySentenceCount = summarySentences.length;
  const informativeCount = informativeSentenceCount ?? summarySentenceCount;
  const atomicClaimCount = claims.length;
  return {
    completeness: ratio(matchedKeyFactCount, keyFacts.length),
    conciseness: ratio(matchedSentenceIds.size, summarySentenceCount),
    faithfulness: ratio(supportedClaimIds.size, atomicClaimCount),
    completenessPercent: ratio(matchedKeyFactCount, keyFacts.length) === null ? null : ratio(matchedKeyFactCount, keyFacts.length) * 100,
    concisenessPercent: ratio(matchedSentenceIds.size, summarySentenceCount) === null ? null : ratio(matchedSentenceIds.size, summarySentenceCount) * 100,
    faithfulnessPercent: ratio(supportedClaimIds.size, atomicClaimCount) === null ? null : ratio(supportedClaimIds.size, atomicClaimCount) * 100,
    keyFactCount: keyFacts.length,
    matchedKeyFactCount,
    summarySentenceCount,
    informativeSentenceCount: informativeCount,
    matchedSummarySentenceCount: matchedSentenceIds.size,
    atomicClaimCount,
    supportedClaimCount: supportedClaimIds.size,
    unsupportedClaimCount: unsupportedClaimIds.size,
    contradictionCount,
    unresolvedJudgeCount
  };
}

function lexicalOverlap(left, right) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  return [...a].filter(token => b.has(token)).length / Math.max(1, Math.min(a.size, b.size));
}

export function createDeterministicFactJudge({ scorerVersion = "deterministic-lexical-test-v1" } = {}) {
  return async ({ sourceText, summaryText }) => {
    const sourceSentences = splitFactSentences(sourceText);
    const summarySentences = splitFactSentences(summaryText);
    const keyFacts = sourceSentences.map(sentence => ({ id: `fact-${sentence.id}`, text: sentence.text, sourceSentenceRefs: [sentence.id], flags: municipalClaimFlags(sentence.text) }));
    const claims = summarySentences.map(sentence => ({ id: `claim-${sentence.id}`, text: sentence.text, sentenceId: sentence.id, flags: municipalClaimFlags(sentence.text) }));
    const matches = keyFacts.flatMap(fact => summarySentences.map(sentence => ({
      keyFactId: fact.id,
      summarySentenceId: sentence.id,
      matched: lexicalOverlap(fact.text, sentence.text) >= 0.5,
      explanation: "deterministic lexical overlap",
      confidence: lexicalOverlap(fact.text, sentence.text)
    })));
    const verifications = claims.map(claim => {
      const best = Math.max(0, ...sourceSentences.map(sentence => lexicalOverlap(claim.text, sentence.text)));
      return { claimId: claim.id, support: best >= 0.5 ? "supported" : "unsupported", explanation: "deterministic lexical overlap", confidence: best };
    });
    return { keyFacts, claims, matches, verifications, judge: { provider: "deterministic", model: "judge:lexical", scorerVersion } };
  };
}

function factPrompt({ sourceText, summaryText, annotation = null }) {
  const annotationHints = annotation ? {
    sourceDataset: annotationSourceDataset(annotation),
    sourceId: annotationSourceId(annotation),
    keyFacts: annotation.keyFacts ?? annotation.key_facts ?? annotation.facts ?? null,
    reference: annotation.reference ?? null
  } : null;
  return [
    "You are an external factuality evaluator for a municipal meeting summary.",
    "Return JSON only. Do not write a narrative outside the JSON object.",
    "Extract atomic key facts from SOURCE, atomic claims from SUMMARY, match key facts to summary sentences, and verify every summary claim against SOURCE.",
    "Use support values supported, unsupported, contradiction, or unresolved.",
    "Preserve source sentence ids as s1, s2... and summary sentence ids as s1, s2... in evidence references.",
    "The JSON shape must be: {keyFacts:[{id,text,sourceSentenceRefs,flags}],claims:[{id,text,sentenceId,flags}],matches:[{keyFactId,summarySentenceId,matched,explanation,confidence}],verifications:[{claimId,support,sourceSentenceRefs,explanation,confidence}]}",
    annotationHints ? `RELEASED ANNOTATION HINTS:\n${JSON.stringify(annotationHints)}` : "",
    `SOURCE:\n${sourceText}`,
    `SUMMARY:\n${summaryText}`
  ].filter(Boolean).join("\n\n");
}

export function createOllamaFactJudge({ model, baseUrl, temperature = 0, maxOutputTokens = 4096, promptVersion = FACT_JUDGE_PROMPT_VERSION, scorerVersion = FACT_SCORER_VERSION, fetchImpl: configuredFetchImpl, profile = "summary_direct" } = {}) {
  if (!model) throw new Error("fact audit requires a separate judge model");
  return async ({ sourceText, summaryText, annotation, fetchImpl = configuredFetchImpl }) => {
    const startedAt = Date.now();
    const response = await runOllamaChat({
      model,
      prompt: factPrompt({ sourceText, summaryText, annotation }),
      profile,
      sampling: { temperature, format: "json", num_predict: maxOutputTokens },
      baseUrl,
      fetchImpl
    });
    const parsed = parseJsonOutput(response.text);
    if (!parsed.valid || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      throw new Error(`fact judge returned invalid JSON: ${parsed.error ?? "object required"}`);
    }
    return {
      ...parsed.value,
      judge: {
        provider: "ollama",
        model,
        promptVersion,
        scorerVersion,
        temperature,
        maxOutputTokens,
        profile,
        effectiveThink: response.effectiveThink ?? false,
        timing: response.timing ?? {},
        elapsedMs: Date.now() - startedAt
      }
    };
  };
}

function annotationSourceId(annotation) {
  return firstDefined(annotation, ["sourceId", "source_id", "meetingbankId", "meetingbank_id", "meetingId", "meeting_id", "id"], null);
}

function annotationSourceDataset(annotation) {
  return String(firstDefined(annotation, ["sourceDataset", "source_dataset", "dataset"], "MeetingBank"));
}

function annotationSourceHash(annotation) {
  const explicit = firstDefined(annotation, ["sourceHash", "source_hash", "inputHash", "input_hash"], null);
  if (explicit) return String(explicit);
  const sourceText = firstDefined(annotation, ["sourceText", "source_text", "transcript", "transcript_text"], null);
  return typeof sourceText === "string" && sourceText ? sha256(sourceText) : null;
}

function unique(values) { return [...new Set(values.filter(value => value !== null && value !== undefined).map(String))]; }

export function joinOmniMeetingSample(annotations, samples) {
  const matched = [];
  const unmatched = [];
  for (const [annotationIndex, annotation] of annotations.entries()) {
    const sourceId = annotationSourceId(annotation);
    if (annotationSourceDataset(annotation).toLowerCase() !== "meetingbank") {
      unmatched.push({ annotationIndex, sourceId, reason: "source dataset is not MeetingBank" });
      continue;
    }
    const candidates = samples.filter(sample => unique([sample.id, sample.metadata?.meetingId]).includes(String(sourceId)));
    if (candidates.length === 1) matched.push({ annotation, annotationIndex, sample: candidates[0] });
    else unmatched.push({ annotationIndex, sourceId, reason: candidates.length ? "ambiguous source ID" : "source ID not found", candidateSampleIds: candidates.map(sample => sample.id) });
  }
  return { matched, unmatched };
}

function sourceRowMatches(row, sample) {
  return String(row.sampleId) === String(sample.id)
    || (sample.metadata?.meetingId && String(row.metadata?.meetingId ?? "") === String(sample.metadata.meetingId));
}

function factAggregate(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const average = key => {
    const values = successful.map(row => Number(row.scores?.[key])).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const sum = key => successful.reduce((total, row) => total + Number(row.scores?.[key] ?? 0), 0);
  return {
    sampleCount: rows.length,
    successfulCount: successful.length,
    skippedCount: rows.filter(row => row.status === "skipped").length,
    failureCount: rows.filter(row => row.status === "error").length,
    completeness: average("completeness"),
    conciseness: average("conciseness"),
    faithfulness: average("faithfulness"),
    completenessPercent: average("completenessPercent"),
    concisenessPercent: average("concisenessPercent"),
    faithfulnessPercent: average("faithfulnessPercent"),
    keyFactCount: sum("keyFactCount"),
    matchedKeyFactCount: sum("matchedKeyFactCount"),
    summarySentenceCount: sum("summarySentenceCount"),
    informativeSentenceCount: sum("informativeSentenceCount"),
    atomicClaimCount: sum("atomicClaimCount"),
    supportedClaimCount: sum("supportedClaimCount"),
    unsupportedClaimCount: sum("unsupportedClaimCount"),
    contradictionCount: sum("contradictionCount"),
    unresolvedJudgeCount: sum("unresolvedJudgeCount")
  };
}

function factGroups(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row.sourceMetadata?.[key] ?? row.metadata?.[key] ?? "unspecified";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([value, grouped]) => ({ [key]: value, model: grouped[0]?.model, aggregate: factAggregate(grouped) }));
}

async function loadRows(filepath) {
  try { return (await fs.readFile(filepath, "utf8")).split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function runModels(sourceRuns) { return unique(sourceRuns.flatMap(run => run.models ?? run.results?.map(row => row.model) ?? [])); }

function sourceRunRows(sourceRuns) {
  return sourceRuns.flatMap(run => (run.results ?? []).map(row => ({ ...row, sourceRunId: run.runId, sourceRun: run })));
}

function suiteMetadata() {
  return {
    key: "meetingbank-fact",
    name: "MeetingBank fact evaluation",
    version: FACT_SCORER_VERSION,
    sourceUrls: ["https://meetingbank.github.io/dataset/", "https://arxiv.org/html/2606.15974v1", "https://github.com/zhouweixiao/OmniCSEval"],
    licenseUrls: ["https://meetingbank.github.io/license/"]
  };
}

async function loadAnnotations(filepath) {
  if (!filepath) throw new Error("exact OmniCSEval mode requires --annotations <path>");
  const data = await readDatasetFile(filepath);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.meetingbank)) return data.meetingbank;
  if (Array.isArray(data.meeting)) return data.meeting;
  if (annotationSourceId(data)) return [data];
  throw new Error("OmniCSEval annotations must be an array or contain a meetingbank array");
}

function sampleOutputRows({ mode, samples, outputs, annotations }) {
  if (mode === FACT_EVALUATION_MODES.exact) {
    const meetingAnnotations = annotations.filter(annotation => annotationSourceDataset(annotation).toLowerCase() === "meetingbank");
    const joined = joinOmniMeetingSample(meetingAnnotations, samples);
    return {
      selected: joined.matched,
      matchedJoins: joined.matched.map(item => ({ annotationIndex: item.annotationIndex, sourceId: annotationSourceId(item.annotation), sampleId: item.sample.id })),
      unmatched: joined.unmatched,
      annotationCount: meetingAnnotations.length
    };
  }
  return { selected: samples.map(sample => ({ sample, annotation: null })), matchedJoins: [], unmatched: [], annotationCount: null };
}

function localSourceHash(sample) { return sha256(sample.input ?? ""); }

export async function runFactAudit({
  mode = FACT_EVALUATION_MODES.automatedProxy,
  datasetPath,
  annotationPath = null,
  sourceRunIds = [],
  split = "test",
  limit = null,
  runId = null,
  root = process.cwd(),
  judge = null,
  judgeModel = process.env.PYA_CRITERION_FACT_JUDGE_MODEL ?? null,
  judgeProvider = "ollama",
  judgeBaseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST,
  judgeTemperature = 0,
  judgeMaxOutputTokens = 4096,
  judgePromptVersion = FACT_JUDGE_PROMPT_VERSION,
  factScorerVersion = FACT_SCORER_VERSION,
  datasetRevision = process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned",
  resume = false,
  smoke = false,
  now = () => new Date()
} = {}) {
  if (![FACT_EVALUATION_MODES.exact, FACT_EVALUATION_MODES.automatedProxy].includes(mode)) throw new Error(`unknown fact evaluation mode: ${mode}`);
  if (!datasetPath) throw new Error("fact audit requires the MeetingBank dataset path");
  const sourceIds = unique(Array.isArray(sourceRunIds) ? sourceRunIds : String(sourceRunIds).split(","));
  if (!sourceIds.length) throw new Error("fact audit requires --source-runs <run-id,...>");
  const sourceRuns = await Promise.all(sourceIds.map(id => loadRun(id, { root })));
  const loaded = await loadSuiteSamples({ benchmark: "meetingbank", datasetPath, split });
  const annotations = mode === FACT_EVALUATION_MODES.exact ? await loadAnnotations(annotationPath) : [];
  const selection = sampleOutputRows({ mode, samples: loaded.samples, outputs: sourceRuns, annotations });
  const selected = limit === null || limit === undefined ? selection.selected : selection.selected.slice(0, Math.max(0, Number(limit)));
  const sourceRows = sourceRunRows(sourceRuns);
  const modelNames = runModels(sourceRuns);
  if (judgeModel && modelNames.includes(judgeModel)) throw new Error("fact audit judge must be separate from every evaluated source model");
  const resolvedJudge = judge ?? (judgeModel ? createOllamaFactJudge({ model: judgeModel, baseUrl: judgeBaseUrl, temperature: judgeTemperature, maxOutputTokens: judgeMaxOutputTokens, promptVersion: judgePromptVersion, scorerVersion: factScorerVersion }) : null);
  if (!resolvedJudge) throw new Error("fact audit requires an external judge model; tests may inject a deterministic judge");
  const id = String(runId ?? `${mode}-${now().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}-${sha256(`${mode}:${now().toISOString()}`).slice(0, 8)}`);
  const outputJsonl = path.resolve(root, "criterion", "results", `${id}.jsonl`);
  const prior = resume ? await loadRows(outputJsonl) : [];
  const completed = new Map(prior.filter(row => row.status === "ok" || row.status === "skipped").map(row => [row.identity, row]));
  const attemptsByIdentity = new Map();
  for (const row of prior) {
    if (!row.identity) continue;
    const attempts = attemptsByIdentity.get(row.identity) ?? [];
    attempts.push(row);
    attemptsByIdentity.set(row.identity, attempts);
  }
  const results = [...completed.values()];
  const attemptHistory = prior.filter(row => row.status === "error");
  const sourceHashMismatches = [];
  sourceHashMismatches.push(...prior.filter(row => row.sourceHashMismatch).map(row => row.sourceHashMismatch));
  const unmatchedJoins = [...selection.unmatched];
  const runStartedAt = now().toISOString();
  const checkpointRows = () => {
    const latest = new Map(results.map(row => [`${row.identity}\u0000${row.attempt ?? 1}`, row]));
    for (const row of attemptHistory) {
      const key = `${row.identity}\u0000${row.attempt ?? 1}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    return [...latest.values()];
  };
  const persistRows = async () => {
    await fs.mkdir(path.dirname(outputJsonl), { recursive: true });
    const rows = checkpointRows();
    await fs.writeFile(outputJsonl, `${rows.map(row => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`, "utf8");
  };
  for (const item of selected) {
    const sample = item.sample;
    const annotation = item.annotation;
    const matchingOutputs = sourceRows.filter(row => sourceRowMatches(row, sample));
    if (!matchingOutputs.length) unmatchedJoins.push({ sourceId: sample.id, reason: "no saved model output matched sample" });
    for (const sourceRow of matchingOutputs) {
      const identity = `${mode}\u0000${sourceRow.sourceRunId}\u0000${sourceRow.model}\u0000${sample.id}`;
      if (completed.has(identity)) continue;
      const previousAttempts = attemptsByIdentity.get(identity) ?? [];
      const base = {
        identity,
        runId: id,
        benchmark: "meetingbank",
        evaluationMode: mode === FACT_EVALUATION_MODES.exact ? "exact-omnicseval-compatible" : "automated_proxy",
        engine: "posthoc-fact",
        model: sourceRow.model,
        sourceRunId: sourceRow.sourceRunId,
        sourceSampleId: sourceRow.sampleId,
        sampleId: sample.id,
        reference: sample.reference ?? "",
        annotationReference: annotation?.reference ?? annotation?.summary ?? null,
        inputHash: sourceRow.inputHash ?? sha256(sample.input),
        sourceTextHash: localSourceHash(sample),
        outputHash: sourceRow.outputHash ?? sha256(sourceRow.output ?? ""),
        output: sourceRow.output ?? "",
        sourceMetadata: sourceRow.metadata ?? sample.metadata ?? {},
        sourceStatus: sourceRow.status,
        attempt: previousAttempts.length + 1,
        retryCount: previousAttempts.filter(row => row.status === "error").length,
        sourceModelMetadata: sourceRow.modelMetadata ?? sourceRow.sourceRun?.aggregates?.find(row => row.model === sourceRow.model)?.modelMetadata ?? null,
        provenance: {
          benchmark: "MeetingBank",
          datasetHash: loaded.datasetHash ?? null,
          datasetRevision,
          split: loaded.actualSplit,
          sampleId: sample.id,
          sourceRunId: sourceRow.sourceRunId,
          sourceOutputHash: sourceRow.outputHash ?? null,
          sourceTextHash: localSourceHash(sample),
          annotationHash: annotation ? sha256(stableJson(annotation)) : null,
          annotationIndex: item.annotationIndex ?? null,
          mode: mode === FACT_EVALUATION_MODES.exact ? "exact-omnicseval-compatible" : "automated_proxy"
        },
        startedAt: now().toISOString()
      };
      if (sourceRow.status !== "ok") {
        const skipped = { ...base, status: "skipped", skipReason: `saved source row is ${sourceRow.status}`, finishedAt: now().toISOString() };
        results.push(skipped); completed.set(identity, skipped); await persistRows(); continue;
      }
      const annotationSourceHashValue = annotationSourceHash(annotation);
      if (annotationSourceHashValue && annotationSourceHashValue !== base.sourceTextHash) {
        const mismatch = { sampleId: sample.id, sourceId: annotationSourceId(annotation), expected: annotationSourceHashValue, actual: base.sourceTextHash };
        base.sourceHashMismatch = mismatch;
        if (!sourceHashMismatches.some(item => stableJson(item) === stableJson(mismatch))) sourceHashMismatches.push(mismatch);
      }
      if (sourceRow.inputHash && sourceRow.inputHash !== base.sourceTextHash) base.inputHashMismatch = { saved: sourceRow.inputHash, local: base.sourceTextHash };
      try {
        const raw = await resolvedJudge({ sourceText: sample.input, summaryText: sourceRow.output, annotation, sampleId: sample.id, model: sourceRow.model, sourceRunId: sourceRow.sourceRunId });
        const evidenceInput = mode === FACT_EVALUATION_MODES.exact
          ? {
            ...annotation,
            ...raw,
            keyFacts: annotation?.keyFacts ?? annotation?.key_facts ?? annotation?.facts ?? raw.keyFacts ?? raw.key_facts,
            claims: annotation?.claims ?? annotation?.summaryClaims ?? raw.claims ?? raw.summaryClaims,
            matches: annotation?.matches ?? raw.matches,
            verifications: annotation?.verifications ?? raw.verifications
          }
          : raw;
        const evidence = normalizeFactEvidence(evidenceInput, { sourceText: sample.input, summaryText: sourceRow.output });
        const scores = computeFactMetrics({ ...evidence, informativeSentenceCount: evidence.informativeSentenceIds.length });
        const row = {
          ...base,
          status: "ok",
          factEvidence: evidence,
          judge: { provider: judgeProvider, model: judgeModel ?? raw.judge?.model ?? null, promptVersion: judgePromptVersion, scorerVersion: factScorerVersion, ...(raw.judge ?? {}) },
          scores,
          metrics: raw.judge?.timing ?? { totalElapsedMs: raw.judge?.elapsedMs ?? null },
          finishedAt: now().toISOString()
        };
        results.push(row); completed.set(identity, row);
      } catch (error) {
        const row = { ...base, status: "error", factEvidence: null, scores: {}, metrics: {}, error: error?.message ?? String(error), finishedAt: now().toISOString() };
        attemptHistory.push(row);
        results.push(row); completed.set(identity, row);
      }
      await persistRows();
    }
  }
  const aggregates = modelNames.map(model => ({ model, aggregate: factAggregate(results.filter(row => row.model === model)) }));
  const groupAggregates = {
    city: modelNames.flatMap(model => factGroups(results.filter(row => row.model === model), "city")),
    itemType: modelNames.flatMap(model => factGroups(results.filter(row => row.model === model), "type")),
    chunking: modelNames.flatMap(model => factGroups(results.filter(row => row.model === model), "chunked"))
  };
  const finishedAt = now().toISOString();
  const command = mode === FACT_EVALUATION_MODES.exact ? "omnicseval-meeting" : "meetingbank-fact-audit";
  const finalRun = await writeRunArtifacts({
    runId: id,
    criterion: command,
    suite: suiteMetadata(),
    benchmark: "MeetingBank",
    evaluationMode: mode === FACT_EVALUATION_MODES.exact ? "exact-omnicseval-compatible" : "automated_proxy",
    status: results.some(row => row.status === "error") || unmatchedJoins.length ? "partial" : "completed",
    split,
    actualSplit: loaded.actualSplit,
    datasetRevision,
    datasetHash: loaded.datasetHash ?? null,
    datasetPath,
    annotationPath,
    annotationHash: annotationPath ? sha256(await fs.readFile(annotationPath)) : null,
    models: modelNames,
    sourceRunIds: sourceIds,
    engine: "posthoc-fact",
    profile: "external-judge",
    sampling: { temperature: judgeTemperature, think: false },
    judge: { provider: judgeProvider, model: judgeModel ?? null, promptVersion: judgePromptVersion, scorerVersion: factScorerVersion, temperature: judgeTemperature, maxOutputTokens: judgeMaxOutputTokens },
    mode: "criterion-fact",
    smoke,
    runScope: smoke ? "smoke" : "full",
    createdAt: runStartedAt,
    startedAt: runStartedAt,
    finishedAt,
    totalWallClockMs: Math.max(0, new Date(finishedAt).getTime() - new Date(runStartedAt).getTime()),
    replayCommand: `node command/criterion.mjs ${command} --dataset ${datasetPath} --source-runs ${sourceIds.join(",")} --run-id ${id} --resume`,
    results,
    attemptHistory,
    aggregates,
    groupAggregates,
    unmatchedJoins,
    matchedJoins: selection.matchedJoins,
    sourceHashMismatches,
    annotationCount: selection.annotationCount,
    sourceOutputCounts: Object.fromEntries(sourceRuns.map(run => [run.runId, run.results?.length ?? 0]))
  }, { root, checkpointResults: checkpointRows() });
  return finalRun;
}

export { factAggregate, suiteMetadata };
