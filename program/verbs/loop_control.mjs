import { state } from "../bridge/state.mjs";
import { throwErrorSentence } from "../error.mjs";

function ensureLoopContext(verbName) {
  if (state.loopActive) return;
  throwErrorSentence({
    name: "loop control defective",
    message: `${verbName} defective: not inside active loop`,
    from: { name: verbName }
  });
}

export function depart() {
  ensureLoopContext("depart");
  state.loopControl = "depart";
  return { ob: { text: "depart" }, be: "loop" };
}

export function continueLoop() {
  ensureLoopContext("continue");
  state.loopControl = "continue";
  return { ob: { text: "continue" }, be: "loop" };
}

export const signatures = [
  { signatureWords: ["be", "depart"], handler: depart },
  { signatureWords: ["be", "continue"], handler: continueLoop }
];

export default depart;
