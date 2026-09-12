import { remember } from "../remember/index.mjs";
import { runReverie } from "../runtime/criterion/suites.mjs";
import { criterionOptions } from "./criterion.mjs";

export async function reverie(sentence, { remember: rememberFn = remember, runner = runReverie } = {}) {
  const options = criterionOptions(sentence, { remember: rememberFn });
  let controlledResponses = {};
  if (process.env.PYA_REVERIE_RESPONSES) controlledResponses = JSON.parse(process.env.PYA_REVERIE_RESPONSES);
  const result = await runner({ ...options, controlledResponses, scenario: process.env.PYA_REVERIE_SCENARIO ?? "simulated-meeting" });
  return { ob: { map: { mode: "reverie", runId: result.runId, status: result.status } }, be: "reverie" };
}

export default reverie;

export const signatures = [
  { signatureWords: ["be", "reverie"], handler: reverie },
  { signatureWords: ["be", "reverie", "ob", "text"], handler: reverie }
];
