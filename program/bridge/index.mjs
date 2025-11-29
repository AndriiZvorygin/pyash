// bridge (formerly dispatcher)
import { add, subtract, multiply, divide, chip, compile, read, mind, giant, tiny, equally } from "../verbs/index.mjs";
import { remember, doRemember, allRemember, getDefinitionEntry, pushMemoryContext, popMemoryContext, recordSandpitTrace } from "../remember/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { handleCondition } from "./conditions.mjs";
import { handleThisBinding, handleReturn } from "./returns.mjs";
import { handleImperative } from "./imperative.mjs";
import { state } from "./state.mjs";

const verbs = { add, subtract, multiply, divide, chip, compile, read, mind, giant, tiny, equally };

export async function interpret(sentence) {
  if (!sentence) return;

  const { mood, be, subj, obj, to, from } = sentence;

  // one-line skip after a false condition
  if (!state.lastCondition && mood !== "then") {
    state.lastCondition = true;
    return { skipped: true };
  }

  const isParagraphDef = mood === "def" && sentence.be === "ceremony";
  const insideParagraph = state.definitionStack.length > 0;

  if (isParagraphDef) {
    state.definitionStack.push(subj?.name ?? null);
  }

  if (insideParagraph && !state.executingBody && mood !== "prah" && !isParagraphDef) {
    doRemember(sentence);
    return { recorded: true };
  }

  if (mood === "prah") {
    doRemember(sentence);
    if (state.definitionStack.length > 0) state.definitionStack.pop();
    return { paragraphEnd: true };
  }

  // --- Conditional ---
  if (mood === "then") {
    return handleCondition(sentence, { state, verbs, remember });
  }

  // --- Declarative (including definitions): append; last-write-wins via remember ---
  const thisBound = handleThisBinding(sentence, state);
  if (thisBound) {
    return interpret(thisBound);
  }

  const retResult = handleReturn(sentence, state, remember);
  if (retResult) {
    return retResult;
  }

  if (mood === "ya" || mood === "def") {
    doRemember(sentence);
    return { stored: subj?.name };
  }

  // --- Imperative ---
  if (mood === "do") {
    const imperativeResult = await handleImperative({
      sentence,
      verbs,
      state,
      memory: { remember, doRemember, allRemember, pushMemoryContext, popMemoryContext },
      recordSandpitTrace,
      getDefinitionEntry,
      interpret
    });
    if (imperativeResult) return imperativeResult;
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
