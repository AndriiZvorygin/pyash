import { invokeLoop, runDefinitionBody } from "./sandpit.mjs";

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

  const fn = verbs[be];
  const defEntry = fn ? null : getDefinitionEntry(be);
  const hasLoopRegisters = sentence.tloh != null || sentence.until != null;

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
  const callSentence = { ...sentence, obj, to: toValue ?? to, from, sentence };

  // pass a single enriched sentence payload
  const result = await fn(callSentence);

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
