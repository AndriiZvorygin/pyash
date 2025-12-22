// bridge (formerly dispatcher)
import { add, subtract, invert, exponential, multiply, divide, produce, neuron, twiceCrescent, chip, understand, read, mind, giant, tiny, equally } from "../verbs/index.mjs";
import { remember, doRemember, allRemember, getDefinition, getDefinitionEntry, pushMemoryContext, popMemoryContext, recordSandpitTrace } from "../remember/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";
import { handleCondition } from "./conditions.mjs";
import { handleThisBinding, handleReturn } from "./returns.mjs";
import { handleImperative } from "./imperative.mjs";
import { state } from "./state.mjs";
import { deriveSignatureFromDefinition, registerSignature, registerSignatureHandler } from "./signature.mjs";
import { builtInSignatures } from "../verbs/index.mjs";

function resolveFillCount(by, remember) {
  if (!by) return null;
  if (typeof by.num === "number") return by.num;
  if (typeof by.name === "string") return remember(by.name)?.obj?.num ?? null;
  if (by.genitive?.chain?.length) {
    const [root, ...rest] = by.genitive.chain;
    let curr = root === "this" ? null : remember(root);
    for (const part of rest) {
      if (curr == null) break;
      curr = curr[part];
    }
    if (typeof curr === "number") return curr;
    if (typeof curr?.num === "number") return curr.num;
  }
  return null;
}

for (const sig of builtInSignatures) {
  registerSignatureHandler(sig);
}

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
    return handleCondition(sentence, { state, remember });
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
    if (mood === "def" && be === "ceremony") {
      if (subj?.name && getDefinition(subj.name)) {
        console.warn(`ceremony redefined: ${subj.name}`);
      }
      const sig = deriveSignatureFromDefinition(sentence);
      if (sig) {
        sentence.signatureWords = sig;
        registerSignature({ name: subj?.name, signatureWords: sig });
      }
    }

    // Vector fill sugar: "obj ve <type> <value> by num N be vector ya"
    if (mood === "ya" && be === "vector" && sentence?.obj?.ve?.values?.length === 1) {
      const resolved = resolveFillCount(sentence.by, remember);
      const n = resolved == null ? null : Math.trunc(resolved);
      if (n > 0) {
        const elem = sentence.obj.ve.values[0];
        const filled = { ...sentence, obj: { ...(sentence.obj || {}), ve: { ...(sentence.obj.ve || {}), values: Array(n).fill(elem) } } };
        // Avoid persisting the fill-count as part of the stored fact.
        delete filled.by;
        doRemember(filled);
        return { stored: subj?.name };
      }
    }

    doRemember(sentence);
    return { stored: subj?.name };
  }

  // --- Imperative ---
  if (mood === "do") {
    if (sentence.exists) {
      throw new Error("exists is only valid on ya sentences");
    }
    const imperativeResult = await handleImperative({
      sentence,
      state,
      memory: { remember, doRemember, allRemember, pushMemoryContext, popMemoryContext, getDefinition },
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
