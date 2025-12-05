import { invokeLoop, runDefinitionBody } from "./sandpit.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature, lookupSignatureHandler, lookupHandlersForVerb } from "./signature.mjs";

export async function handleImperative({
  sentence,
  verbs,
  state,
  memory,
  recordSandpitTrace,
  getDefinitionEntry,
  interpret
}) {
  const { mood, be, obj, to, from, subj } = sentence;
  if (mood !== "do") return null;

  let fn = verbs[be];
  let defEntry = fn ? null : getDefinitionEntry(be);
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
    const verbHandlers = lookupHandlersForVerb(be);
    if (verbHandlers.size > 0) {
      throw new Error(`No handler for signature: ${sigKey}`);
    }
  }

  if (!fn && !defEntry) {
    const verbHandlers = lookupHandlersForVerb(be);
    if (verbHandlers.size === 1) {
      fn = [...verbHandlers][0];
    }
  }

  if (!fn && defEntry) {
    if (typeof defEntry.end !== "number") {
      throw new Error(`Definition ${be} missing closing prah`);
    }

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
  if (!target && addressedName) {
    // create default numeric fact if it doesn't exist
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
