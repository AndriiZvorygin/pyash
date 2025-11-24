// bridge (formerly dispatcher)
import { add } from "../verbs/add.mjs";
import { giant } from "../verbs/giant.mjs";
import { tiny } from "../verbs/tiny.mjs";
import { equally } from "../verbs/equally.mjs";
import { subtract } from "../verbs/subtract.mjs";
import compile from "../verbs/compile.mjs";
import read from "../verbs/read.mjs";
import mind from "../verbs/mind.mjs";
import { remember, doRemember, allRemember, getDefinitionEntry, pushMemoryContext, popMemoryContext, recordSandpitTrace } from "../remember/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { resolveThisValue } from "../library/thisBinding.mjs";

const verbs = { add, giant, tiny, equally, subtract, compile, read, mind };
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

  const body = allRemember().slice(defEntry.index + 1, defEntry.end); // exclude def; include body and prah
  let lastResult;
  currentEvoke = { ...sentence, tloh: sentence.tloh ?? initialTloh, until: sentence.until ?? untilSeed };

  pushMemoryContext({ seedFromCurrent: true });
  currentEvokeRef = currentEvoke;
  executingBody = true;
  lastCondition = true;

  let sandpit = [];
  let updatedTarget = null;

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
    updatedTarget = sentence.to?.name ? remember(sentence.to.name) : null;
    sandpit = [currentEvokeRef, ...allRemember()];
  } finally {
    recordSandpitTrace(sandpit);
    popMemoryContext();
    executingBody = false;
  }

  const finalEvoke = currentEvokeRef || currentEvoke || sentence;
  const mergedObj = (lastResult?.value ?? lastResult?.obj) ?? finalEvoke.obj;
  const mergedBe = finalEvoke.be || "result";

  if (mergedObj !== undefined) {
    const normalizedObj = typeof mergedObj === "object" ? mergedObj : { num: mergedObj };
    const evokeWithResult = { ...(currentEvokeRef || finalEvoke), obj: normalizedObj };
    doRemember(evokeWithResult);

    const targetName = evokeWithResult.to?.name;
    if (targetName) {
      const targetObj = updatedTarget?.obj ?? normalizedObj;
      const targetBe = updatedTarget?.be ?? mergedBe;
      doRemember({ subj: { name: targetName }, obj: targetObj, be: targetBe, mood: "ya" });
      doRemember({ subj: { name: "result" }, obj: normalizedObj, be: mergedBe, mood: "ya" });
    }

    currentEvoke = null;
    currentEvokeRef = null;
    return { invoked: finalEvoke.be, result: normalizedObj };
  }

  doRemember(finalEvoke);
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
    doRemember(sentence);
    return { recorded: true };
  }

  if (mood === "prah") {
    doRemember(sentence);
    if (definitionStack.length > 0) definitionStack.pop();
    return { paragraphEnd: true };
  }

  // --- Conditional ---
  if (mood === "then") {
    const fn = verbs[be];
    if (!fn) throw new Error(`Unknown verb: ${be}`);
    let subjValue = subj;
    if (subj?.name) {
      const target = remember(subj.name);
      if (!target) throw new Error(`Unknown subj: ${subj.name}`);
      subjValue = target.obj;
    }
    const fromValue =
      from?.name && remember(from.name)?.obj !== undefined
        ? remember(from.name).obj
        : from;
    const truth = await fn({ subj: subjValue ?? obj, from: fromValue });
    lastCondition = truth;
    return { condition: truth };
  }

  // --- Declarative (including definitions): append; last-write-wins via remember ---
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

    merged.mood = currentEvokeRef.mood;
    merged.be = currentEvokeRef.be;

    Object.assign(currentEvokeRef, merged);
    return { returned: "evoke", value: merged.obj ?? merged };
  }

  if (mood === "ya" || mood === "def") {
    doRemember(sentence);
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
      const body = allRemember().slice(defEntry.index + 1, defEntry.end); // skip prah (end is exclusive)
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
      const sandpit = [currentEvokeRef, ...allRemember()];
      const updatedTarget = to?.name ? remember(to.name) : null;
      recordSandpitTrace(sandpit);
      popMemoryContext();
      executingBody = false;
      const evoke = currentEvokeRef || currentEvoke || sentence;
      currentEvoke = null;
      currentEvokeRef = null;

      // merge updates from sandpit
      const mainTarget = to?.name ? remember(to.name) : null;
      const lastVal = lastResult?.value ?? lastResult?.obj;
      const preferredVal =
        lastVal && typeof lastVal === "object" && lastVal.num === undefined && lastVal.mood
          ? undefined // likely an evoker; ignore
          : lastVal;
      const mergedObj = preferredVal ?? updatedTarget?.obj ?? mainTarget?.obj ?? evoke.obj ?? 0;
      const mergedBe = evoke.be || updatedTarget?.be || "result";

      if (mergedObj !== undefined) {
        const normalizedObj = typeof mergedObj === "object" ? mergedObj : { num: mergedObj };
        const updatedEvoke = { ...evoke, obj: normalizedObj };
        doRemember(updatedEvoke);

        if (to?.name) {
          doRemember({ subj: { name: to.name }, obj: normalizedObj, be: mergedBe, mood: "ya" });
          doRemember({ subj: { name: "result" }, obj: normalizedObj, be: mergedBe, mood: "ya" });
        }
      } else {
        doRemember(evoke);
      }

      return { invoked: be, result: mergedObj ?? lastResult };
    }

    if (!fn) throw new Error(`Unknown verb: ${be}`);

    const addressedName = to?.name || (be === "subtract" ? sentence.from?.name : undefined);
    let target = addressedName ? remember(addressedName) : remember(to?.name);
    if (!target && addressedName) {
      // create default numeric fact if it doesn't exist
      target = { subj: { name: addressedName }, be: "number", obj: { num: 0 }, mood: "ya" };
      doRemember(target);
    }

    const toValue = target?.obj ?? to;

    // pass the current value, not the name
    const result = await fn({ obj, to: toValue, from, sentence });

    // record the command itself in history
    doRemember(sentence);

    // expect verbs to return { obj: number | {num: number} }
    if (result?.obj !== undefined) {
      // ensure a target fact exists if user addressed one
      const dest =
        target ||
        (addressedName
          ? {
              subj: { name: addressedName },
              be: sentence.to?.context || sentence.be || "result",
              obj: {},
              mood: "ya",
            }
          : to?.name
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
        doRemember(dest);
      }

      // Always store a result fact for reference
      doRemember({
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
    const fact = remember(subj?.name);
    if (!fact) return null;

    // For now your tests want the whole matching sentence as Pyash
    return sentenceToPyash(fact);
  }

  throw new Error(`Unknown mood: ${mood}`);
}

export { allRemember };
