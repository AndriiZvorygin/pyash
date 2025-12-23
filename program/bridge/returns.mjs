import { resolveThisValue } from "../library/thisBinding.mjs";

export function handleThisBinding(sentence, state) {
  const { su, ob } = sentence;
  if (sentence.mood !== "ya") return null;
  if (!(su?.name === "this" || ob?.thisRef)) return null;

  const resolved = resolveThisValue(ob, state.currentEvokeRef || state.currentEvoke);
  if (resolved == null) return null;

  const targetName = su?.name === "this" ? ob?.name : su?.name;
  if (!targetName) throw new Error("this binding requires a target name");

  return { ...sentence, su: { name: targetName }, ob: resolved, mood: "ya" };
}

export function handleReturn(sentence, state, remember) {
  if (sentence.mood !== "ret" || !state.currentEvokeRef) return null;

  const sourceName = sentence?.ret?.name || sentence?.ob?.name || sentence?.su?.name;
  let merged = { ...state.currentEvokeRef };

  if (sourceName) {
    const fact = remember(sourceName);
    if (!fact) throw new Error(`ret: unknown binding ${sourceName}`);
    merged = {
      ...merged,
      ob: fact.ob ?? merged.ob,
      to: fact.to ?? merged.to,
      from: fact.from ?? merged.from,
      fromindex: fact.fromindex ?? merged.fromindex,
      toindex: fact.toindex ?? merged.toindex,
      as: fact.as ?? merged.as
    };
  } else if (sentence.ob !== undefined) {
    merged = { ...merged, ob: sentence.ob };
  }

  if (sentence.to) merged.to = sentence.to;
  if (sentence.from) merged.from = sentence.from;
  if (sentence.fromindex !== undefined) merged.fromindex = sentence.fromindex;
  if (sentence.toindex !== undefined) merged.toindex = sentence.toindex;
  if (sentence.as) merged.as = sentence.as;

  merged.mood = state.currentEvokeRef.mood;
  merged.be = state.currentEvokeRef.be;

  Object.assign(state.currentEvokeRef, merged);
  return { returned: "evoke", value: merged.ob ?? merged };
}
