import { runCriterion } from "./run.mjs";

export async function runNightmare({ repeats = 3, concurrency = 1, timeoutMs = 120000, ...options } = {}) {
  const count = Math.max(1, Number(repeats));
  const runs = [];
  // The default remains single-flight because Ollama/GPU work is an exclusive
  // host resource in Pyash. A future remote runner may safely raise this.
  const effectiveConcurrency = Math.max(1, Number(concurrency));
  for (let index = 0; index < count; index += 1) {
    const runPromise = runCriterion({
      ...options,
      mode: "nightmare",
      nightmare: { repetition: index + 1, repeats: count, concurrency: effectiveConcurrency },
      runId: options.runId ? `${options.runId}-${index + 1}` : null
    });
    const run = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`nightmare timeout after ${timeoutMs}ms`)), timeoutMs);
      runPromise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
    runs.push(run);
  }
  return { mode: "nightmare", repeats: count, concurrency: effectiveConcurrency, runs };
}

export async function runReverie({ controlledResponses = {}, scenario = "simulated-meeting", ...options } = {}) {
  const responses = controlledResponses;
  const executor = async ({ sample, model }) => {
    const value = responses[sample.id] ?? responses[model] ?? responses.default;
    if (value === undefined) throw new Error(`reverie controlled response missing for ${sample.id}`);
    return { text: typeof value === "string" ? value : value.text ?? JSON.stringify(value), timing: {} };
  };
  return runCriterion({ ...options, executor, mode: "reverie", scenario });
}
