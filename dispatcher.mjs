import { add } from "./verbs/add.mjs";
import { giant } from "./verbs/giant.mjs";
import { getMemory, setMemory, dumpMemory, logSentence } from "./memory.mjs";

const verbs = { add, giant };
let lastCondition = true; // default: execute until a false conditional blocks

export async function interpret(sentence) {
  if (!sentence) return;

  // log everything we see
  logSentence(sentence);

  const { mood, be, subj, obj, to, from } = sentence;

  // Skip any statement if previous condition was false and this isn't a new condition
  if (!lastCondition && mood !== "then") {
    lastCondition = true; // reset after skipping one line
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

  // --- Declarative ---
  if (mood === "ya") {
    const existing = getMemory(subj?.name);
    if (existing) Object.assign(existing, sentence);
    else setMemory(sentence);
    return { stored: subj?.name };
  }

  // --- Imperative ---
  if (mood === "do") {
    const fn = verbs[be];
    if (!fn) throw new Error(`Unknown verb: ${be}`);

    // the 'to' may be a variable name, not an in-memory object
    let target = getMemory(to?.name);
    if (!target && to?.name) {
      // create placeholder if it doesn’t exist yet
      target = { subj: { name: to.name }, be: "number", obj: { num: 0 } };
      setMemory(target);
    }

    const result = await fn({ obj, to });
    if (result?.obj !== undefined && target) {
      target.obj =
        typeof result.obj === "object" ? result.obj : { num: result.obj };
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
