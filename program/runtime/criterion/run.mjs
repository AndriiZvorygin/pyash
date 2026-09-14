import fs from "node:fs/promises";
import path from "node:path";

import { loadSuiteSamples } from "./datasets.mjs";
import { collectMachineMetadata } from "./machine.mjs";
import { aggregateSampleResults, compareExpectedFacts, contextLengthBucket, parseJsonOutput, rougeScores, sha256, stripThinking, tokenize } from "./metrics.mjs";
import { DEFAULT_PROFILES, readOllamaMetadata, runOllamaChat, resolveProfile } from "./ollama.mjs";
import { loadRun, writeRunArtifacts } from "./report.mjs";

export const DEFAULT_MODELS = Object.freeze([
  "qwen3.5:9b",
  "hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M"
]);

function normalizeModels(models) {
  if (Array.isArray(models) && models.length) return models.map(String).filter(Boolean);
  const fromEnv = String(process.env.PYA_CRITERION_MODELS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : [...DEFAULT_MODELS];
}

function estimateContextTokens(sample) {
  return tokenize(sample.input ?? sample.prompt ?? "").length;
}

function structuredHelpOSScore(sample, output) {
  const expected = sample.expected && typeof sample.expected === "object" ? sample.expected : null;
  const wantsStructured = Boolean(expected?.format === "json" || expected?.structured || sample.structured);
  const parsed = wantsStructured ? parseJsonOutput(output) : { valid: true, value: null };
  const facts = compareExpectedFacts(sample.expectedFacts ?? [], output);
  const required = expected?.requiredProvenanceFields ?? ["transcriptHash", "meetingReference", "sectionId", "sourceRole", "sourceClass", "generatingStage"];
  const provenance = parsed.value && typeof parsed.value === "object"
    ? required.filter(field => parsed.value[field] !== undefined && parsed.value[field] !== null && parsed.value[field] !== "").length / Math.max(1, required.length)
    : (wantsStructured ? 0 : null);
  return {
    ...(sample.reference ? rougeScores(sample.reference, output) : { rouge1: null, rouge2: null, rougeL: null }),
    ...facts,
    schemaValidity: wantsStructured ? (parsed.valid ? 1 : 0) : 1,
    provenanceValidity: provenance,
    unsupportedClaimCount: Number(expected?.unsupportedClaimCount ?? 0),
    malformedOutput: wantsStructured && !parsed.valid
  };
}

function referenceRougeScores(reference, output) {
  return reference ? rougeScores(reference, output) : { rouge1: null, rouge2: null, rougeL: null };
}

function queryRelevanceScore(query, output) {
  const queryTokens = [...new Set(tokenize(query))];
  const outputTokens = new Set(tokenize(output));
  if (!queryTokens.length) return null;
  return queryTokens.filter(token => outputTokens.has(token)).length / queryTokens.length;
}

export function scoreSample({ suiteKey, sample, output }) {
  if (suiteKey === "longbench" || suiteKey === "mmlu-pro" || suiteKey === "gpqa") {
    return { accuracy: output ? (stripThinking(output).match(/\b([ABCD])\b/i)?.[1]?.toUpperCase() === sample.expectedAnswer.toUpperCase() ? 1 : 0) : 0, schemaValidity: output ? 1 : 0 };
  }
  if (suiteKey === "helpos-local") return structuredHelpOSScore(sample, output);
  if (suiteKey === "qmsum") {
    return {
      ...referenceRougeScores(sample.reference, output),
      queryRelevance: queryRelevanceScore(sample.query, output),
      answerLength: tokenize(output).length,
      schemaValidity: output ? 1 : 0
    };
  }
  return { ...referenceRougeScores(sample.reference, output), schemaValidity: output ? 1 : 0 };
}

function scoreInstructionSample(sample, output) {
  const text = stripThinking(output);
  const ids = sample.instructionIds ?? [];
  const checks = ids.map((id, index) => {
    const lower = String(id).toLowerCase();
    if (lower.includes("json")) return { id, pass: parseJsonOutput(text).valid };
    if (lower.includes("list")) return { id, pass: /^\s*(?:[-*]|\d+[.)])\s+/mu.test(text) };
    if (lower.includes("length") && sample.kwargs?.[index]?.num_words) return { id, pass: tokenize(text).length <= Number(sample.kwargs[index].num_words) };
    return { id, pass: text.trim().length > 0 };
  });
  const passed = checks.filter(check => check.pass).length;
  return {
    promptAccuracy: checks.length && passed === checks.length ? 1 : 0,
    instructionAccuracy: checks.length ? passed / checks.length : (text.trim() ? 1 : 0),
    instructionChecks: checks,
    schemaValidity: 1
  };
}

export function scoreBenchmarkSample({ suiteKey, sample, output }) {
  if (suiteKey === "ifeval") return scoreInstructionSample(sample, output);
  return scoreSample({ suiteKey, sample, output });
}

function passForScores(scores) {
  if (scores.accuracy !== undefined) return scores.accuracy === 1;
  if (scores.instructionAccuracy !== undefined) return scores.promptAccuracy === 1 && scores.instructionAccuracy === 1;
  if (scores.factualAccuracy !== undefined && scores.factualAccuracy !== null) return scores.factualAccuracy === 1 && scores.schemaValidity === 1 && !scores.malformedOutput;
  return null;
}

async function loadResumedRows(filepath) {
  try {
    const text = await fs.readFile(filepath, "utf8");
    return text.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function rowKey(row) { return `${row.model}\u0000${row.sampleId}\u0000${row.profile}\u0000${row.contextLength}`; }

function groupedAggregates(results, models, groupKey) {
  return models.flatMap(model => {
    const groups = new Map();
    for (const row of results.filter(candidate => candidate.model === model)) {
      const value = row.metadata?.[groupKey] ?? "unspecified";
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    return [...groups.entries()].sort(([left], [right]) => String(left).localeCompare(String(right))).map(([group, rows]) => ({ model, [groupKey]: group, aggregate: aggregateSampleResults(rows) }));
  });
}

function macroAggregates(groups, models, groupKey) {
  return models.map(model => {
    const rows = groups.filter(row => row.model === model);
    const average = key => {
      const values = rows.map(row => Number(row.aggregate?.[key])).filter(Number.isFinite);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    return {
      model,
      [groupKey]: "macro-average",
      aggregate: {
        groupCount: rows.length,
        rouge1: average("rouge1"),
        rouge2: average("rouge2"),
        rougeL: average("rougeL"),
        averageLatencyMs: average("averageLatencyMs"),
        qualityPerSecond: average("qualityPerSecond"),
        failureCount: rows.reduce((sum, row) => sum + row.aggregate.failureCount, 0)
      }
    };
  });
}

function replaySource({ datasetPath, fixtureRoot }) {
  return datasetPath ? `--dataset ${datasetPath}` : `--fixtures ${fixtureRoot ?? "<fixtures>"}`;
}

function buildSuiteMetadata(key, catalog) {
  return {
    name: catalog.name,
    version: catalog.version,
    sourceUrls: [catalog.sourceUrl, catalog.utilityUrl, catalog.mirrorUrl, catalog.taskSourceUrl, catalog.v2SourceUrl].filter(Boolean),
    licenseUrls: [catalog.licenseUrl].filter(Boolean),
    key
  };
}

export async function runCriterion({
  benchmark,
  datasetPath,
  fixtureRoot,
  fixtureId,
  split = "test",
  limit = null,
  models,
  profile = "summary_direct",
  contextLength,
  sampling = {},
  baseUrl,
  runId = null,
  root = process.cwd(),
  datasetRevision = process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned",
  machine,
  executor = runOllamaChat,
  metadataProvider = readOllamaMetadata,
  ifevalVerifierCommand = process.env.PYA_IFEVAL_VERIFIER ?? null,
  ifevalVerifierArgs = [],
  fetchImpl,
  resume = false,
  signal,
  mode = "criterion",
  scenario = null,
  nightmare = null,
  smoke = false,
  onEvent = null,
  now = () => new Date()
} = {}) {
  const loaded = await loadSuiteSamples({ benchmark, datasetPath, fixtureRoot, fixtureId, split });
  const suiteKey = loaded.key;
  const selectedSamples = limit === null || limit === undefined ? loaded.samples : loaded.samples.slice(0, Math.max(0, Number(limit)));
  const resolvedProfile = resolveProfile(profile, { ...sampling, contextLength });
  const resolvedContextLength = Number(resolvedProfile.contextLength);
  const resolvedModels = normalizeModels(models);
  const id = String(runId ?? `${suiteKey}-${now().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}-${sha256(`${suiteKey}:${now().toISOString()}`).slice(0, 8)}`);
  const runStartedAt = now().toISOString();
  const outputJsonl = path.resolve(root, "criterion", "results", `${id}.jsonl`);
  const prior = resume ? await loadResumedRows(outputJsonl) : [];
  const completed = new Map(prior.filter(row => row.status === "ok" || row.status === "skipped").map(row => [rowKey(row), row]));
  const results = prior.filter(row => completed.has(rowKey(row)));
  const emit = (event, fields = {}) => { if (typeof onEvent === "function") onEvent({ event, runId: id, benchmark: suiteKey, ...fields }); };
  const persistRows = async () => {
    await fs.mkdir(path.dirname(outputJsonl), { recursive: true });
    await fs.writeFile(outputJsonl, `${results.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
  };
  emit("started", { models: resolvedModels, sampleCount: selectedSamples.length, profile, contextLength: resolvedContextLength });

  const machineInfo = typeof machine === "string"
    ? { ...(await collectMachineMetadata()), name: machine }
    : machine ?? await collectMachineMetadata();
  const modelMetadata = {};
  for (const model of resolvedModels) {
    modelMetadata[model] = await metadataProvider({ model, baseUrl, fetchImpl });
  }

  for (const model of resolvedModels) {
    for (const sample of selectedSamples) {
      const key = rowKey({ model, sampleId: sample.id, profile, contextLength: resolvedContextLength });
      if (completed.has(key)) {
        emit("resumed", { model, sampleId: sample.id });
        continue;
      }
      const startedAt = now().toISOString();
      const contextTokens = sample.contextLength ?? estimateContextTokens(sample);
      const base = {
        runId: id,
        benchmark: suiteKey,
        model,
        modelDigest: modelMetadata[model]?.modelDigest ?? null,
        quantization: modelMetadata[model]?.quantization ?? null,
        profile,
        contextLength: resolvedContextLength,
        effectiveThink: Boolean(resolvedProfile.think),
        reasoningMode: resolvedProfile.reasoningMode ?? null,
        sampleId: sample.id,
        reference: sample.reference ?? "",
        relevantTextSpan: sample.metadata?.relevantTextSpan ?? null,
        inputHash: sha256(sample.input ?? sample.prompt ?? ""),
        promptHash: sha256(sample.prompt ?? ""),
        inputTokens: tokenize(sample.input ?? sample.prompt ?? "").length,
        contextLengthBucket: contextLengthBucket(contextTokens),
        startedAt,
        metadata: { ...(sample.metadata ?? {}), referenceAvailable: sample.metadata?.referenceAvailable ?? Boolean(sample.reference) },
        provenance: {
          benchmark: suiteKey,
          datasetHash: loaded.datasetHash ?? null,
          datasetRevision,
          split: loaded.actualSplit,
          sampleId: sample.id,
          source: sample.metadata?.source ?? null,
          reference: sample.metadata?.referenceProvenance ?? null
        }
      };
      if ((suiteKey === "longbench" || suiteKey === "longbench-summary") && contextTokens > resolvedContextLength) {
        const skipped = { ...base, status: "skipped", skipReason: `context length ${contextTokens} exceeds configured ${resolvedContextLength}`, contextTokens, finishedAt: now().toISOString() };
        results.push(skipped); completed.set(key, skipped); emit("skipped", { model, sampleId: sample.id, reason: skipped.skipReason }); await persistRows(); continue;
      }
      if (!sample.prompt || !sample.input) {
        const malformed = { ...base, status: "error", output: "", outputHash: sha256(""), scores: {}, metrics: {}, error: "malformed benchmark row: transcript/input or prompt is missing", finishedAt: now().toISOString() };
        results.push(malformed); completed.set(key, malformed); emit("sample-failed", { model, sampleId: sample.id, error: malformed.error });
        await persistRows();
        continue;
      }
      emit("sample-started", { model, sampleId: sample.id });
      try {
        const response = await executor({ model, prompt: sample.prompt, profile, contextLength: resolvedContextLength, sampling, baseUrl, fetchImpl, sample, signal });
        const output = String(response?.text ?? "");
        let scores = scoreBenchmarkSample({ suiteKey, sample, output });
        if (suiteKey === "ifeval" && ifevalVerifierCommand) {
          scores = { ...scores, ...(await runIfevalVerifier({ command: ifevalVerifierCommand, args: ifevalVerifierArgs, sample, output })) };
        }
        const pass = passForScores(scores);
        const row = {
          ...base,
          status: "ok",
          output,
          outputHash: sha256(output),
          reasoningTokens: response?.timing?.reasoningTokens ?? null,
          effectiveThink: response?.effectiveThink ?? Boolean(resolvedProfile.think),
          reasoningMode: response?.reasoningMode ?? resolvedProfile.reasoningMode ?? null,
          timingRaw: {
            prompt_eval_count: response?.payload?.prompt_eval_count ?? null,
            prompt_eval_duration: response?.payload?.prompt_eval_duration ?? null,
            eval_count: response?.payload?.eval_count ?? null,
            eval_duration: response?.payload?.eval_duration ?? null,
            total_duration: response?.payload?.total_duration ?? null
          },
          pass,
          scores,
          metrics: response?.timing ?? {},
          provider: { ollamaVersion: modelMetadata[model]?.ollamaVersion ?? null },
          finishedAt: response?.finishedAt ?? now().toISOString()
        };
        results.push(row); completed.set(key, row); emit("sample-completed", { model, sampleId: sample.id, scores, metrics: row.metrics });
      } catch (error) {
        const row = { ...base, status: "error", output: "", outputHash: sha256(""), scores: {}, metrics: {}, error: error?.message ?? String(error), finishedAt: now().toISOString() };
        results.push(row); completed.set(key, row); emit("sample-failed", { model, sampleId: sample.id, error: row.error });
      }
      // Keep a restart-safe partial record after every model/sample boundary.
      await persistRows();
    }
  }

  const aggregates = resolvedModels.map(model => ({
    model,
    modelMetadata: modelMetadata[model],
    aggregate: aggregateSampleResults(results.filter(row => row.model === model))
  }));
  const evaluationAggregates = ["meetingbank", "qmsum"].includes(suiteKey)
    ? groupedAggregates(results, resolvedModels, "evaluationMode")
    : [];
  const taskAggregates = suiteKey === "longbench-summary" ? groupedAggregates(results, resolvedModels, "task") : [];
  const finishedAt = now().toISOString();
  const finalRun = await writeRunArtifacts({
    runId: id,
    criterion: suiteKey,
    suite: buildSuiteMetadata(suiteKey, loaded.catalog),
    status: results.some(row => row.status === "error") ? "partial" : "completed",
    split,
    actualSplit: loaded.actualSplit,
    availableSplits: loaded.availableSplits,
    datasetRevision,
    datasetHash: loaded.datasetHash ?? null,
    models: resolvedModels,
    profile,
    sampling: { ...resolvedProfile, ...sampling },
    contextLength: resolvedContextLength,
    machine: machineInfo,
    mode,
    smoke,
    runScope: smoke ? "smoke" : "full",
    scenario,
    nightmare,
    createdAt: runStartedAt,
    startedAt: runStartedAt,
    finishedAt,
    totalWallClockMs: Math.max(0, new Date(finishedAt).getTime() - new Date(runStartedAt).getTime()),
    datasetPath: datasetPath ?? null,
    fixtureRoot: fixtureRoot ?? null,
    replayCommand: `node command/criterion.mjs run --benchmark ${suiteKey} ${replaySource({ datasetPath, fixtureRoot })} --run-id ${id} --resume`,
    results,
    aggregates,
    evaluationAggregates,
    taskAggregates,
    taskMacroAggregates: taskAggregates.length ? macroAggregates(taskAggregates, resolvedModels, "task") : [],
    modelMetadata
  }, { root });
  emit("finished", { status: finalRun.status, aggregates });
  return finalRun;
}

export async function rerunCriterion(runId, options = {}) {
  const prior = await loadRun(runId, { root: options.root ?? process.cwd() });
  return runCriterion({
    ...options,
    benchmark: options.benchmark ?? prior.criterion,
    datasetPath: options.datasetPath ?? prior.datasetPath,
    fixtureRoot: options.fixtureRoot ?? prior.fixtureRoot,
    models: options.models ?? prior.models,
    profile: options.profile ?? prior.profile ?? "summary_direct",
    split: options.split ?? prior.split ?? "test",
    datasetRevision: options.datasetRevision ?? prior.datasetRevision,
    contextLength: options.contextLength ?? prior.contextLength,
    sampling: options.sampling ?? prior.sampling,
    limit: options.limit ?? ((options.smoke ?? prior.smoke) ? 1 : null),
    runId,
    resume: true,
    smoke: options.smoke ?? prior.smoke ?? false
  });
}

export function getProfile(name) { return DEFAULT_PROFILES[name] ?? null; }
