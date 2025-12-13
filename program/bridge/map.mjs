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
  const vecFact = remember(base.obj?.name ?? base.obj?.vec?.name ?? base.obj?.name?.name ?? base.obj);
  const vecValues = vecFact?.obj?.ve?.values;
  if (!Array.isArray(vecValues)) throw new Error("at all: obj must resolve to a vector");

  const out = [];

  for (let i = 0; i < vecValues.length; i++) {
    const elemSentence = structuredClone(base);
    const elemValue = vecValues[i];
    if (typeof elemValue === "number") elemSentence.obj = { num: elemValue };
    else if (typeof elemValue === "string") elemSentence.obj = { text: elemValue };
    else if (typeof elemValue === "boolean") elemSentence.obj = { boolean: elemValue };
    else elemSentence.obj = elemValue ?? {};
    elemSentence.by = { num: i, register: true };
    elemSentence.this = { ...(elemSentence.this || {}), by: elemSentence.by };
    if (elemSentence.at) delete elemSentence.at; // per-element call should not carry at all

    let resultObj = elemSentence.obj;
    const prevEvoke = state.currentEvoke;
    const prevEvokeRef = state.currentEvokeRef;
    state.currentEvoke = elemSentence;
    state.currentEvokeRef = elemSentence;
    const res = await interpret(elemSentence);
    state.currentEvoke = prevEvoke;
    state.currentEvokeRef = prevEvokeRef;
    if (res?.value !== undefined) resultObj = res.value;
    if (res?.obj !== undefined) resultObj = res.obj;

    if (typeof resultObj === "object" && resultObj !== null) {
      if (resultObj.num !== undefined) out.push(resultObj.num);
      else if (resultObj.text !== undefined) out.push(resultObj.text);
      else if (resultObj.boolean !== undefined) out.push(resultObj.boolean);
      else if (resultObj.ve?.values) out.push(resultObj.ve.values);
      else out.push(resultObj);
    } else {
      out.push(resultObj);
    }
  }

  // write result vector
  if (base.to?.name) {
    const dest = { subj: { name: base.to.name }, be: "vector", obj: { ve: { values: out } }, mood: "ya" };
    return dest;
  }

  // in-place back to obj target
  if (base.obj?.name) {
    const dest = { subj: { name: base.obj.name }, be: "vector", obj: { ve: { values: out } }, mood: "ya" };
    return dest;
  }

  throw new Error("at all: target not assignable (obj must be a name)");
}
