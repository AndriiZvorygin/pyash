import { getEffectiveVyahAspect } from "../library/grammar/vyah.mjs";
import { makeAck, makeRuntimeError, makeDuty, makeStream, getState } from "../library/runtimePrimitives.mjs";

const LIFECYCLE_ASPECTS = new Set(["await", "finish", "cancel"]);

export function handleLifecycleAspect(sentence, { remember, doRemember }) {
  const modifiers = Array.isArray(sentence?.vyah?.ve?.values) ? sentence.vyah.ve.values : [];
  const aspect = getEffectiveVyahAspect(modifiers, { verb: sentence?.be, caseKey: "vyah" });
  if (!LIFECYCLE_ASPECTS.has(aspect)) return null;

  const targetName = sentence?.su?.name;
  if (!targetName) {
    return makeRuntimeError({
      name: "runtime target missing",
      message: `runtime aspect "${aspect}" requires su name`
    });
  }

  const target = remember?.(targetName);
  if (!target || (target.be !== "duty" && target.be !== "stream")) {
    return makeRuntimeError({
      name: "runtime target invalid",
      message: `runtime aspect "${aspect}" requires duty or stream: ${targetName}`
    });
  }

  const state = getState(target);
  if (aspect === "await") {
    if (target.be !== "duty") {
      return makeRuntimeError({
        name: "runtime target invalid",
        message: `await requires duty: ${targetName}`
      });
    }
    if (state !== "done") {
      return makeRuntimeError({
        name: "duty not done",
        message: `duty not done: ${targetName}`
      });
    }
    return makeAck({ subject: targetName, verb: sentence.be, aspect: "await" });
  }

  if (state === "lost") {
    return makeRuntimeError({
      name: "runtime lost",
      message: `runtime target lost: ${targetName}`
    });
  }

  if (aspect === "cancel") {
    const updated = target.be === "duty"
      ? makeDuty({ name: targetName, state: "abandoned" })
      : makeStream({ name: targetName, state: "abandoned", ob: target.ob });
    doRemember?.(updated);
    return makeAck({ subject: targetName, verb: sentence.be, aspect: "cancel" });
  }

  if (aspect === "finish") {
    const updated = target.be === "duty"
      ? makeDuty({ name: targetName, state: "done" })
      : makeStream({ name: targetName, state: "done", ob: target.ob });
    doRemember?.(updated);
    return makeAck({ subject: targetName, verb: sentence.be, aspect: "finish" });
  }

  return null;
}
