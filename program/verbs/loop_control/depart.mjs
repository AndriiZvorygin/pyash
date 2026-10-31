import { state } from "../../bridge/state.mjs";

import { ensureLoopContext } from "./context.mjs";

export function depart() {
  ensureLoopContext("depart");
  state.loopControl = "depart";
  return { ob: { text: "depart" }, be: "loop" };
}

export const signatures = [
  { signatureWords: ["be", "depart"], handler: depart }
];

export default depart;
