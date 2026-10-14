import { remember } from "../remember/index.mjs";
import { runCriterion } from "../runtime/criterion/run.mjs";
import { createQueuedOllamaExecutor, DEFAULT_PROFILES } from "../runtime/criterion/ollama.mjs";
import { createStrataExecutor } from "../runtime/criterion/strata.mjs";

function valueFromCase(value, rememberFn) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value.text !== undefined) return value.text;
  if (value.filename !== undefined) return value.filename;
  if (value.name && rememberFn) {
    const fact = rememberFn(value.name);
    return fact?.ob?.text ?? fact?.ob?.filename ?? fact?.ob?.num ?? value.name;
  }
  return null;
}

function caseText(value, rememberFn) {
  return valueFromCase(value, rememberFn);
}

function normalizeEngine(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text === "ollama" || text === "ollama command mind") return "ollama";
  if (text === "strata" || text === "strata command mind") return "strata";
  return text;
}

export function criterionOptions(sentence, { remember: rememberFn = remember } = {}) {
  const benchmark = valueFromCase(sentence?.for ?? sentence?.ob, rememberFn) ?? process.env.PYA_CRITERION_BENCHMARK;
  const datasetPath = sentence?.from?.filename
    ? valueFromCase({ filename: sentence.from.filename }, rememberFn)
    : (sentence?.from?.name && !sentence?.from?.filename ? process.env.PYA_CRITERION_DATASET : valueFromCase(sentence?.from, rememberFn))
      ?? process.env.PYA_CRITERION_DATASET;
  const fixtureRoot = valueFromCase(sentence?.with, rememberFn) ?? process.env.PYA_CRITERION_FIXTURES;
  const backend = caseText(sentence?.fromstate, rememberFn) ?? process.env.PYA_CRITERION_BACKEND ?? process.env.PYA_CRITERION_ENGINE ?? "ollama";
  const engine = normalizeEngine(backend);
  const modelCase = caseText(sentence?.as, rememberFn);
  const explicitProfile = caseText(sentence?.during, rememberFn);
  const legacyProfile = !explicitProfile && modelCase && DEFAULT_PROFILES[modelCase] ? modelCase : null;
  const profile = explicitProfile ?? legacyProfile ?? process.env.PYA_CRITERION_PROFILE ?? "summary_direct";
  const model = modelCase && !legacyProfile ? modelCase : null;
  const models = model ? [model] : String(process.env.PYA_CRITERION_MODELS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  return {
    benchmark,
    datasetPath,
    fixtureRoot,
    profile,
    engine,
    backend: String(backend).trim(),
    baseUrl: caseText(sentence?.from?.name ?? sentence?.from?.text, rememberFn)
      ?? process.env.PYA_CRITERION_BASE_URL
      ?? (engine === "strata" ? process.env.STRATA_HOST ?? "http://127.0.0.1:8081" : process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST),
    models,
    gpuHousekeeperUrl: process.env.PYA_GPU_HOUSEKEEPER_URL ?? null,
    criterionGpuId: process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0",
    limit: process.env.PYA_CRITERION_LIMIT ? Number(process.env.PYA_CRITERION_LIMIT) : null,
    contextLength: process.env.PYA_CRITERION_CONTEXT_LENGTH ? Number(process.env.PYA_CRITERION_CONTEXT_LENGTH) : undefined,
    root: process.env.PYA_CRITERION_ROOT ?? process.cwd()
  };
}

export async function criterion(sentence, { remember: rememberFn = remember, runner = runCriterion } = {}) {
  const options = criterionOptions(sentence, { remember: rememberFn });
  if (!options.benchmark) throw new Error("criterion requires a benchmark name or PYA_CRITERION_BENCHMARK");
  if (runner === runCriterion && !["ollama", "strata"].includes(options.engine)) {
    throw new Error(`criterion backend is not supported by the native runner: ${options.backend || options.engine}`);
  }
  if (runner !== runCriterion) {
    const run = await runner(options);
    return { ob: { map: { runId: run.runId, benchmark: run.criterion, status: run.status, result: `criterion/results/${run.runId}.md` } }, be: "criterion" };
  }
  const adapter = options.engine === "strata"
    ? createStrataExecutor({ baseUrl: options.baseUrl, housekeeperUrl: options.gpuHousekeeperUrl })
    : (options.gpuHousekeeperUrl ? createQueuedOllamaExecutor({
      root: options.root,
      runId: options.runId ?? `${options.benchmark}-${Date.now()}`,
      housekeeperUrl: options.gpuHousekeeperUrl,
      gpuId: options.criterionGpuId
    }) : null);
  let completedRun = null;
  try {
    completedRun = await runner({
      ...options,
      ...(adapter ? { executor: adapter.executor, metadataProvider: adapter.metadataProvider } : {})
    });
    return { ob: { map: { runId: completedRun.runId, benchmark: completedRun.criterion, status: completedRun.status, result: `criterion/results/${completedRun.runId}.md` } }, be: "criterion" };
  } finally {
    await adapter?.close?.();
    if (adapter?.dischargeModels) await adapter.dischargeModels(completedRun?.models ?? options.models);
  }
}

export default criterion;

export const signatures = [
  { signatureWords: ["be", "criterion"], handler: criterion },
  { signatureWords: ["be", "criterion", "ob", "text"], handler: criterion },
  { signatureWords: ["be", "criterion", "from", "filename"], handler: criterion },
  { signatureWords: ["be", "criterion", "from", "filename", "ob", "text"], handler: criterion }
];

for (const backend of ["ollama", "strata"]) {
  signatures.push(
    { signatureWords: ["be", "criterion", "fromstate", "name", backend, "ob", "text"], handler: criterion },
    { signatureWords: ["be", "criterion", "from", "filename", "fromstate", "name", backend, "ob", "text"], handler: criterion },
    { signatureWords: ["be", "criterion", "from", "name", "num", "fromstate", "name", backend, "ob", "text"], handler: criterion },
    { signatureWords: ["be", "criterion", "as", "name", "num", "fromstate", "name", backend, "ob", "text"], handler: criterion },
    { signatureWords: ["be", "criterion", "as", "name", "num", "from", "filename", "fromstate", "name", backend, "ob", "text"], handler: criterion },
    { signatureWords: ["be", "criterion", "as", "name", "num", "from", "name", "num", "fromstate", "name", backend, "ob", "text"], handler: criterion },
    { signatureWords: ["be", "criterion", "as", "name", "num", "during", "name", "num", "from", "name", "num", "fromstate", "name", backend, "ob", "text"], handler: criterion }
  );
}
