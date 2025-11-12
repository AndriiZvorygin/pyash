import { add } from "./verbs/add.mjs";

const verbs = { add };
const memory = [];  // all sentences

export function interpret(sentence) {
  memory.push(sentence);
  const { mood } = sentence;

  // --- Declarative (ya) ---
  if (mood === "ya") {
    // simply record; nothing else needed now
    return { stored: true, mood };
  }

  // --- Imperative (do) ---
  if (mood === "do") {
    const { be, obj, to } = sentence;
    const fn = verbs[be];
    if (!fn) throw new Error(`Unknown verb: ${be}`);

    // find the latest matching sentence with subj/to name
    const target = memory
      .slice()
      .reverse()
      .find(s => s.subj?.name === to?.name);

    const currentVal = target?.obj?.num ?? 0;
    const result = fn({ obj: obj.num, to: currentVal });

    // create a new declarative sentence reflecting the result
    const update = {
      mood: "ya",
      subj: { name: to.name },
      obj: { num: result.obj },
      be: target?.be ?? "number"
    };
    memory.push(update);

    return update;
  }

  // --- Interrogative (que) ---
  if (mood === "que") {
    const { subj, be, obj } = sentence;
    const target = memory
      .slice()
      .reverse()
      .find(s => s.subj?.name === subj?.name && (!be || s.be === be));

    if (!target)
      return { answer: null };

    if (obj?.num === "what" || obj?.name === "what")
      return { answer: target.obj };

    return { answer: target };
  }

  throw new Error(`Unknown mood: ${mood}`);
}

export function dumpMemory() {
  return memory;
}
