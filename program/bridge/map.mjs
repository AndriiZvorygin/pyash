import { state } from "./state.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature, lookupSignatureHandler } from "./signature.mjs";

// Generic vector map/foreach helper for "at all" sugar.
// - resolveObjVec: (sentence) => { values: [], name?: string }
// - writeResult: (sentence, outVec) => void (writes to .to if present, else back to .obj target)
// - exec: (be, sentence) => result from handler/ceremony
export async function runAtAll({
  sentence,
  remember,
  getDefinitionEntry,
  state,
  recordSandpitTrace,
  interpret
}) {
  const base = structuredClone(sentence);
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
  const vecFact = remember(base.obj?.name ?? base.obj?.vec?.name ?? base.obj?.name?.name ?? base.obj);
  const vecValues = vecFact?.obj?.ve?.values;
  if (!Array.isArray(vecValues)) throw new Error("at all: obj must resolve to a vector");

  const out = [];

  // Primitive verbs (no ceremony) can reuse the single-element handlers via at:num
  const isPrimitive = !getDefinitionEntry(base.be);

  for (let i = 0; i < vecValues.length; i++) {
    const elemSentence = structuredClone(base);
    elemSentence.atindex = { num: i, register: true };
    elemSentence.this = {
      ...(elemSentence.this || {}),
      atindex: elemSentence.atindex,
      by: elemSentence.by,
      fromindex: elemSentence.fromindex,
      toindex: elemSentence.toindex,
    };
    if (elemSentence.at) delete elemSentence.at; // per-element call should not carry at all

    let resultObj;
    if (isPrimitive) {
      // reuse single-element handler by setting at:num and providing the element value
      const elemValue = vecValues[i];
      if (typeof elemValue === "number") elemSentence.obj = { num: elemValue };
      else if (typeof elemValue === "string") elemSentence.obj = { text: elemValue };
      else if (typeof elemValue === "boolean") elemSentence.obj = { boolean: elemValue };
      else elemSentence.obj = elemValue ?? {};
      elemSentence.at = { num: i };
      const res = await interpret(elemSentence);
      if (res?.obj !== undefined) resultObj = res.obj;
      if (res?.value !== undefined) resultObj = res.value;
      if (res?.result !== undefined) resultObj = res.result;
      if (resultObj === undefined) resultObj = elemSentence.obj;
    } else {
      state.lastCondition = true;
      const elemValue = vecValues[i];
      if (typeof elemValue === "number") elemSentence.obj = { name: `elem_${i}`, num: elemValue };
      else if (typeof elemValue === "string") elemSentence.obj = { name: `elem_${i}`, text: elemValue };
      else if (typeof elemValue === "boolean") elemSentence.obj = { name: `elem_${i}`, boolean: elemValue };
      else elemSentence.obj = elemValue ?? {};
      const prevEvoke = state.currentEvoke;
      const prevEvokeRef = state.currentEvokeRef;
      state.currentEvoke = elemSentence;
      state.currentEvokeRef = elemSentence;
      const res = await interpret(elemSentence);
      state.currentEvoke = prevEvoke;
      state.currentEvokeRef = prevEvokeRef;
      if (res?.value !== undefined) resultObj = res.value;
      if (res?.obj !== undefined) resultObj = res.obj;
      if (res?.result !== undefined) resultObj = res.result;
      if (resultObj === undefined && elemSentence.obj !== undefined) {
        resultObj = elemSentence.obj;
      }
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
    const dest = { subj: { name: base.to.name }, be: "vector", obj: { ve: { values: out } }, mood: "ya" };
    return dest;
  }

  // in-place back to obj target
  if (base.obj?.name) {
    // Prefer mutating the remembered fact in-place when available. This matters for loop sandpits:
    // the sandpit memory context is a shallow copy, so in-place mutations persist back to main.
    if (vecFact?.obj?.ve) {
      vecFact.obj.ve.values = out;
      vecFact.mood = vecFact.mood ?? "ya";
      vecFact.be = vecFact.be ?? "vector";
      return vecFact;
    }
    return { subj: { name: base.obj.name }, be: "vector", obj: { ve: { values: out } }, mood: "ya" };
  }

  throw new Error("at all: target not assignable (obj must be a name)");
}
