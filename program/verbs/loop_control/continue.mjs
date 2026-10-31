import { state } from "../../bridge/state.mjs";

import { ensureLoopContext } from "./context.mjs";

export function continueLoop() {
  ensureLoopContext("continue");
  state.loopControl = "continue";
  return { ob: { text: "continue" }, be: "loop" };
}

export const signatures = [
  { signatureWords: ["be", "continue"], handler: continueLoop }
];
