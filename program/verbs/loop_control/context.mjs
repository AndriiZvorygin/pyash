import { state } from "../../bridge/state.mjs";
import { throwErrorSentence } from "../../error.mjs";

// A loop control verb only means something inside a loop. Outside one, the
// sentence is defective rather than a no-op.
export function ensureLoopContext(verbName) {
  if (state.loopActive) return;
  throwErrorSentence({
    name: "loop control defective",
    message: `${verbName} defective: not inside active loop`,
    from: { name: verbName }
  });
}
