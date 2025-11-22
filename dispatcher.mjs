// dispatcher.mjs
import { add } from "./verbs/add.mjs";
import { giant } from "./verbs/giant.mjs";
import compile from "./verbs/compile.mjs";
import read from "./verbs/read.mjs";
import mind from "./verbs/mind.mjs";
import { getMemory, setMemory, dumpMemory, getDefinitionEntry } from "./memory.mjs";
import { sentenceToPyash } from "./pretty.mjs";

const verbs = { add, giant, compile, read, mind };
let lastCondition = true;
const definitionStack = [];

function getTloh() {
  const fact = getMemory("tloh");
  return fact?.obj?.num ?? null;
}

function setTlohValue(num) {
  setMemory({
    subj: { name: "tloh" },
    obj: { num },
    be: "number",
    mood: "ya"
  });
}

function getUntil() {
  const fact = getMemory("until");
  return fact?.obj?.num ?? null;
}

function setUntilValue(num) {
  setMemory({
    subj: { name: "until" },
    obj: { num },
    be: "number",
    mood: "ya"
  });
}

async function invokeLoop(defEntry, sentence) {
  let tloh = sentence.obj?.num ?? getTloh();
  if (tloh == null) throw new Error("tloh is required to loop");
  const untilSeed = getUntil();

  setTlohValue(tloh);
  if (untilSeed != null) setUntilValue(untilSeed);

  const body = dumpMemory().slice(defEntry.index + 1, defEntry.end);
  let lastResult;

  while (true) {
    for (const step of body) {
      lastResult = await interpret(step);
    }

    const current = getTloh();
    const until = getUntil();
    const direction =
      until != null
        ? (current ?? tloh) < until ? 1 : -1
        : -1;
    const next = (current != null ? current : tloh) + direction;
    setTlohValue(next);

    const done =
      until != null
        ? next === until
        : next === 0;
    if (done) break;
    tloh = next;
  }

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

  if (insideParagraph && mood !== "prah" && !isParagraphDef) {
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
    const target = getMemory(subj?.name);
    if (!target) throw new Error(`Unknown subj: ${subj?.name}`);
    const truth = await fn({ subj: target.obj, from });
    lastCondition = truth;
    return { condition: truth };
  }

  // --- Declarative (including definitions): append; last-write-wins via getMemory ---
  if (mood === "ya" || mood === "def") {
    setMemory(sentence);
    return { stored: subj?.name };
  }

  // --- Imperative ---
  if (mood === "do") {
    const fn = verbs[be];
    const defEntry = fn ? null : getDefinitionEntry(be);

    if (!fn && defEntry) {
      if (typeof defEntry.end !== "number") {
        throw new Error(`Definition ${be} missing closing prah`);
      }

      if (sentence.subj?.name === "tloh" || sentence.be === "tloh") {
        throw new Error("tloh reserved for loop control");
      }

      if (sentence.obj?.num != null || getMemory("tloh")) {
        const lastResult = await invokeLoop(defEntry, sentence);
        setMemory(sentence);
        return { invoked: be, result: lastResult };
      }

      if (typeof defEntry.end !== "number") {
        throw new Error(`Definition ${be} missing closing prah`);
      }

      const body = dumpMemory().slice(defEntry.index + 1, defEntry.end);
      let lastResult;
      for (const step of body) {
        lastResult = await interpret(step);
      }

      setMemory(sentence);
      return { invoked: be, result: lastResult };
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
