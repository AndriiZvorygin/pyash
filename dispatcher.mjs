// dispatcher.mjs
import { add } from "./verbs/add.mjs";
import { giant } from "./verbs/giant.mjs";
import compile from "./verbs/compile.mjs";
import { getMemory, setMemory, dumpMemory } from "./memory.mjs";
import { sentenceToPyash } from "./pretty.mjs";

const verbs = { add, giant, compile };
let lastCondition = true;

export async function interpret(sentence) {
  if (!sentence) return;

  const { mood, be, subj, obj, to, from } = sentence;

  // one-line skip after a false condition
  if (!lastCondition && mood !== "then") {
    lastCondition = true;
    return { skipped: true };
  }

  // --- Conditional ---
  if (mood === "then") {
    const fn = verbs[be];
    if (!fn) throw new Error(`Unknown verb: ${be}`);
    const target = getMemory(subj?.name);
    if (!target) throw new Error(`Unknown subj: ${subj?.name}`);
    const truth = await fn({ subj: target.obj, from });
    lastCondition = truth;
    return { condition: truth };
  }

  // --- Declarative: append; last-write-wins via getMemory ---
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
      // create default numeric fact if it doesn't exist
      target = { subj: { name: to.name }, be: "number", obj: { num: 0 }, mood: "ya" };
      setMemory(target);
    }

    // pass the current value, not the name
    const result = await fn({ obj, to: target?.obj, sentence });

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
          : null);

      if (dest) {
        dest.obj =
          typeof result.obj === "object" ? result.obj : { num: result.obj };
        // store updated fact as a new sentence so history is preserved
        setMemory(dest);
      }
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
