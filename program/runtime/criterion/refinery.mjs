import { endRefinery, recordPlatform, removeRefinery, runRefinery, startRefinery } from "../../bridge/refinery.mjs";

// Adapt benchmark stages to the existing refinery scheduler. Each unit is an
// ordered, checkpointable platform; callers supply the actual unit operation.
export async function runCriterionRefinery({ name = "criterion run", units = [], execute, retryConfig, runId, resume } = {}) {
  if (!Array.isArray(units) || units.length === 0) throw new Error("criterion refinery requires units");
  if (typeof execute !== "function") throw new Error("criterion refinery requires execute");
  const refineryName = String(name);
  startRefinery(refineryName);
  try {
    for (const unit of units) {
      recordPlatform({ mood: "ya", su: { name: String(unit.id) }, be: "criterion unit", ob: { text: String(unit.label ?? unit.id) } });
    }
    endRefinery(refineryName);
    return await runRefinery({
      name: refineryName,
      runId,
      resume,
      retryConfig,
      interpret: async sentence => {
        const unit = units.find(candidate => String(candidate.id) === String(sentence.su?.name));
        if (!unit) throw new Error(`criterion refinery unit missing: ${sentence.su?.name}`);
        const result = await execute(unit, sentence);
        return result?.mood && result?.be ? result : { mood: "ya", be: "criterion result", ob: result ?? {} };
      }
    });
  } finally {
    removeRefinery(refineryName);
  }
}
