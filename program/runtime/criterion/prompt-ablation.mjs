import fs from "node:fs/promises";
import path from "node:path";

import { loadSuiteSamples, readDatasetFile } from "./datasets.mjs";
import { aggregateSampleResults, mean, percentile, sha256, stableJson } from "./metrics.mjs";
import { readOllamaMetadata, runOllamaChat } from "./ollama.mjs";
import { runCriterion } from "./run.mjs";
import { runFactAudit } from "./fact-audit.mjs";
import { loadRun, writeRunArtifacts } from "./report.mjs";

export const PROMPT_ABLATION_VARIANTS = Object.freeze({
  generic: "qwen_baseline_generic",
  meetingBank: "qwen_meetingbank_reference"
});

export const MEETINGBANK_REFERENCE_PROMPT = `You are summarizing one city-council agenda segment from a municipal meeting transcript.

Write a concise, professionally written meeting-minutes summary based only on the transcript.

Prioritize:
- the agenda item or issue;
- the important facts and viewpoints;
- motions, amendments, votes, approvals, rejections, deferrals, and decisions;
- names, departments, dates, amounts, deadlines, and next steps;
- the final status and any unresolved issue.

Preserve exact names, numbers, dates, ordinance identifiers, resolution identifiers, and vote outcomes when they appear in the transcript.

Give greater emphasis to concrete decisions and outcomes than to repeated procedural remarks. When the segment contains discussion without a decision, describe the discussion and current status accurately.

Use a neutral municipal minutes style. Match the concise reference-summary style expected by this benchmark.

Output only one concise paragraph of approximately 3–6 sentences. Use no title, labels, bullet points, preamble, analysis, or explanation.`;

export const PROMPT_ABLATION_PROMPT_HASH = sha256(MEETINGBANK_REFERENCE_PROMPT);

function unique(values) { return [...new Set(values.filter(value => value !== null && value !== undefined).map(String))]; }

function firstDefined(value, keys, fallback = null) {
  for (const key of keys) if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
  return fallback;
}

function annotationSourceId(annotation) {
  return firstDefined(annotation, ["sourceId", "source_id", "meetingbankId", "meetingbank_id", "meetingId", "meeting_id", "id"], null);
}

function annotationSourceDataset(annotation) {
  return String(firstDefined(annotation, ["sourceDataset", "source_dataset", "dataset"], "MeetingBank"));
}

function annotationSourceText(annotation) {
  return firstDefined(annotation, ["conversation", "transcript", "sourceText", "source_text"], null);
}

async function loadAnnotations(filepath) {
  if (!filepath) throw new Error("prompt ablation requires --annotations <path>");
  const data = await readDatasetFile(filepath);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.meetingbank)) return data.meetingbank;
  if (Array.isArray(data.meeting)) return data.meeting;
  throw new Error("prompt-ablation annotations must be an array or contain a meetingbank array");
}

function meetingBankAnnotationRows(annotations) {
  return annotations.filter(annotation => annotationSourceDataset(annotation).toLowerCase() === "meetingbank");
}

function sampleIdsFromAnnotations(annotations, samples) {
  const selected = [];
  const unmatched = [];
  const selectedSampleIds = new Set();
  for (const [annotationIndex, annotation] of annotations.entries()) {
    if (annotationSourceDataset(annotation).toLowerCase() !== "meetingbank") continue;
    const sourceId = annotationSourceId(annotation);
    if (sourceId === null || sourceId === undefined || sourceId === "") {
      unmatched.push({ annotationIndex, sourceId: null, reason: "missing source ID", candidateSampleIds: [] });
      continue;
    }
    const candidates = samples.filter(sample => unique([sample.id, sample.metadata?.meetingId]).includes(String(sourceId)));
    if (candidates.length === 1 && selectedSampleIds.has(String(candidates[0].id))) {
      unmatched.push({ annotationIndex, sourceId, reason: "duplicate source ID", candidateSampleIds: candidates.map(sample => sample.id) });
    } else if (candidates.length === 1) {
      selected.push({ annotation, annotationIndex, sample: candidates[0] });
      selectedSampleIds.add(String(candidates[0].id));
    }
    else unmatched.push({ annotationIndex, sourceId, reason: candidates.length ? "ambiguous source ID" : "source ID not found", candidateSampleIds: candidates.map(sample => sample.id) });
  }
  return { selected, unmatched };
}

export function buildMeetingBankReferencePrompt(sample) {
  return `${MEETINGBANK_REFERENCE_PROMPT}\n\nTRANSCRIPT:\n${sample?.input ?? ""}`;
}

function qwenModel(model) { return /qwen/iu.test(String(model)); }

function generationSettings(run) {
  const sampling = run?.sampling ?? {};
  return {
    profile: run?.profile ?? "summary_direct",
    contextLength: run?.contextLength ?? sampling.contextLength ?? null,
    think: sampling.think ?? run?.effectiveThink ?? false,
    temperature: sampling.temperature ?? null,
    top_p: sampling.top_p ?? null,
    top_k: sampling.top_k ?? null
  };
}

function sourceModelMetadata(run, model) {
  return run?.modelMetadata?.[model]
    ?? run?.aggregates?.find(row => row.model === model)?.modelMetadata
    ?? run?.results?.find(row => row.model === model)?.modelMetadata
    ?? null;
}

function sourceRowKey(model, sampleId) { return `${model}\u0000${sampleId}`; }

function sourceRows(run) {
  return (run.results ?? []).map(row => ({ ...row, sourceRunId: run.runId, sourceRun: run }));
}

function sourceSettingsMatch(row, expected) {
  if (!row || row.status !== "ok") return false;
  const actual = {
    profile: row.profile ?? expected.profile,
    contextLength: row.contextLength ?? null,
    think: row.effectiveThink ?? row.sampling?.think ?? false,
    temperature: row.sampling?.temperature ?? expected.temperature,
    top_p: row.sampling?.top_p ?? expected.top_p,
    top_k: row.sampling?.top_k ?? expected.top_k
  };
  return stableJson(actual) === stableJson(expected);
}

function modelDigest(run, row, model) {
  return row?.modelDigest ?? row?.modelMetadata?.modelDigest ?? sourceModelMetadata(run, model)?.modelDigest ?? null;
}

function verifyBaselineRows({ samples, models, sourceRuns, expectedSettings }) {
  const rows = new Map();
  const invalid = [];
  for (const run of sourceRuns) for (const row of sourceRows(run)) {
    if (models.includes(row.model)) rows.set(sourceRowKey(row.model, row.sampleId), row);
  }
  for (const model of models) for (const sample of samples) {
    const row = rows.get(sourceRowKey(model, sample.id));
    const reasons = [];
    if (!row) reasons.push("missing saved row");
    if (row && row.inputHash !== sha256(sample.input ?? "")) reasons.push("source hash mismatch");
    if (row && row.promptHash !== sha256(sample.prompt ?? "")) reasons.push("generic prompt hash mismatch");
    if (!sourceSettingsMatch(row, expectedSettings)) reasons.push("generation settings mismatch");
    const rowDigest = row ? modelDigest(row.sourceRun, row, model) : null;
    const sourceDigests = unique(sourceRuns.map(run => sourceModelMetadata(run, model)?.modelDigest).filter(Boolean));
    if (!rowDigest || (sourceDigests.length && sourceDigests.some(digest => digest !== rowDigest))) reasons.push("model digest unavailable or mismatched");
    if (row && reasons.length === 0) {
      rows.set(sourceRowKey(model, sample.id), { ...row, promptVariant: PROMPT_ABLATION_VARIANTS.generic, promptText: sample.prompt, baselineReused: true });
    } else {
      invalid.push({ model, sampleId: sample.id, reasons });
    }
  }
  return { rows, invalid };
}

function baselineRowsForSelection({ samples, models, verified }) {
  return samples.flatMap(sample => models.map(model => {
    const row = verified.rows.get(sourceRowKey(model, sample.id));
    return row ? {
      ...row,
      promptVariant: PROMPT_ABLATION_VARIANTS.generic,
      promptText: row.promptText ?? sample.prompt,
      promptHash: sha256(sample.prompt ?? ""),
      baselineReused: row.baselineReused ?? false
    } : null;
  }).filter(Boolean));
}

function slug(value) { return String(value).replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, "").toLowerCase(); }

function finite(value) { return Number.isFinite(Number(value)); }

export function bootstrapConfidenceInterval(values, { iterations = 2000, seed = 1 } = {}) {
  const finiteValues = values.map(Number).filter(Number.isFinite);
  if (!finiteValues.length) return { lower: null, upper: null, iterations: 0 };
  if (finiteValues.length === 1) return { lower: finiteValues[0], upper: finiteValues[0], iterations: 1 };
  let state = (Number(seed) >>> 0) || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < finiteValues.length; index += 1) total += finiteValues[Math.floor(random() * finiteValues.length)];
    samples.push(total / finiteValues.length);
  }
  return { lower: percentile(samples, 0.025), upper: percentile(samples, 0.975), iterations };
}

function average(values) { return mean(values.map(Number).filter(Number.isFinite)); }

function factAggregate(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const avg = key => average(successful.map(row => row.factScores?.[key] ?? row.scores?.[key]));
  return {
    completenessPercent: avg("completenessPercent"),
    concisenessPercent: avg("concisenessPercent"),
    faithfulnessPercent: avg("faithfulnessPercent"),
    keyFactCount: successful.reduce((sum, row) => sum + Number(row.factScores?.keyFactCount ?? 0), 0),
    matchedKeyFactCount: successful.reduce((sum, row) => sum + Number(row.factScores?.matchedKeyFactCount ?? 0), 0),
    atomicClaimCount: successful.reduce((sum, row) => sum + Number(row.factScores?.atomicClaimCount ?? 0), 0),
    supportedClaimCount: successful.reduce((sum, row) => sum + Number(row.factScores?.supportedClaimCount ?? 0), 0),
    unsupportedClaimCount: successful.reduce((sum, row) => sum + Number(row.factScores?.unsupportedClaimCount ?? 0), 0),
    contradictionCount: successful.reduce((sum, row) => sum + Number(row.factScores?.contradictionCount ?? 0), 0),
    unresolvedJudgeCount: successful.reduce((sum, row) => sum + Number(row.factScores?.unresolvedJudgeCount ?? 0), 0)
  };
}

function ablationAggregate(rows) { return { ...aggregateSampleResults(rows), ...factAggregate(rows) }; }

function aggregateByVariant(rows, models, variants) {
  return models.flatMap(model => variants.map(promptVariant => ({
    model,
    promptVariant,
    aggregate: ablationAggregate(rows.filter(row => row.model === model && row.promptVariant === promptVariant))
  })));
}

function groupAggregates(rows, models, variants, key, valueOf) {
  return models.flatMap(model => variants.flatMap(promptVariant => {
    const groups = new Map();
    for (const row of rows.filter(candidate => candidate.model === model && candidate.promptVariant === promptVariant)) {
      const value = valueOf(row);
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    return [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([value, grouped]) => ({ model, promptVariant, [key]: value, aggregate: ablationAggregate(grouped) }));
  }));
}

function pairedRows(rows, models, sampleIds) {
  return models.flatMap(model => sampleIds.map(sampleId => {
    const generic = rows.find(row => row.model === model && row.sampleId === sampleId && row.promptVariant === PROMPT_ABLATION_VARIANTS.generic);
    const tuned = rows.find(row => row.model === model && row.sampleId === sampleId && row.promptVariant === PROMPT_ABLATION_VARIANTS.meetingBank);
    if (!generic || !tuned) return { model, sampleId, status: "incomplete", generic: generic ?? null, meetingBank: tuned ?? null };
    const delta = key => finite(generic.scores?.[key]) && finite(tuned.scores?.[key]) ? Number(tuned.scores[key]) - Number(generic.scores[key]) : null;
    const factDelta = key => finite(generic.factScores?.[key]) && finite(tuned.factScores?.[key]) ? Number(tuned.factScores[key]) - Number(generic.factScores[key]) : null;
    return {
      model,
      sampleId,
      status: generic.status === "ok" && tuned.status === "ok" ? "complete" : "incomplete",
      generic: { status: generic.status, output: String(generic.output ?? "").slice(0, 2000), outputHash: generic.outputHash, promptHash: generic.promptHash },
      meetingBank: { status: tuned.status, output: String(tuned.output ?? "").slice(0, 2000), outputHash: tuned.outputHash, promptHash: tuned.promptHash },
      rouge1Delta: delta("rouge1"),
      rouge2Delta: delta("rouge2"),
      rougeLDelta: delta("rougeL"),
      completenessDelta: factDelta("completenessPercent"),
      concisenessDelta: factDelta("concisenessPercent"),
      faithfulnessDelta: factDelta("faithfulnessPercent")
    };
  }));
}

function pairedSummaries(pairs, models, seedText) {
  const metrics = ["rouge1Delta", "rouge2Delta", "rougeLDelta", "completenessDelta", "concisenessDelta", "faithfulnessDelta"];
  return models.map(model => {
    const relevant = pairs.filter(row => row.model === model && row.status === "complete");
    const summary = { model, sampleCount: relevant.length };
    for (const metric of metrics) {
      const values = relevant.map(row => row[metric]).filter(finite).map(Number);
      summary[metric] = average(values);
      summary[`${metric}Confidence95`] = bootstrapConfidenceInterval(values, { seed: Number.parseInt(sha256(`${seedText}:${model}:${metric}`).slice(0, 8), 16) });
    }
    return summary;
  });
}

function promptOnlyVerification({ samples, rows, baselineRun, experimentalRun, expectedSettings, models }) {
  const inputHashesMatch = samples.every(sample => rows.filter(row => row.sampleId === sample.id).every(row => row.inputHash === sha256(sample.input ?? "")));
  const sourceSettings = generationSettings(baselineRun);
  const experimentalSettings = generationSettings(experimentalRun);
  const settingsMatch = stableJson(sourceSettings) === stableJson(expectedSettings) && stableJson(experimentalSettings) === stableJson(expectedSettings);
  const digest = Object.fromEntries(models.map(model => {
    const before = sourceModelMetadata(baselineRun, model)?.modelDigest ?? null;
    const after = sourceModelMetadata(experimentalRun, model)?.modelDigest ?? null;
    return [model, { baseline: before, experimental: after, status: before && after ? (before === after ? "match" : "mismatch") : "unavailable" }];
  }));
  const modelDigestsMatch = models.every(model => digest[model]?.status === "match");
  return { inputHashesMatch, settingsMatch, modelDigestsMatch, promptOnlyChange: inputHashesMatch && settingsMatch && modelDigestsMatch, modelDigests: digest, baselineSettings: sourceSettings, experimentalSettings };
}

async function attachFactScores({ rows, factRun, sourceRowsByVariant }) {
  if (!factRun) return rows;
  const factMap = new Map((factRun.results ?? []).map(row => [`${row.sourceRunId}\u0000${row.model}\u0000${row.sampleId}`, row.scores]));
  return rows.map(row => {
    const sourceRunId = sourceRowsByVariant.get(`${row.model}\u0000${row.sampleId}\u0000${row.promptVariant}`) ?? row.sourceRunId;
    const factScores = factMap.get(`${sourceRunId}\u0000${row.model}\u0000${row.sampleId}`) ?? null;
    return factScores ? { ...row, factScores } : row;
  });
}

async function loadOptionalRun(runId, root) {
  if (!runId) return null;
  try { return await loadRun(runId, { root }); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function runPromptAblation({
  datasetPath,
  annotationPath,
  sourceRunIds = ["full-meetingbank-summary-direct-20260913"],
  comparisonRunIds = ["meetingbank-meetingscript-full-20260915"],
  models = null,
  split = "test",
  limit = null,
  smoke = false,
  resume = false,
  runId = null,
  root = process.cwd(),
  baseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST,
  factJudgeModel = null,
  factJudgeProvider = "ollama",
  factJudgeBaseUrl = baseUrl,
  factJudgeTemperature = 0,
  factJudgeMaxOutputTokens = 4096,
  factRunId = null,
  executor = runOllamaChat,
  metadataProvider = readOllamaMetadata,
  fetchImpl,
  now = () => new Date()
} = {}) {
  if (!datasetPath) throw new Error("prompt ablation requires --dataset <meetingbank.jsonl>");
  const sourceIds = unique(Array.isArray(sourceRunIds) ? sourceRunIds : String(sourceRunIds).split(","));
  if (!sourceIds.length) throw new Error("prompt ablation requires at least one generic source run");
  const sourceRuns = await Promise.all(sourceIds.map(id => loadRun(id, { root })));
  const loaded = await loadSuiteSamples({ benchmark: "meetingbank", datasetPath, split });
  const annotations = await loadAnnotations(annotationPath);
  const annotationRows = meetingBankAnnotationRows(annotations);
  const subset = sampleIdsFromAnnotations(annotationRows, loaded.samples);
  const boundedSelection = subset.selected.slice(0, smoke ? 5 : limit === null || limit === undefined ? subset.selected.length : Math.max(0, Number(limit)));
  const samples = boundedSelection.map(item => item.sample);
  const sourceHashMismatches = boundedSelection.flatMap(item => {
    const annotationText = annotationSourceText(item.annotation);
    if (annotationText === null || annotationText === undefined) return [];
    const expected = sha256(annotationText);
    const actual = sha256(item.sample.input ?? "");
    return expected === actual ? [] : [{ annotationIndex: item.annotationIndex, sourceId: annotationSourceId(item.annotation), sampleId: item.sample.id, expected, actual }];
  });
  const expectedSettings = generationSettings(sourceRuns[0]);
  if (expectedSettings.profile !== "summary_direct" || expectedSettings.think !== false) throw new Error("prompt ablation requires the existing summary_direct non-thinking source run");
  if (sourceRuns.some(run => stableJson(generationSettings(run)) !== stableJson(expectedSettings))) throw new Error("generic source runs do not share identical generation settings");
  const configuredModels = models ? unique(Array.isArray(models) ? models : String(models).split(",")) : unique(sourceRuns.flatMap(run => run.models ?? run.results?.map(row => row.model) ?? []).filter(qwenModel));
  if (!configuredModels.length) throw new Error("prompt ablation found no configured Qwen models in the generic source run");
  const initial = verifyBaselineRows({ samples, models: configuredModels, sourceRuns, expectedSettings });
  const id = String(runId ?? `meetingbank-prompt-ablation-${now().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`);
  const generatedGenericRows = [];
  for (const model of configuredModels) {
    const missingIds = initial.invalid.filter(item => item.model === model).map(item => item.sampleId);
    if (!missingIds.length) continue;
    const generated = await runCriterion({
      benchmark: "meetingbank",
      datasetPath,
      split,
      sampleIds: missingIds,
      models: [model],
      profile: expectedSettings.profile,
      contextLength: expectedSettings.contextLength,
      sampling: { temperature: expectedSettings.temperature, top_p: expectedSettings.top_p, top_k: expectedSettings.top_k },
      baseUrl,
      root,
      runId: `${id}-generic-${slug(model)}`,
      resume,
      smoke: false,
      executor,
      metadataProvider,
      fetchImpl,
      promptVariant: PROMPT_ABLATION_VARIANTS.generic,
      promptTemplateHash: sha256("criterion-summary-direct-generic"),
      recordPrompt: true,
      replayCommand: `node command/criterion.mjs prompt-ablation --dataset ${datasetPath} --annotations ${annotationPath} --source-runs ${sourceIds.join(",")} --run-id ${id} --resume`
    });
    generatedGenericRows.push(...generated.results.map(row => ({ ...row, sourceRunId: generated.runId, baselineReused: false, promptVariant: PROMPT_ABLATION_VARIANTS.generic })));
  }
  const verifiedRows = new Map(initial.rows);
  for (const row of generatedGenericRows) verifiedRows.set(sourceRowKey(row.model, row.sampleId), row);
  const genericRows = baselineRowsForSelection({ samples, models: configuredModels, verified: { rows: verifiedRows } }).map(row => ({ ...row, runId: id }));
  const experimentalRunId = `${id}-${PROMPT_ABLATION_VARIANTS.meetingBank}`;
  const experimentalRun = await runCriterion({
    benchmark: "meetingbank",
    datasetPath,
    split,
    sampleIds: samples.map(sample => sample.id),
    models: configuredModels,
    profile: expectedSettings.profile,
    contextLength: expectedSettings.contextLength,
    sampling: { temperature: expectedSettings.temperature, top_p: expectedSettings.top_p, top_k: expectedSettings.top_k },
    baseUrl,
    root,
    runId: experimentalRunId,
    resume,
    smoke: smoke,
    executor,
    metadataProvider,
    fetchImpl,
    promptTransform: buildMeetingBankReferencePrompt,
    promptVariant: PROMPT_ABLATION_VARIANTS.meetingBank,
    promptTemplateHash: PROMPT_ABLATION_PROMPT_HASH,
    recordPrompt: true,
    replayCommand: `node command/criterion.mjs prompt-ablation --dataset ${datasetPath} --annotations ${annotationPath} --source-runs ${sourceIds.join(",")} --run-id ${id} --resume`
  });
  const experimentalRows = experimentalRun.results.map(row => ({ ...row, runId: id, sourceRunId: experimentalRun.runId, promptVariant: PROMPT_ABLATION_VARIANTS.meetingBank }));
  let pairedOutputRows = [...genericRows, ...experimentalRows];
  let factRun = null;
  if (factJudgeModel && samples.length) {
    const factSourceIds = unique([...genericRows.map(row => row.sourceRunId), experimentalRun.runId]);
    factRun = await runFactAudit({
      datasetPath,
      sourceRunIds: factSourceIds,
      sampleIds: samples.map(sample => sample.id),
      split,
      runId: factRunId ?? `${id}-facts`,
      root,
      judgeModel: factJudgeModel,
      judgeProvider: factJudgeProvider,
      judgeBaseUrl: factJudgeBaseUrl,
      judgeTemperature: factJudgeTemperature,
      judgeMaxOutputTokens: factJudgeMaxOutputTokens,
      resume,
      smoke: false,
      fetchImpl
    });
    const sourceRowsByVariant = new Map([...genericRows, ...experimentalRows].map(row => [`${row.model}\u0000${row.sampleId}\u0000${row.promptVariant}`, row.sourceRunId]));
    pairedOutputRows = await attachFactScores({ rows: pairedOutputRows, factRun, sourceRowsByVariant });
  }
  const comparisonRows = [];
  const comparisonRuns = [];
  for (const comparisonId of unique(comparisonRunIds ?? [])) {
    const comparison = await loadOptionalRun(comparisonId, root);
    if (!comparison) continue;
    comparisonRuns.push(comparison);
    for (const sample of samples) {
      const row = comparison.results?.find(candidate => candidate.sampleId === sample.id && candidate.status === "ok");
      if (!row) continue;
      comparisonRows.push({ ...row, runId: id, sourceRunId: comparison.runId, promptVariant: "meetingscript_reference", comparisonOnly: true, promptText: sample.prompt });
    }
  }
  const allRows = [...pairedOutputRows];
  const pairs = pairedRows(allRows, configuredModels, samples.map(sample => sample.id));
  const runStartedAt = now().toISOString();
  const run = await writeRunArtifacts({
    runId: id,
    criterion: "meetingbank-prompt-ablation",
    suite: { key: "meetingbank-prompt-ablation", name: "MeetingBank Qwen prompt ablation", version: "prompt-ablation-v1", sourceUrls: ["https://meetingbank.github.io/dataset/", "https://github.com/zhouweixiao/OmniCSEval"], licenseUrls: ["https://meetingbank.github.io/license/"] },
    benchmark: "MeetingBank",
    experiment: "prompt-ablation",
    evaluationMode: "paired-zero-shot-prompt-ablation",
    promptVariants: Object.values(PROMPT_ABLATION_VARIANTS),
    status: subset.unmatched.length || sourceHashMismatches.length || allRows.some(row => row.status === "error") ? "partial" : "completed",
    split,
    actualSplit: loaded.actualSplit,
    datasetRevision: process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned",
    datasetHash: loaded.datasetHash ?? null,
    datasetPath,
    ollamaBaseUrl: baseUrl ?? null,
    annotationPath,
    annotationHash: sha256(await fs.readFile(annotationPath)),
    annotationCount: annotationRows.length,
    matchedSubsetCount: subset.selected.length,
    selectedSampleCount: samples.length,
    models: configuredModels,
    sourceRunIds: sourceIds,
    baselineSourceRunIds: sourceIds,
    experimentalRunId,
    factRunId: factRun?.runId ?? null,
    engine: "ollama",
    profile: expectedSettings.profile,
    sampling: { ...expectedSettings, think: false },
    contextLength: expectedSettings.contextLength,
    sourceVerification: promptOnlyVerification({ samples, rows: allRows, baselineRun: sourceRuns[0], experimentalRun, expectedSettings, models: configuredModels }),
    subsetJoins: { matched: boundedSelection.map(item => ({ annotationIndex: item.annotationIndex, sourceId: annotationSourceId(item.annotation), sampleId: item.sample.id })), unmatched: subset.unmatched },
    baselineVerification: initial.invalid,
    sourceHashMismatches: initial.invalid.filter(item => item.reasons.includes("source hash mismatch")),
    annotationSourceHashMismatches: sourceHashMismatches,
    results: allRows,
    comparisonRows,
    comparisonRuns: comparisonRuns.map(comparison => comparison.runId),
    aggregates: aggregateByVariant(allRows, configuredModels, Object.values(PROMPT_ABLATION_VARIANTS)),
    comparisonAggregates: comparisonRuns.flatMap(comparison => comparison.models?.map(model => ({ model, promptVariant: "meetingscript_reference", sourceRunId: comparison.runId, aggregate: ablationAggregate(comparisonRows.filter(row => row.model === model)) })) ?? []),
    pairedResults: pairs,
    pairedAggregates: pairedSummaries(pairs, configuredModels, id),
    groupAggregates: {
      city: groupAggregates(allRows, configuredModels, Object.values(PROMPT_ABLATION_VARIANTS), "city", row => row.metadata?.city ?? "unspecified"),
      itemType: groupAggregates(allRows, configuredModels, Object.values(PROMPT_ABLATION_VARIANTS), "itemType", row => row.metadata?.type ?? "unspecified"),
      chunking: groupAggregates(allRows, configuredModels, Object.values(PROMPT_ABLATION_VARIANTS), "chunking", row => row.metadata?.chunked ? "chunked" : "single")
    },
    promptTemplates: {
      [PROMPT_ABLATION_VARIANTS.generic]: { text: "Existing Criterion summary_direct prompt from the saved source run; reconstructed from the current dataset sample prompt.", hash: sha256("criterion-summary-direct-generic") },
      [PROMPT_ABLATION_VARIANTS.meetingBank]: { text: MEETINGBANK_REFERENCE_PROMPT, hash: PROMPT_ABLATION_PROMPT_HASH }
    },
    examples: {
      improved: pairs.filter(row => row.status === "complete").sort((a, b) => Number(b.rougeLDelta ?? -Infinity) - Number(a.rougeLDelta ?? -Infinity)).slice(0, 3),
      degraded: pairs.filter(row => row.status === "complete").sort((a, b) => Number(a.rougeLDelta ?? Infinity) - Number(b.rougeLDelta ?? Infinity)).slice(0, 3)
    },
    createdAt: runStartedAt,
    startedAt: runStartedAt,
    finishedAt: now().toISOString(),
    runScope: smoke ? "smoke" : "full",
    smoke,
    replayCommand: `node command/criterion.mjs prompt-ablation --dataset ${datasetPath} --annotations ${annotationPath} --source-runs ${sourceIds.join(",")} --run-id ${id} --resume`,
    totalWallClockMs: 0
  }, { root });
  return run;
}
