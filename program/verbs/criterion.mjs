import { remember } from "../remember/index.mjs";
import { runCriterion } from "../runtime/criterion/run.mjs";

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

export function criterionOptions(sentence, { remember: rememberFn = remember } = {}) {
  const benchmark = valueFromCase(sentence?.for ?? sentence?.ob, rememberFn) ?? process.env.PYA_CRITERION_BENCHMARK;
  const datasetPath = valueFromCase(sentence?.from, rememberFn) ?? process.env.PYA_CRITERION_DATASET;
  const fixtureRoot = valueFromCase(sentence?.with, rememberFn) ?? process.env.PYA_CRITERION_FIXTURES;
  const profile = valueFromCase(sentence?.as, rememberFn) ?? process.env.PYA_CRITERION_PROFILE ?? "summary_direct";
  return {
    benchmark,
    datasetPath,
    fixtureRoot,
    profile,
    models: String(process.env.PYA_CRITERION_MODELS ?? "").split(",").map(value => value.trim()).filter(Boolean),
    limit: process.env.PYA_CRITERION_LIMIT ? Number(process.env.PYA_CRITERION_LIMIT) : null,
    contextLength: process.env.PYA_CRITERION_CONTEXT_LENGTH ? Number(process.env.PYA_CRITERION_CONTEXT_LENGTH) : undefined,
    root: process.env.PYA_CRITERION_ROOT ?? process.cwd()
  };
}

export async function criterion(sentence, { remember: rememberFn = remember, runner = runCriterion } = {}) {
  const options = criterionOptions(sentence, { remember: rememberFn });
  if (!options.benchmark) throw new Error("criterion requires a benchmark name or PYA_CRITERION_BENCHMARK");
  const run = await runner(options);
  return { ob: { map: { runId: run.runId, benchmark: run.criterion, status: run.status, result: `criterion/results/${run.runId}.md` } }, be: "criterion" };
}

export default criterion;

export const signatures = [
  { signatureWords: ["be", "criterion"], handler: criterion },
  { signatureWords: ["be", "criterion", "ob", "text"], handler: criterion },
  { signatureWords: ["be", "criterion", "from", "filename"], handler: criterion },
  { signatureWords: ["be", "criterion", "from", "filename", "ob", "text"], handler: criterion }
];
