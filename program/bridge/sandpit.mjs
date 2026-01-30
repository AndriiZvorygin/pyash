// Sandpit helpers for bridge
export function resolveGenitiveValue(genitive, { state, memory } = {}) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return null;
  const [root, ...rest] = chainArr;
  let curr =
    root === "this"
      ? (state?.currentEvokeRef || state?.currentEvoke)
      : (typeof root === "string" && memory ? memory.remember(root) : null);
  for (const part of rest) {
    if (typeof curr === "number") {
      if (part === "num") continue;
      curr = undefined;
      break;
    }
    if (curr && typeof curr === "object" && curr.name && memory) {
      const fact = memory.remember(curr.name);
      if (fact) curr = part === "ob" ? fact : (fact.ob ?? fact);
    }
    if (curr == null) break;
    if (curr && typeof curr === "object") {
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr[part];
      }
    } else {
      curr = curr?.[part];
    }
  }
  if (typeof curr === "number") return curr;
  if (typeof curr?.num === "number") return curr.num;
  return null;
}

function registerValue(reg, { state, memory } = {}) {
  if (reg == null) return null;
  if (typeof reg === "number") return reg;
  if (typeof reg === "object" && typeof reg.num === "number") return reg.num;
  if (reg?.genitive) {
    const val = resolveGenitiveValue(reg.genitive, { state, memory });
    if (typeof val === "number") return val;
  }
  return null;
}

export async function invokeLoop({ defEntry, sentence, state, memory, interpret, recordSandpitTrace }) {
  const prevEvoke = state.currentEvoke;
  const prevEvokeRef = state.currentEvokeRef;
  const prevExecutingBody = state.executingBody;
  const initialIndex = registerValue(sentence.fromindex, { state, memory });
  if (initialIndex == null) throw new Error("fromindex is required to loop");
  const untilSeed = registerValue(sentence.toindex, { state, memory });

  const clone =
    globalThis.structuredClone ||
    ((v) => JSON.parse(JSON.stringify(v)));

  const baseBody = memory.allRemember()
    .slice(defEntry.index + 1, defEntry.end)
    .map((step) => clone(step));
  let lastResult;
  state.currentEvoke = {
    ...sentence,
    fromindex: sentence.fromindex ?? initialIndex,
    toindex: sentence.toindex ?? untilSeed
  };

  memory.pushMemoryContext({ seedFromCurrent: true });
  state.currentEvokeRef = state.currentEvoke;
  state.executingBody = true;
  state.lastCondition = true;

  let sandpit = [];
  let updatedTarget = null;

  try {
    let currentIndex = registerValue(state.currentEvokeRef.fromindex, { state, memory });
    let currentUntil = untilSeed;

    while (true) {
      state.currentEvokeRef.fromindex = currentIndex;
      state.currentEvokeRef.toindex = currentUntil ?? state.currentEvokeRef.toindex;
      // Conditionals ("then") are a one-line control-flow mechanism; they should not leak across loop iterations.
      state.lastCondition = true;

      for (const step of baseBody) {
        // Never execute the canonical definition-body objects directly; verbs can mutate targets in-place.
        lastResult = await interpret(clone(step));
      }

      const updatedTloh = registerValue(state.currentEvokeRef.fromindex, { state, memory });
      const updatedUntil = registerValue(state.currentEvokeRef.toindex ?? currentUntil, { state, memory });

      const effectiveTloh = updatedTloh ?? currentIndex;
      const effectiveUntil = updatedUntil ?? currentUntil;

      const shouldStop = effectiveUntil != null ? effectiveTloh === effectiveUntil : effectiveTloh === 0;
      if (shouldStop) {
        currentIndex = effectiveTloh;
        currentUntil = effectiveUntil;
        state.currentEvokeRef.fromindex = currentIndex;
        state.currentEvokeRef.toindex = currentUntil;
        break;
      }

      const direction = effectiveUntil != null ? (effectiveTloh < effectiveUntil ? 1 : -1) : -1;
      const next = (effectiveTloh ?? currentIndex) + direction;
      const reachedAfterStep = effectiveUntil != null ? next === effectiveUntil : next === 0;
      currentIndex = next;
      currentUntil = effectiveUntil;
      if (reachedAfterStep) {
        state.currentEvokeRef.fromindex = next;
        state.currentEvokeRef.toindex = effectiveUntil;
        break;
      }
    }
    updatedTarget = sentence.to?.name ? memory.remember(sentence.to.name) : null;
    sandpit = [state.currentEvokeRef, ...memory.allRemember()];
  } finally {
    recordSandpitTrace(sandpit);
    memory.popMemoryContext();
    state.executingBody = false;
  }

  const finalEvoke = state.currentEvokeRef || state.currentEvoke || sentence;
  const returnVal = lastResult?.value ?? lastResult?.ob;
  const mergedObj = returnVal ?? finalEvoke.ob;
  const mergedBe = finalEvoke.be || "result";

  if (mergedObj !== undefined) {
    const normalizedObj = typeof mergedObj === "object" ? mergedObj : { num: mergedObj };
    const evokeWithResult = { ...(state.currentEvokeRef || finalEvoke), ob: normalizedObj };
    memory.doRemember(evokeWithResult);

    const targetName = evokeWithResult.to?.name ?? updatedTarget?.su?.name;
    if (targetName) {
      const targetObj = updatedTarget?.ob ?? normalizedObj;
      const targetBe = updatedTarget?.be ?? mergedBe;
      memory.doRemember({ su: { name: targetName }, ob: targetObj, be: targetBe, mood: "ya" });
      memory.doRemember({ su: { name: "result" }, ob: normalizedObj, be: mergedBe, mood: "ya" });
    }

    state.currentEvoke = prevEvoke;
    state.currentEvokeRef = prevEvokeRef;
    state.executingBody = prevExecutingBody;
    return { invoked: finalEvoke.be, result: normalizedObj };
  }

  memory.doRemember(finalEvoke);
  state.currentEvoke = prevEvoke;
  state.currentEvokeRef = prevEvokeRef;
  state.executingBody = prevExecutingBody;
  return lastResult;
}

export async function runDefinitionBody({ defEntry, sentence, state, memory, interpret, recordSandpitTrace }) {
  const prevEvoke = state.currentEvoke;
  const prevEvokeRef = state.currentEvokeRef;
  const prevExecutingBody = state.executingBody;
  const { to } = sentence;
  const clone =
    globalThis.structuredClone ||
    ((v) => JSON.parse(JSON.stringify(v)));
  const body = memory.allRemember().slice(defEntry.index + 1, defEntry.end); // skip prah (end is exclusive)
  const defSigWords = memory.allRemember()[defEntry.index]?.signatureWords;
  let lastResult;
  let updatedTarget = null;
  let evoke = sentence;
  const evokeSeed = { ...sentence };
  if (sentence.by?.register && !evokeSeed.by) evokeSeed.by = sentence.by;
  state.currentEvoke = evokeSeed;
  state.executingBody = true;
  memory.pushMemoryContext({ seedFromCurrent: true });
  state.currentEvokeRef = evokeSeed;

  try {
    for (const step of body) {
      // Avoid mutating definition body sentences across invocations.
      lastResult = await interpret(clone(step));
    }
  } finally {
    const sandpit = [state.currentEvokeRef, ...memory.allRemember()];
    updatedTarget = to?.name ? memory.remember(to.name) : null;
    recordSandpitTrace(sandpit);
    memory.popMemoryContext();
    state.executingBody = false;
    evoke = state.currentEvokeRef || state.currentEvoke || sentence;
    state.currentEvoke = prevEvoke;
    state.currentEvokeRef = prevEvokeRef;
    state.executingBody = prevExecutingBody;
  }

  // merge updates from sandpit
  const mainTarget = to?.name ? memory.remember(to.name) : null;
  const lastVal = lastResult?.value ?? lastResult?.ob;
  const returnValue =
    lastVal && typeof lastVal === "object" && lastVal.ob !== undefined ? lastVal.ob : lastVal;
  const preferredVal =
    returnValue && typeof returnValue === "object" && returnValue.num === undefined && returnValue.mood
      ? returnValue.ob ?? undefined // evoker-like; take its ob if present
      : returnValue;
  const numericSignature = signatureImpliesNumeric(defSigWords);
  const mergedObj = preferredVal ?? updatedTarget?.ob ?? mainTarget?.ob ?? evoke.ob;
  const effectiveObj = mergedObj; // avoid unconditional defaults for non-numeric signatures
  const mergedBe = evoke.be || updatedTarget?.be || "result";

  if (mergedObj === undefined && preferredVal === undefined && numericSignature) {
    throw new Error(`ceremony ${sentence.be} returned no value for numeric signature`);
  }

  if (mergedObj !== undefined || preferredVal !== undefined) {
    const normalizedObj = typeof effectiveObj === "object" ? effectiveObj : { num: effectiveObj };
    if (evoke.mood === "do") {
      memory.doRemember(evoke);
    }
    const updatedEvoke = { ...evoke, ob: normalizedObj, mood: evoke.mood === "do" ? "ya" : evoke.mood };
    memory.doRemember(updatedEvoke);

    if (to?.name) {
      memory.doRemember({ su: { name: to.name }, ob: normalizedObj, be: mergedBe, mood: "ya" });
      memory.doRemember({ su: { name: "result" }, ob: normalizedObj, be: mergedBe, mood: "ya" });
    }
  } else {
    memory.doRemember(evoke);
  }

  return { invoked: sentence.be, result: mergedObj ?? lastResult };
}

function signatureImpliesNumeric(signatureWords) {
  if (!Array.isArray(signatureWords) || signatureWords.length === 0) return false;
  return signatureWords.includes("num");
}
