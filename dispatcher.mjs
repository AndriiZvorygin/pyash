// dispatcher.mjs (only the ya part needs a tweak)
import { add } from "./verbs/add.mjs";
import { giant } from "./verbs/giant.mjs";
import { getMemory, setMemory, dumpMemory } from "./memory.mjs";

const verbs = { add, giant };
let lastCondition = true;

export async function interpret(sentence) {
  if (!sentence) return;

  const { mood, be, subj, obj, to, from } = sentence;

  if (!lastCondition && mood !== "then") {
    lastCondition = true;
    return { skipped: true };
  }

  if (mood === "then") {
    const fn = verbs[be];
    if (!fn) throw new Error(`Unknown verb: ${be}`);
    const target = getMemory(subj?.name);
    if (!target) throw new Error(`Unknown subj: ${subj?.name}`);
    const truth = await fn({ subj: target.obj, from });
    lastCondition = truth;
    return { condition: truth };
  }

  // --- Declarative: always append; getMemory will take the latest ---
  if (mood === "ya") {
    setMemory(sentence);
    return { stored: subj?.name };
  }

  // --- Imperative ---
  if (mood === "do") {
    const fn = verbs[be];
    if (!fn) throw new Error(`Unknown verb: ${be}`);

    let target = getMemory(to?.name);
    if (!target && to?.name) {
      target = { subj: { name: to.name }, be: "number", obj: { num: 0 } };
      setMemory(target);
    }

    const result = await fn({ obj, to });
    if (result?.obj !== undefined && target) {
      target.obj =
        typeof result.obj === "object" ? result.obj : { num: result.obj };
      // store updated fact as a new sentence
      setMemory(target);
    }
    return { acted: to?.name, value: result.obj };
  }

  // --- Interrogative ---
  if (mood === "que") {
    const fact = getMemory(subj?.name);
    if (!fact) return { answer: null };
    if (obj?.name === "what" || obj?.num === "what") {
      return { answer: fact.obj };
    }
    return { answer: fact };
  }

  throw new Error(`Unknown mood: ${mood}`);
}

export { dumpMemory };
