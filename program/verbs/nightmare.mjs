import { remember } from "../remember/index.mjs";
import { runNightmare } from "../runtime/criterion/suites.mjs";
import { criterionOptions } from "./criterion.mjs";

export async function nightmare(sentence, { remember: rememberFn = remember, runner = runNightmare } = {}) {
  const options = criterionOptions(sentence, { remember: rememberFn });
  const result = await runner(options);
  return { ob: { map: { mode: "nightmare", repeats: result.repeats, runs: result.runs?.map(run => run.runId) ?? [] } }, be: "nightmare" };
}

export default nightmare;

export const signatures = [
  { signatureWords: ["be", "nightmare"], handler: nightmare },
  { signatureWords: ["be", "nightmare", "ob", "text"], handler: nightmare }
];
