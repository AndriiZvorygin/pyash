import { state } from "./state.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature, lookupSignatureHandler } from "./signature.mjs";

// Generic vector map/foreach helper for "at all" sugar.
// - resolveObjVec: (sentence) => { values: [], name?: string }
// - writeResult: (sentence, outVec) => void (writes to .to if present, else back to .ob target)
// - exec: (be, sentence) => result from handler/ceremony
export async function runAtAll({
  sentence,
  remember,
  memory,
  getDefinitionEntry,
  state,
  recordSandpitTrace,
  interpret
}) {
  const base = {
    ...sentence,
    ob: sentence?.ob ? { ...sentence.ob } : sentence?.ob,
    at: sentence?.at ? { ...sentence.at } : sentence?.at,
    by: sentence?.by ? { ...sentence.by } : sentence?.by,
    this: sentence?.this ? { ...sentence.this } : sentence?.this
  };
  // If the caller passed a genitive `by` like "by num of fromindex of this",
  // resolve it against the *current evoker* once so per-element ceremonies see a plain number.
  if (base.by?.genitive) {
    const chainArr = Array.isArray(base.by.genitive.chain) ? base.by.genitive.chain : [];
    const evoke = state.currentEvokeRef || state.currentEvoke;
    if (evoke && chainArr[0] === "this") {
      let curr = evoke;
      for (const part of chainArr.slice(1)) {
        if (typeof curr === "number") {
          if (part === "num") continue;
          curr = undefined;
          break;
        }
        curr = curr?.[part];
      }
      const resolved = typeof curr === "number" ? curr : curr?.num;
      if (typeof resolved === "number") base.by = { num: resolved };
    }
  }
  const vecFact = remember(base.ob?.name ?? base.ob?.vec?.name ?? base.ob?.name?.name ?? base.ob);
  const vecValues = vecFact?.ob?.ve?.values;
  if (!Array.isArray(vecValues)) throw new Error("at all: ob must resolve to a vector");

  const out = [];

  // Primitive verbs (no ceremony) can reuse the single-element handlers via at:num
  const isPrimitive = !getDefinitionEntry(base.be);

  for (let i = 0; i < vecValues.length; i++) {
    const elemSentence = {
      ...base,
      atindex: { num: i, register: true }
    };
    elemSentence.this = {
      ...(base.this || {}),
      atindex: elemSentence.atindex,
      by: base.by,
      fromindex: base.fromindex,
      toindex: base.toindex
    };
    if (base.at) {
      elemSentence.at = undefined;
    }

    let resultObj;
    if (memory?.pushMemoryContext) {
      memory.pushMemoryContext({ seedFromCurrent: true });
    }
    if (isPrimitive) {
      // reuse single-element handler by setting at:num and providing the element value
      const elemValue = vecValues[i];
      if (typeof elemValue === "number") elemSentence.ob = { num: elemValue };
      else if (typeof elemValue === "string") elemSentence.ob = { text: elemValue };
      else if (typeof elemValue === "boolean") elemSentence.ob = { boolean: elemValue };
      else elemSentence.ob = elemValue ?? {};
      elemSentence.at = { num: i };
      const res = await interpret(elemSentence);
      if (res?.ob !== undefined) resultObj = res.ob;
      if (res?.value !== undefined) resultObj = res.value;
      if (res?.result !== undefined) resultObj = res.result;
      if (resultObj === undefined) resultObj = elemSentence.ob;
    } else {
      state.lastCondition = true;
      const elemValue = vecValues[i];
      if (typeof elemValue === "number") elemSentence.ob = { num: elemValue };
      else if (typeof elemValue === "string") elemSentence.ob = { text: elemValue };
      else if (typeof elemValue === "boolean") elemSentence.ob = { boolean: elemValue };
      else elemSentence.ob = elemValue ?? {};
      const prevEvoke = state.currentEvoke;
      const prevEvokeRef = state.currentEvokeRef;
      state.currentEvoke = elemSentence;
      state.currentEvokeRef = elemSentence;
      const res = await interpret(elemSentence);
      state.currentEvoke = prevEvoke;
      state.currentEvokeRef = prevEvokeRef;
      if (res?.value !== undefined) resultObj = res.value;
      if (res?.ob !== undefined) resultObj = res.ob;
      if (res?.result !== undefined) resultObj = res.result;
      if (resultObj === undefined && elemSentence.ob !== undefined) {
        resultObj = elemSentence.ob;
      }
    }
    if (memory?.popMemoryContext) {
      memory.popMemoryContext();
    }

    if (typeof resultObj === "object" && resultObj !== null) {
      if (resultObj.num !== undefined) out[i] = resultObj.num;
      else if (resultObj.text !== undefined) out[i] = resultObj.text;
      else if (resultObj.boolean !== undefined) out[i] = resultObj.boolean;
      else if (resultObj.ve?.values) out[i] = resultObj.ve.values;
      else out[i] = resultObj;
    } else if (resultObj !== undefined) {
      out[i] = resultObj;
    }
  }

  // write result vector
  if (base.to?.name) {
    const dest = { su: { name: base.to.name }, be: "vector", ob: { ve: { values: out } }, mood: "ya" };
    return dest;
  }

  // in-place back to ob target
  if (base.ob?.name) {
    // Prefer mutating the remembered fact in-place when available. This matters for loop sandpits:
    // the sandpit memory context is a shallow copy, so in-place mutations persist back to main.
    if (vecFact?.ob?.ve) {
      vecFact.ob.ve.values = out;
      vecFact.mood = vecFact.mood ?? "ya";
      vecFact.be = vecFact.be ?? "vector";
      return vecFact;
    }
    return { su: { name: base.ob.name }, be: "vector", ob: { ve: { values: out } }, mood: "ya" };
  }

  throw new Error("at all: target not assignable (ob must be a name)");
}
