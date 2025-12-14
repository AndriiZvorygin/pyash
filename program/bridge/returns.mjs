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

  const sourceName = sentence?.ret?.name || sentence?.obj?.name || sentence?.subj?.name;
  let merged = { ...state.currentEvokeRef };

  if (sourceName) {
    const fact = remember(sourceName);
    if (!fact) throw new Error(`ret: unknown binding ${sourceName}`);
    merged = {
      ...merged,
      obj: fact.obj ?? merged.obj,
      to: fact.to ?? merged.to,
      from: fact.from ?? merged.from,
      fromindex: fact.fromindex ?? merged.fromindex,
      toindex: fact.toindex ?? merged.toindex,
      as: fact.as ?? merged.as
    };
  } else if (sentence.obj !== undefined) {
    merged = { ...merged, obj: sentence.obj };
  }

  if (sentence.to) merged.to = sentence.to;
  if (sentence.from) merged.from = sentence.from;
  if (sentence.fromindex !== undefined) merged.fromindex = sentence.fromindex;
  if (sentence.toindex !== undefined) merged.toindex = sentence.toindex;
  if (sentence.as) merged.as = sentence.as;

  merged.mood = state.currentEvokeRef.mood;
  merged.be = state.currentEvokeRef.be;

  Object.assign(state.currentEvokeRef, merged);
  return { returned: "evoke", value: merged.obj ?? merged };
}
