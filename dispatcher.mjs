// dispatcher.mjs
import { add } from "./verbs/add.mjs";
import { giant } from "./verbs/giant.mjs";
import { tiny } from "./verbs/tiny.mjs";
import compile from "./verbs/compile.mjs";
import read from "./verbs/read.mjs";
import mind from "./verbs/mind.mjs";
import { getMemory, setMemory, dumpMemory, getDefinitionEntry, pushMemoryContext, popMemoryContext, recordSandpitTrace } from "./memory.mjs";
import { sentenceToPyash } from "./pretty.mjs";
import { resolveThisValue } from "./library/thisBinding.mjs";

const verbs = { add, giant, tiny, compile, read, mind };
let lastCondition = true;
const definitionStack = [];
let currentEvoke = null;
let currentEvokeRef = null; // points at the evoker stored as sentence 0 in the active sandpit
let executingBody = false;

function registerValue(reg) {
  if (reg == null) return null;
  if (typeof reg === "number") return reg;
  if (typeof reg === "object" && typeof reg.num === "number") return reg.num;
  return null;
}

async function invokeLoop(defEntry, sentence) {
  const initialTloh = registerValue(sentence.tloh);
  if (initialTloh == null) throw new Error("tloh is required to loop");
  const untilSeed = registerValue(sentence.until);

  const body = dumpMemory().slice(defEntry.index + 1, defEntry.end); // exclude def; include body and prah
  let lastResult;
  currentEvoke = { ...sentence, tloh: sentence.tloh ?? initialTloh, until: sentence.until ?? untilSeed };

  pushMemoryContext({ seedFromCurrent: true });
  currentEvokeRef = currentEvoke;
  executingBody = true;
  lastCondition = true;

  let sandpit = [];

  try {
    let currentTloh = registerValue(currentEvokeRef.tloh);
    let currentUntil = untilSeed;

    while (true) {
      currentEvokeRef.tloh = currentTloh;
      currentEvokeRef.until = currentUntil ?? currentEvokeRef.until;

      for (const step of body) {
        lastResult = await interpret(step);
        if (step.mood === "then" && lastCondition === false) {
          lastCondition = true;
          break;
        }
      }

      const updatedTloh = registerValue(currentEvokeRef.tloh);
      const updatedUntil = registerValue(currentEvokeRef.until ?? currentUntil);

      const effectiveTloh = updatedTloh ?? currentTloh;
      const effectiveUntil = updatedUntil ?? currentUntil;

      const shouldStop = effectiveUntil != null ? effectiveTloh === effectiveUntil : effectiveTloh === 0;
      if (shouldStop) {
        currentTloh = effectiveTloh;
        currentUntil = effectiveUntil;
        currentEvokeRef.tloh = currentTloh;
        currentEvokeRef.until = currentUntil;
        break;
      }

      const direction = effectiveUntil != null ? (effectiveTloh < effectiveUntil ? 1 : -1) : -1;
      const next = (effectiveTloh ?? currentTloh) + direction;
      const reachedAfterStep = effectiveUntil != null ? next === effectiveUntil : next === 0;
      currentTloh = next;
      currentUntil = effectiveUntil;
      if (reachedAfterStep) {
        currentEvokeRef.tloh = next;
        currentEvokeRef.until = effectiveUntil;
        break;
      }
    }
    sandpit = [currentEvokeRef, ...dumpMemory()];
  } finally {
    recordSandpitTrace(sandpit);
    popMemoryContext();
    executingBody = false;
  }

  const finalEvoke = currentEvokeRef || currentEvoke || sentence;
  const mergedObj = (lastResult?.value ?? lastResult?.obj) || finalEvoke.obj;
  const mergedBe = finalEvoke.be || "result";

  if (mergedObj !== undefined) {
    const normalizedObj = typeof mergedObj === "object" ? mergedObj : { num: mergedObj };
    const evokeWithResult = { ...finalEvoke, obj: normalizedObj };
    setMemory(evokeWithResult);

    if (evokeWithResult.to?.name) {
      setMemory({ subj: { name: evokeWithResult.to.name }, obj: normalizedObj, be: mergedBe, mood: "ya" });
      setMemory({ subj: { name: "result" }, obj: normalizedObj, be: mergedBe, mood: "ya" });
    }

    currentEvoke = null;
    currentEvokeRef = null;
    return { invoked: finalEvoke.be, result: normalizedObj };
  }

  setMemory(finalEvoke);
  currentEvoke = null;
  currentEvokeRef = null;
  return lastResult;
}

export async function interpret(sentence) {
  if (!sentence) return;

  const { mood, be, subj, obj, to, from } = sentence;

  // one-line skip after a false condition
  if (!lastCondition && mood !== "then") {
    lastCondition = true;
    return { skipped: true };
  }

  const isParagraphDef = mood === "def" && sentence.be === "ceremony";
  const insideParagraph = definitionStack.length > 0;

  if (isParagraphDef) {
    definitionStack.push(subj?.name ?? null);
  }

  if (insideParagraph && !executingBody && mood !== "prah" && !isParagraphDef) {
    setMemory(sentence);
    return { recorded: true };
  }

  if (mood === "prah") {
    setMemory(sentence);
    if (definitionStack.length > 0) definitionStack.pop();
    return { paragraphEnd: true };
  }

  // --- Conditional ---
  if (mood === "then") {
    const fn = verbs[be];
    if (!fn) throw new Error(`Unknown verb: ${be}`);
    let subjValue = subj;
    if (subj?.name) {
      const target = getMemory(subj.name);
      if (!target) throw new Error(`Unknown subj: ${subj.name}`);
      subjValue = target.obj;
    }
    const truth = await fn({ subj: subjValue ?? obj, from });
    lastCondition = truth;
    return { condition: truth };
  }

  // --- Declarative (including definitions): append; last-write-wins via getMemory ---
  if (mood === "ya" && (subj?.name === "this" || obj?.thisRef)) {
    const resolved = resolveThisValue(obj, currentEvokeRef || currentEvoke);
    if (resolved != null) {
      const targetName = subj?.name === "this" ? obj?.name : subj?.name;
      if (!targetName) throw new Error("this binding requires a target name");
      return interpret({ ...sentence, subj: { name: targetName }, obj: resolved, mood: "ya" });
    }
  }

  if (mood === "ret" && currentEvokeRef) {
    const sourceName = sentence?.ret?.name || sentence?.obj?.name;
    let merged = { ...currentEvokeRef };

    if (sourceName) {
      const fact = getMemory(sourceName);
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

    merged.mood = currentEvokeRef.mood;
    merged.be = currentEvokeRef.be;

    Object.assign(currentEvokeRef, merged);
    return { returned: "evoke", value: merged.obj ?? merged };
  }

  if (mood === "ya" || mood === "def") {
    setMemory(sentence);
    return { stored: subj?.name };
  }

  // --- Imperative ---
  if (mood === "do") {
    const fn = verbs[be];
    const defEntry = fn ? null : getDefinitionEntry(be);
    const hasLoopRegisters = sentence.tloh != null || sentence.until != null;

    if (!fn && defEntry) {
      if (typeof defEntry.end !== "number") {
        throw new Error(`Definition ${be} missing closing prah`);
      }

      if (sentence.subj?.name === "tloh" || sentence.be === "tloh") {
        throw new Error("tloh reserved for loop control");
      }

      if (hasLoopRegisters) {
        const lastResult = await invokeLoop(defEntry, sentence);
        return { invoked: be, result: lastResult };
      }

      if (typeof defEntry.end !== "number") {
        throw new Error(`Definition ${be} missing closing prah`);
      }

      // isolate execution in a sandpit to avoid cluttering main memory
      const body = dumpMemory().slice(defEntry.index + 1, defEntry.end); // skip prah (end is exclusive)
      let lastResult;
      const evokeSeed = { ...sentence };
      currentEvoke = evokeSeed;
      executingBody = true;
      pushMemoryContext({ seedFromCurrent: true });
      currentEvokeRef = evokeSeed;
      for (const step of body) {
        lastResult = await interpret(step);
        if (step.mood === "then" && lastCondition === false) {
          lastCondition = true;
          break;
        }
      }
      const sandpit = [currentEvokeRef, ...dumpMemory()];
      const updatedTarget = to?.name ? getMemory(to.name) : null;
      recordSandpitTrace(sandpit);
      popMemoryContext();
      executingBody = false;
      const evoke = currentEvokeRef || currentEvoke || sentence;
      currentEvoke = null;
      currentEvokeRef = null;

      // merge updates from sandpit
      const mergedObj = (lastResult?.value ?? lastResult?.obj) || updatedTarget?.obj || evoke.obj;
      const mergedBe = evoke.be || updatedTarget?.be || "result";

      if (mergedObj) {
        const normalizedObj = typeof mergedObj === "object" ? mergedObj : { num: mergedObj };
        const updatedEvoke = { ...evoke, obj: normalizedObj };
        setMemory(updatedEvoke);

        if (to?.name) {
          setMemory({ subj: { name: to.name }, obj: normalizedObj, be: mergedBe, mood: "ya" });
          setMemory({ subj: { name: "result" }, obj: normalizedObj, be: mergedBe, mood: "ya" });
        }
      } else {
        setMemory(evoke);
      }

      return { invoked: be, result: mergedObj ?? lastResult };
    }

    if (!fn) throw new Error(`Unknown verb: ${be}`);

    let target = getMemory(to?.name);
    if (!target && to?.name) {
      // create default numeric fact if it doesn't exist
      target = { subj: { name: to.name }, be: "number", obj: { num: 0 }, mood: "ya" };
      setMemory(target);
    }

    const toValue = target?.obj ?? to;

    // pass the current value, not the name
    const result = await fn({ obj, to: toValue, from, sentence });

    // record the command itself in history
    setMemory(sentence);

    // expect verbs to return { obj: number | {num: number} }
    if (result?.obj !== undefined) {
      // ensure a target fact exists if user addressed one
      const dest =
        target ||
        (to?.name
          ? {
              subj: { name: to.name },
              be: sentence.to?.context || sentence.be || "result",
              obj: {},
              mood: "ya",
            }
          : sentence?.subj
          ? {
              subj: sentence.subj,
              be: sentence.be === "read" ? "text" : sentence.be || "result",
              obj: {},
              mood: "ya",
            }
          : null);

      const normalizedObj =
        typeof result.obj === "object" ? result.obj : { num: result.obj };
      const resultBe = result.be ?? sentence.be ?? "result";

      if (dest) {
        dest.obj = normalizedObj;
        if (!dest.be) dest.be = resultBe;
        setMemory(dest);
      }

      // Always store a result fact for reference
      setMemory({
        subj: { name: "result" },
        obj: normalizedObj,
        be: resultBe,
        mood: "ya"
      });
    }

    return { acted: to?.name, value: result?.obj };
  }

  // --- Interrogative ---
  if (mood === "que") {
    const fact = getMemory(subj?.name);
    if (!fact) return null;

    // For now your tests want the whole matching sentence as Pyash
    return sentenceToPyash(fact);
  }

  throw new Error(`Unknown mood: ${mood}`);
}

export { dumpMemory };
