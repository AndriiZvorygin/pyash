import { invokeLoop, runDefinitionBody } from "./sandpit.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature, lookupSignatureHandler } from "./signature.mjs";

export async function handleImperative({
  sentence,
  state,
  memory,
  recordSandpitTrace,
  getDefinitionEntry,
  interpret
}) {
  const { mood, be, obj, to, from, subj } = sentence;
  if (mood !== "do") return null;

  let fn = null;
  let defEntry = getDefinitionEntry(be);
  const hasLoopRegisters = sentence.tloh != null || sentence.until != null;

  const sigWords = deriveSignatureFromCall(sentence, { remember: memory.remember });
  let sigKey = null;
  if (sigWords) {
    sigKey = joinSignatureWords(sigWords);
    if (!fn) {
      const handler = lookupSignatureHandler(sigKey);
      if (handler) fn = handler;
    }
    if (!fn && !defEntry) {
      const defName = lookupSignature(sigKey);
      if (defName) defEntry = getDefinitionEntry(defName);
    }
  }

  if (!fn && !defEntry && sigKey) {
    throw new Error(`Unknown verb: ${be}`);
  }

  if (!fn && defEntry) {
    if (subj?.name === "tloh" || sentence.be === "tloh") {
      throw new Error("tloh reserved for loop control");
    }

    if (hasLoopRegisters) {
      const lastResult = await invokeLoop({
        defEntry,
        sentence,
        state,
        memory,
        interpret,
        recordSandpitTrace
      });
      return { invoked: be, result: lastResult };
    }

    if (typeof defEntry.end !== "number") {
      throw new Error(`Definition ${be} missing closing prah`);
    }

    const defResult = await runDefinitionBody({
      defEntry,
      sentence,
      state,
      memory,
      interpret,
      recordSandpitTrace
    });

    return defResult;
  }

  if (!fn) throw new Error(`Unknown verb: ${be}`);

  const addressedName = to?.name || (be === "subtract" ? sentence.from?.name : undefined);
  let target = addressedName ? memory.remember(addressedName) : memory.remember(to?.name);
  const shouldBootstrapNumber = addressedName && ["add", "subtract", "multiply", "divide", "invert", "exponential", "produce", "chip", "twicecrescent"].includes((be || "").replace(/\s+/g, "").toLowerCase());
  if (!target && shouldBootstrapNumber) {
    // create default numeric fact if it doesn't exist for math-like verbs
    target = { subj: { name: addressedName }, be: "number", obj: { num: 0 }, mood: "ya" };
    memory.doRemember(target);
  }

  const toValue = target?.obj ?? to;

  // pass the current value, not the name
  const callSentence = { ...sentence, obj: obj ?? sentence.obj, to: toValue ?? to ?? sentence.to, from: from ?? sentence.from };

  const result = await fn(callSentence, { remember: memory.remember });

  // record the command itself in history
  memory.doRemember(sentence);

  // expect verbs to return { obj: number | {num: number} }
  if (result?.obj !== undefined) {
    // ensure a target fact exists if user addressed one
    const targetBe = sentence.to?.context || sentence.become?.name || sentence.be || "result";
    const dest =
      target ||
      (addressedName
        ? {
            subj: { name: addressedName },
            be: targetBe,
            obj: {},
            mood: "ya",
          }
        : to?.name
        ? {
            subj: { name: to.name },
            be: targetBe,
            obj: {},
            mood: "ya",
          }
        : sentence?.subj
        ? {
            subj: sentence.subj,
            be: sentence.be === "read" ? "text" : targetBe,
            obj: {},
            mood: "ya",
          }
        : null);

    const normalizedObj =
      typeof result.obj === "object" ? result.obj : { num: result.obj };
    const resultBe = result.be ?? targetBe;

    if (dest) {
      dest.obj = normalizedObj;
      if (!dest.be) dest.be = resultBe;
      memory.doRemember(dest);
    }

    // Always store a result fact for reference
    memory.doRemember({
      subj: { name: "result" },
      obj: normalizedObj,
      be: resultBe,
      mood: "ya"
    });
  }

  return { acted: to?.name, value: result?.obj };
}
