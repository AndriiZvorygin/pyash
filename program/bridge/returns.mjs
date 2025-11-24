import { resolveThisValue } from "../library/thisBinding.mjs";

export function handleThisBinding(sentence, state) {
  const { subj, obj } = sentence;
  if (sentence.mood !== "ya") return null;
  if (!(subj?.name === "this" || obj?.thisRef)) return null;

  const resolved = resolveThisValue(obj, state.currentEvokeRef || state.currentEvoke);
  if (resolved == null) return null;

  const targetName = subj?.name === "this" ? obj?.name : subj?.name;
  if (!targetName) throw new Error("this binding requires a target name");

  return { ...sentence, subj: { name: targetName }, obj: resolved, mood: "ya" };
}

export function handleReturn(sentence, state, remember) {
  if (sentence.mood !== "ret" || !state.currentEvokeRef) return null;

  const sourceName = sentence?.ret?.name || sentence?.obj?.name;
  let merged = { ...state.currentEvokeRef };

  if (sourceName) {
    const fact = remember(sourceName);
    if (!fact) throw new Error(`ret: unknown binding ${sourceName}`);
    merged = {
      ...merged,
      obj: fact.obj ?? merged.obj,
      to: fact.to ?? merged.to,
      from: fact.from ?? merged.from,
      tloh: fact.tloh ?? merged.tloh,
      until: fact.until ?? merged.until,
      as: fact.as ?? merged.as
    };
  } else if (sentence.obj !== undefined) {
    merged = { ...merged, obj: sentence.obj };
  }

  if (sentence.to) merged.to = sentence.to;
  if (sentence.from) merged.from = sentence.from;
  if (sentence.tloh !== undefined) merged.tloh = sentence.tloh;
  if (sentence.until !== undefined) merged.until = sentence.until;
  if (sentence.subj) merged.subj = sentence.subj;
  if (sentence.as) merged.as = sentence.as;

  merged.mood = state.currentEvokeRef.mood;
  merged.be = state.currentEvokeRef.be;

  Object.assign(state.currentEvokeRef, merged);
  return { returned: "evoke", value: merged.obj ?? merged };
}
