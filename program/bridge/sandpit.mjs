// Sandpit helpers for bridge
function registerValue(reg) {
  if (reg == null) return null;
  if (typeof reg === "number") return reg;
  if (typeof reg === "object" && typeof reg.num === "number") return reg.num;
  return null;
}

export async function invokeLoop({ defEntry, sentence, state, memory, interpret, recordSandpitTrace }) {
  const prevEvoke = state.currentEvoke;
  const prevEvokeRef = state.currentEvokeRef;
  const prevExecutingBody = state.executingBody;
  const initialIndex = registerValue(sentence.fromindex);
  if (initialIndex == null) throw new Error("fromindex is required to loop");
  const untilSeed = registerValue(sentence.toindex);

  const clone =
    globalThis.structuredClone ||
    ((v) => JSON.parse(JSON.stringify(v)));

  const body = memory.allRemember().slice(defEntry.index + 1, defEntry.end); // exclude def; include body and prah
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
    let currentIndex = registerValue(state.currentEvokeRef.fromindex);
    let currentUntil = untilSeed;

    while (true) {
      state.currentEvokeRef.fromindex = currentIndex;
      state.currentEvokeRef.toindex = currentUntil ?? state.currentEvokeRef.toindex;
      // Conditionals ("then") are a one-line control-flow mechanism; they should not leak across loop iterations.
      state.lastCondition = true;

      for (const step of body) {
        // Never execute the canonical definition-body objects directly; verbs can mutate targets in-place.
        lastResult = await interpret(clone(step));
        if (step.mood === "then" && state.lastCondition === false) {
          state.lastCondition = true;
          break;
        }
      }

      const updatedTloh = registerValue(state.currentEvokeRef.fromindex);
      const updatedUntil = registerValue(state.currentEvokeRef.toindex ?? currentUntil);

      const effectiveTloh = updatedTloh ?? currentTloh;
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
  const returnVal = lastResult?.value ?? lastResult?.obj;
  const mergedObj = returnVal ?? finalEvoke.obj;
  const mergedBe = finalEvoke.be || "result";

  if (mergedObj !== undefined) {
    const normalizedObj = typeof mergedObj === "object" ? mergedObj : { num: mergedObj };
    const evokeWithResult = { ...(state.currentEvokeRef || finalEvoke), obj: normalizedObj };
    memory.doRemember(evokeWithResult);

    const targetName = evokeWithResult.to?.name ?? updatedTarget?.subj?.name;
    if (targetName) {
      const targetObj = updatedTarget?.obj ?? normalizedObj;
      const targetBe = updatedTarget?.be ?? mergedBe;
      memory.doRemember({ subj: { name: targetName }, obj: targetObj, be: targetBe, mood: "ya" });
      memory.doRemember({ subj: { name: "result" }, obj: normalizedObj, be: mergedBe, mood: "ya" });
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
  const { to } = sentence;
  const clone =
    globalThis.structuredClone ||
    ((v) => JSON.parse(JSON.stringify(v)));
  const body = memory.allRemember().slice(defEntry.index + 1, defEntry.end); // skip prah (end is exclusive)
  const defSigWords = memory.allRemember()[defEntry.index]?.signatureWords;
  let lastResult;
  const evokeSeed = { ...sentence };
  if (sentence.by?.register && !evokeSeed.by) evokeSeed.by = sentence.by;
  state.currentEvoke = evokeSeed;
  state.executingBody = true;
  memory.pushMemoryContext({ seedFromCurrent: true });
  state.currentEvokeRef = evokeSeed;

  for (const step of body) {
    // Avoid mutating definition body sentences across invocations.
    lastResult = await interpret(clone(step));
    if (step.mood === "then" && state.lastCondition === false) {
      state.lastCondition = true;
      break;
    }
  }

  const sandpit = [state.currentEvokeRef, ...memory.allRemember()];
  const updatedTarget = to?.name ? memory.remember(to.name) : null;
  recordSandpitTrace(sandpit);
  memory.popMemoryContext();
  state.executingBody = false;
  const evoke = state.currentEvokeRef || state.currentEvoke || sentence;
  state.currentEvoke = null;
  state.currentEvokeRef = null;

  // merge updates from sandpit
  const mainTarget = to?.name ? memory.remember(to.name) : null;
  const lastVal = lastResult?.value ?? lastResult?.obj;
  const returnValue =
    lastVal && typeof lastVal === "object" && lastVal.obj !== undefined ? lastVal.obj : lastVal;
  const preferredVal =
    returnValue && typeof returnValue === "object" && returnValue.num === undefined && returnValue.mood
      ? returnValue.obj ?? undefined // evoker-like; take its obj if present
      : returnValue;
  const numericSignature = signatureImpliesNumeric(defSigWords);
  const mergedObj = preferredVal ?? updatedTarget?.obj ?? mainTarget?.obj ?? evoke.obj;
  const effectiveObj = mergedObj; // avoid unconditional defaults for non-numeric signatures
  const mergedBe = evoke.be || updatedTarget?.be || "result";

  if (mergedObj === undefined && preferredVal === undefined && numericSignature) {
    throw new Error(`ceremony ${sentence.be} returned no value for numeric signature`);
  }

  if (mergedObj !== undefined || preferredVal !== undefined) {
    const normalizedObj = typeof effectiveObj === "object" ? effectiveObj : { num: effectiveObj };
    const updatedEvoke = { ...evoke, obj: normalizedObj };
    memory.doRemember(updatedEvoke);

    if (to?.name) {
      memory.doRemember({ subj: { name: to.name }, obj: normalizedObj, be: mergedBe, mood: "ya" });
      memory.doRemember({ subj: { name: "result" }, obj: normalizedObj, be: mergedBe, mood: "ya" });
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
