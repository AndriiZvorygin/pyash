#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { SUITE_CATALOG, readDatasetFile } from "../program/runtime/criterion/datasets.mjs";
import { runBaseline } from "../program/runtime/criterion/baseline-run.mjs";
import { createHuggingFaceExecutor } from "../program/runtime/criterion/huggingface.mjs";
import { runCriterion, rerunCriterion } from "../program/runtime/criterion/run.mjs";
import { runNightmare, runReverie } from "../program/runtime/criterion/suites.mjs";
import { loadRun, renderComparison, renderRunMarkdown } from "../program/runtime/criterion/report.mjs";
import { DEFAULT_PROFILES } from "../program/runtime/criterion/ollama.mjs";
import { stableJson } from "../program/runtime/criterion/metrics.mjs";
import { FACT_EVALUATION_MODES, FACT_JUDGE_PROMPT_VERSION, FACT_SCORER_VERSION, runFactAudit } from "../program/runtime/criterion/fact-audit.mjs";
import { runPromptAblation } from "../program/runtime/criterion/prompt-ablation.mjs";
import { runMeetingBankJudgePilot, MEETINGBANK_JUDGE_PILOT_MODELS } from "../program/runtime/criterion/judge-pilot.mjs";

function flag(args, name, fallback = null) {
  const prefix = `${name}=`;
  const index = args.findIndex(value => value === name || value.startsWith(prefix));
  if (index < 0) return fallback;
  return args[index].startsWith(prefix) ? args[index].slice(prefix.length) : args[index + 1] ?? fallback;
}

function hasFlag(args, name) { return args.includes(name) || args.some(value => value.startsWith(`${name}=`)); }

function listFlag(args, names) {
  const values = [];
  for (const name of names) {
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index];
      if (value === name && args[index + 1]) values.push(args[index + 1]);
      else if (value.startsWith(`${name}=`)) values.push(value.slice(name.length + 1));
    }
  }
  return values.flatMap(value => String(value).split(",")).map(value => value.trim()).filter(Boolean);
}

function numericFlag(args, name, fallback = null) {
  const value = flag(args, name, null);
  if (value === null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positional(args) { return args.filter(value => !value.startsWith("--") && !args.some((flagName, index) => flagName.startsWith("--") && args[index + 1] === value)); }

function baseOptions(args, root) {
  const benchmark = flag(args, "--benchmark", positional(args)[0] ?? null);
  const models = String(flag(args, "--model", "") ?? "").split(",").map(value => value.trim()).filter(Boolean);
  return {
    benchmark,
    datasetPath: flag(args, "--dataset"),
    fixtureRoot: flag(args, "--fixtures"),
    fixtureId: flag(args, "--fixture"),
    split: flag(args, "--split", "test"),
    datasetRevision: flag(args, "--dataset-revision", process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned"),
    limit: hasFlag(args, "--smoke") ? 1 : numericFlag(args, "--limit"),
    models: models.length ? models : undefined,
    profile: flag(args, "--profile", "summary_direct"),
    engine: flag(args, "--engine", "ollama"),
    contextLength: numericFlag(args, "--context-length"),
    sampling: {
      ...(numericFlag(args, "--temperature") === null ? {} : { temperature: numericFlag(args, "--temperature") }),
      ...(numericFlag(args, "--top-p") === null ? {} : { top_p: numericFlag(args, "--top-p") }),
      ...(numericFlag(args, "--top-k") === null ? {} : { top_k: numericFlag(args, "--top-k") })
    },
    baseUrl: flag(args, "--ollama-base-url", process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST),
    machine: flag(args, "--machine"),
    ifevalVerifierCommand: flag(args, "--ifeval-verifier", process.env.PYA_IFEVAL_VERIFIER ?? null),
    ifevalVerifierArgs: String(flag(args, "--ifeval-verifier-args", "") ?? "").split(" ").filter(Boolean),
    runId: flag(args, "--run-id"),
    gpuHousekeeperUrl: flag(args, "--gpu-housekeeper-url", process.env.PYA_GPU_HOUSEKEEPER_URL ?? null),
    criterionGpuId: flag(args, "--gpu-id", process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0"),
    huggingFaceRevision: flag(args, "--huggingface-revision", process.env.PYA_HUGGINGFACE_REVISION ?? null),
    huggingFaceDtype: flag(args, "--huggingface-dtype", process.env.PYA_HF_DTYPE ?? "auto"),
    root,
    resume: hasFlag(args, "--resume"),
    smoke: hasFlag(args, "--smoke")
  };
}

function print(value, json = false) {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);
}

function usage() {
  return [
    "criterion list",
    "criterion inspect --benchmark <name>",
    "criterion run --benchmark <name> --dataset <local.jsonl> [--engine ollama|huggingface] [--model <a,b>] [--profile summary_direct|summary_reasoned|summary_reasoned_hidden] [--split train|validation|test] [--smoke] [--resume]",
    "criterion baseline --benchmark meetingbank --dataset <local.jsonl> --baseline lead-3 [--resume]",
    "criterion fact-audit --dataset <meetingbank.jsonl> --source-runs <run-id,...> --judge-model <external-model> [--limit 5] [--resume]",
    "criterion omnicseval-meeting --dataset <meetingbank.jsonl> --annotations <annotations.jsonl> --source-runs <run-id,...> --judge-model <external-model> [--resume]",
    "criterion prompt-ablation --dataset <meetingbank.jsonl> --annotations <annotations.json> --source-run <generic-run-id> [--model <qwen,...>] [--smoke] [--resume]",
    "criterion meetingbank-judge-pilot --dataset <meetingbank.jsonl> [--model <qwen,...>] [--smoke] [--resume]",
    "criterion report <run-id>",
    "criterion again <run-id>",
    "criterion compare <run-id> [<run-id> ...]",
    "criterion golden <run-id> [--golden <path>] [--write]",
    "nightmare run|soak|stress --benchmark <name> --dataset <path>",
    "reverie run --benchmark helpos-local --fixtures <path> --response <text>"
  ].join("\n");
}

async function listCommand(args) {
  const rows = Object.entries(SUITE_CATALOG).map(([key, value]) => ({ key, ...value }));
  if (hasFlag(args, "--json")) print(rows, true);
  else print(rows.map(row => `${row.key}: ${row.name} (${row.version})`).join("\n"));
  return 0;
}

async function inspectCommand(args) {
  const name = flag(args, "--benchmark", positional(args)[0]);
  const key = String(name ?? "").toLowerCase().replace(/[_ ]/gu, "-");
  const catalog = SUITE_CATALOG[key];
  if (!catalog) throw new Error(`unknown criterion suite: ${name}`);
  const result = { key, ...catalog, profiles: DEFAULT_PROFILES };
  print(result, true);
  return 0;
}

async function runCommand(args, root) {
  const options = baseOptions(args, root);
  let result;
  if (options.engine === "huggingface") {
    const adapter = await createHuggingFaceExecutor({
      root,
      runId: options.runId ?? `${options.benchmark ?? "criterion"}-${Date.now()}`,
      housekeeperUrl: options.gpuHousekeeperUrl,
      gpuId: options.criterionGpuId,
      revision: options.huggingFaceRevision,
      dtype: options.huggingFaceDtype
    });
    try {
      result = await runCriterion({ ...options, engine: "huggingface", executor: adapter.executor, metadataProvider: adapter.metadataProvider });
    } finally {
      await adapter.close();
    }
  } else {
    result = await runCriterion(options);
  }
  print({ runId: result.runId, status: result.status, results: `criterion/results/${result.runId}.jsonl`, report: `criterion/results/${result.runId}.md`, csv: `criterion/results/${result.runId}.csv`, review: `criterion/review/${result.runId}.html` }, hasFlag(args, "--json"));
  return result.status === "partial" && hasFlag(args, "--strict") ? 1 : 0;
}

async function baselineCommand(args, root) {
  const options = baseOptions(args, root);
  const result = await runBaseline({ ...options, baseline: flag(args, "--baseline", "lead-3") });
  print({ runId: result.runId, status: result.status, results: `criterion/results/${result.runId}.jsonl`, report: `criterion/results/${result.runId}.md`, csv: `criterion/results/${result.runId}.csv`, review: `criterion/review/${result.runId}.html` }, hasFlag(args, "--json"));
  return result.status === "partial" && hasFlag(args, "--strict") ? 1 : 0;
}

async function factAuditCommand(args, root, forcedMode = null) {
  const mode = forcedMode ?? flag(args, "--mode", FACT_EVALUATION_MODES.automatedProxy);
  const sourceRuns = listFlag(args, ["--source-runs", "--source-run"]);
  const result = await runFactAudit({
    mode,
    datasetPath: flag(args, "--dataset"),
    annotationPath: flag(args, "--annotations"),
    sourceRunIds: sourceRuns,
    split: flag(args, "--split", "test"),
    limit: hasFlag(args, "--smoke") ? 5 : numericFlag(args, "--limit"),
    runId: flag(args, "--run-id"),
    root,
    judgeModel: flag(args, "--judge-model", process.env.PYA_CRITERION_FACT_JUDGE_MODEL ?? null),
    judgeProvider: flag(args, "--judge-provider", process.env.PYA_CRITERION_FACT_JUDGE_PROVIDER ?? "ollama"),
    judgeBaseUrl: flag(args, "--judge-base-url", flag(args, "--ollama-base-url", process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST)),
    judgeTemperature: numericFlag(args, "--judge-temperature", 0),
    judgeMaxOutputTokens: numericFlag(args, "--judge-max-output-tokens", 4096),
    judgePromptVersion: flag(args, "--judge-prompt-version", FACT_JUDGE_PROMPT_VERSION),
    factScorerVersion: flag(args, "--fact-scorer-version", FACT_SCORER_VERSION),
    datasetRevision: flag(args, "--dataset-revision", process.env.PYA_CRITERION_DATASET_REVISION ?? "local-unpinned"),
    resume: hasFlag(args, "--resume"),
    smoke: hasFlag(args, "--smoke")
  });
  print({
    runId: result.runId,
    status: result.status,
    evaluationMode: result.evaluationMode,
    results: `criterion/results/${result.runId}.jsonl`,
    report: `criterion/results/${result.runId}.md`,
    csv: `criterion/results/${result.runId}.csv`,
    pya: `criterion/results/${result.runId}.pya`,
    json: `criterion/results/${result.runId}.json`,
    review: `criterion/review/${result.runId}.html`,
    matchedJoins: result.matchedJoins?.length ?? 0,
    unmatchedJoins: result.unmatchedJoins.length,
    sourceHashMismatches: result.sourceHashMismatches.length
  }, hasFlag(args, "--json"));
  return result.status === "partial" && hasFlag(args, "--strict") ? 1 : 0;
}

async function promptAblationCommand(args, root) {
  const sourceRuns = listFlag(args, ["--source-runs", "--source-run"]);
  const comparisonRuns = listFlag(args, ["--comparison-runs", "--comparison-run"]);
  const models = listFlag(args, ["--model"]);
  const ollamaBaseUrl = flag(args, "--ollama-base-url", process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST);
  const result = await runPromptAblation({
    datasetPath: flag(args, "--dataset"),
    annotationPath: flag(args, "--annotations"),
    sourceRunIds: sourceRuns.length ? sourceRuns : undefined,
    comparisonRunIds: comparisonRuns.length ? comparisonRuns : undefined,
    models: models.length ? models : null,
    split: flag(args, "--split", "test"),
    limit: hasFlag(args, "--smoke") ? 5 : numericFlag(args, "--limit"),
    smoke: hasFlag(args, "--smoke"),
    resume: hasFlag(args, "--resume"),
    runId: flag(args, "--run-id"),
    root,
    baseUrl: ollamaBaseUrl,
    factJudgeModel: flag(args, "--fact-judge-model", process.env.PYA_CRITERION_FACT_JUDGE_MODEL ?? null),
    factJudgeProvider: flag(args, "--fact-judge-provider", process.env.PYA_CRITERION_FACT_JUDGE_PROVIDER ?? "ollama"),
    factJudgeBaseUrl: flag(args, "--fact-judge-base-url", ollamaBaseUrl),
    factJudgeTemperature: numericFlag(args, "--fact-judge-temperature", 0),
    factJudgeMaxOutputTokens: numericFlag(args, "--fact-judge-max-output-tokens", 4096),
    factRunId: flag(args, "--fact-run-id")
  });
  print({
    runId: result.runId,
    status: result.status,
    evaluationMode: result.evaluationMode,
    promptVariants: result.promptVariants,
    matchedSubsetCount: result.matchedSubsetCount,
    selectedSampleCount: result.selectedSampleCount,
    results: `criterion/results/${result.runId}.jsonl`,
    report: `criterion/results/${result.runId}.md`,
    csv: `criterion/results/${result.runId}.csv`,
    pya: `criterion/results/${result.runId}.pya`,
    json: `criterion/results/${result.runId}.json`,
    review: `criterion/review/${result.runId}.html`
  }, hasFlag(args, "--json"));
  return result.status === "partial" && hasFlag(args, "--strict") ? 1 : 0;
}

async function meetingBankJudgePilotCommand(args, root) {
  const models = listFlag(args, ["--model"]);
  const result = await runMeetingBankJudgePilot({
    root,
    datasetPath: flag(args, "--dataset"),
    split: flag(args, "--split", "test"),
    runId: flag(args, "--run-id"),
    models: models.length ? models : MEETINGBANK_JUDGE_PILOT_MODELS,
    selectionSeed: flag(args, "--selection-seed"),
    selectionCount: numericFlag(args, "--selection-count", 10),
    profile: flag(args, "--profile", "summary_direct"),
    contextLength: numericFlag(args, "--context-length"),
    baseUrl: flag(args, "--ollama-base-url", process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? "http://mriczo:11434"),
    gpuHousekeeperUrl: flag(args, "--gpu-housekeeper-url", process.env.PYA_GPU_HOUSEKEEPER_URL ?? null),
    gpuId: flag(args, "--gpu-id", process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0"),
    huggingFaceRevision: flag(args, "--huggingface-revision", process.env.PYA_HUGGINGFACE_REVISION ?? null),
    huggingFaceDtype: flag(args, "--huggingface-dtype", process.env.PYA_HF_DTYPE ?? "auto"),
    judgeMaxInputTokens: numericFlag(args, "--judge-max-input-tokens", Number(process.env.PYA_CRITERION_JUDGE_MAX_INPUT_TOKENS || 8192)),
    judgeTemperature: numericFlag(args, "--judge-temperature", 0),
    judgeMaxOutputTokens: numericFlag(args, "--judge-max-output-tokens", Number(process.env.PYA_CRITERION_JUDGE_MAX_OUTPUT_TOKENS || 384)),
    resume: hasFlag(args, "--resume"),
    smoke: hasFlag(args, "--smoke")
  });
  print({
    runId: result.runId,
    status: result.status,
    generationRunId: result.generationRunId,
    selectedSampleCount: result.selection.count,
    sampleIds: result.selection.sampleIds,
    modelAvailability: result.ollama.resolved,
    generationRows: result.generationRows.length,
    pointwiseRows: result.pointwiseRows.length,
    pairwiseRows: result.pairwiseRows.length,
    results: `criterion/results/${result.runId}.jsonl`,
    report: `criterion/results/${result.runId}.md`,
    csv: `criterion/results/${result.runId}.csv`,
    pya: `criterion/results/${result.runId}.pya`,
    json: `criterion/results/${result.runId}.json`,
    review: `criterion/review/${result.runId}.html`
  }, hasFlag(args, "--json"));
  return result.status === "partial" && hasFlag(args, "--strict") ? 1 : 0;
}

async function againCommand(args, root) {
  const runId = positional(args)[0] ?? flag(args, "--run-id");
  if (!runId) throw new Error("criterion again requires a run id");
  const prior = await loadRun(runId, { root });
  const requestedModels = String(flag(args, "--model", "") ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (prior.engine === "baseline") {
    const result = await runBaseline({
      root,
      benchmark: prior.criterion,
      datasetPath: prior.datasetPath,
      fixtureRoot: prior.fixtureRoot,
      split: prior.split ?? "test",
      baseline: String(prior.models?.[0] ?? "baseline:lead-3").replace(/^baseline:/u, ""),
      runId,
      resume: true
    });
    print({ runId: result.runId, status: result.status, resumed: true, report: `criterion/results/${result.runId}.md` }, hasFlag(args, "--json"));
    return 0;
  }
  const options = { root, profile: flag(args, "--profile") ?? prior.profile, models: requestedModels.length ? requestedModels : prior.models, engine: prior.engine };
  let adapter = null;
  if (prior.engine === "huggingface") {
    adapter = await createHuggingFaceExecutor({
      root,
      runId,
      housekeeperUrl: flag(args, "--gpu-housekeeper-url", process.env.PYA_GPU_HOUSEKEEPER_URL ?? null),
      gpuId: flag(args, "--gpu-id", process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0"),
      revision: process.env.PYA_HUGGINGFACE_REVISION ?? null,
      dtype: process.env.PYA_HF_DTYPE ?? "auto"
    });
    options.executor = adapter.executor;
    options.metadataProvider = adapter.metadataProvider;
  }
  let result;
  try {
    result = await rerunCriterion(runId, options);
  } finally {
    if (adapter) await adapter.close();
  }
  print({ runId: result.runId, status: result.status, resumed: true, report: `criterion/results/${result.runId}.md` }, hasFlag(args, "--json"));
  return 0;
}

async function reportCommand(args, root) {
  const runId = positional(args)[0] ?? flag(args, "--run-id");
  if (!runId) throw new Error("criterion report requires a run id");
  const run = await loadRun(runId, { root });
  if (hasFlag(args, "--json")) print(run, true);
  else print(renderRunMarkdown(run).trimEnd());
  return 0;
}

async function compareCommand(args, root) {
  const ids = positional(args);
  if (!ids.length) throw new Error("criterion compare requires one or more run ids");
  const runs = await Promise.all(ids.map(id => loadRun(id, { root })));
  if (hasFlag(args, "--json")) print(runs, true);
  else print(renderComparison(runs).trimEnd());
  return 0;
}

async function goldenCommand(args, root) {
  const runId = positional(args)[0] ?? flag(args, "--run-id");
  if (!runId) throw new Error("criterion golden requires a run id");
  const run = await loadRun(runId, { root });
  const goldenPath = path.resolve(root, flag(args, "--golden", path.join("criterion", "goldens", `${run.criterion}.json`)));
  if (hasFlag(args, "--write")) {
    await fs.mkdir(path.dirname(goldenPath), { recursive: true });
    await fs.writeFile(goldenPath, `${JSON.stringify({ criterion: run.criterion, aggregates: run.aggregates }, null, 2)}\n`, "utf8");
    print({ status: "written", goldenPath }, hasFlag(args, "--json"));
    return 0;
  }
  const golden = JSON.parse(await fs.readFile(goldenPath, "utf8"));
  const pass = stableJson(golden.aggregates) === stableJson(run.aggregates);
  print({ status: pass ? "pass" : "fail", goldenPath, runId }, hasFlag(args, "--json"));
  return pass ? 0 : 1;
}

async function nightmareCommand(args, root) {
  const mode = positional(args)[0] ?? "run";
  const options = baseOptions(args.slice(1), root);
  const repeats = numericFlag(args, "--repeats", mode === "soak" ? 10 : mode === "stress" ? 5 : 3);
  const result = await runNightmare({ ...options, repeats, concurrency: numericFlag(args, "--concurrency", 1), timeoutMs: numericFlag(args, "--timeout-ms", 120000) });
  print({ mode: result.mode, repeats: result.repeats, runIds: result.runs.map(run => run.runId) }, hasFlag(args, "--json"));
  return 0;
}

async function reverieCommand(args, root) {
  const options = baseOptions(args.slice(1), root);
  const responsePath = flag(args, "--responses");
  const responseText = flag(args, "--response");
  const controlledResponses = responsePath
    ? await readDatasetFile(responsePath)
    : { default: responseText ?? process.env.PYA_REVERIE_RESPONSE ?? "simulated meeting response" };
  const result = await runReverie({ ...options, controlledResponses, scenario: flag(args, "--scenario", "simulated-meeting") });
  print({ mode: result.mode, runId: result.runId, status: result.status }, hasFlag(args, "--json"));
  return 0;
}

export async function main(argv = process.argv.slice(2), { root = process.cwd() } = {}) {
  const [command, subcommand, ...rest] = argv;
  const args = subcommand?.startsWith("--") ? [subcommand, ...rest] : rest;
  if (!command || command === "help" || command === "--help") { print(usage()); return 0; }
  if (command === "criterion" && subcommand === "list") return listCommand(args);
  if (command === "criterion" && subcommand === "inspect") return inspectCommand(args);
  if (command === "criterion" && subcommand === "run") return runCommand(args, root);
  if (command === "criterion" && subcommand === "baseline") return baselineCommand(args, root);
  if (command === "criterion" && (subcommand === "fact-audit" || subcommand === "meetingbank-fact-audit")) return factAuditCommand(args, root);
  if (command === "criterion" && subcommand === "omnicseval-meeting") return factAuditCommand(args, root, FACT_EVALUATION_MODES.exact);
  if (command === "criterion" && (subcommand === "prompt-ablation" || subcommand === "meetingbank-prompt-ablation")) return promptAblationCommand(args, root);
  if (command === "criterion" && (subcommand === "meetingbank-judge-pilot" || subcommand === "judge-pilot")) return meetingBankJudgePilotCommand(args, root);
  if (command === "criterion" && subcommand === "report") return reportCommand(rest, root);
  if (command === "criterion" && subcommand === "compare") return compareCommand(rest, root);
  if (command === "criterion" && subcommand === "golden") return goldenCommand(rest, root);
  if (command === "criterion" && subcommand === "again") return againCommand(rest, root);
  if (command === "list") return listCommand([subcommand, ...rest].filter(Boolean));
  if (command === "inspect") return inspectCommand([subcommand, ...rest].filter(Boolean));
  if (command === "run") return runCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "baseline") return baselineCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "fact-audit" || command === "meetingbank-fact-audit") return factAuditCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "omnicseval-meeting") return factAuditCommand([subcommand, ...rest].filter(Boolean), root, FACT_EVALUATION_MODES.exact);
  if (command === "prompt-ablation" || command === "meetingbank-prompt-ablation") return promptAblationCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "meetingbank-judge-pilot" || command === "judge-pilot") return meetingBankJudgePilotCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "report") return reportCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "compare") return compareCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "golden") return goldenCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "again") return againCommand([subcommand, ...rest].filter(Boolean), root);
  if (command === "nightmare") return nightmareCommand([subcommand, ...rest], root);
  if (command === "reverie" && subcommand === "run") return reverieCommand([subcommand, ...rest], root);
  throw new Error(`unknown criterion command: ${argv.join(" ")}\n${usage()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(code => process.exitCode = code).catch(error => {
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
