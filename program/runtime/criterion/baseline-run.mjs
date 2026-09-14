import { baselineMetadata, runLead3 } from "./baseline.mjs";
import { runCriterion } from "./run.mjs";

export async function runBaseline({ baseline = "lead-3", benchmark = "meetingbank", ...options } = {}) {
  if (baseline !== "lead-3") throw new Error(`unknown criterion baseline: ${baseline}`);
  if (benchmark !== "meetingbank") throw new Error("lead-3 baseline currently supports MeetingBank only");
  const model = `baseline:${baseline}`;
  return runCriterion({
    ...options,
    benchmark,
    models: [model],
    profile: "baseline",
    engine: "baseline",
    executor: runLead3,
    metadataProvider: async () => baselineMetadata({ model })
  });
}
