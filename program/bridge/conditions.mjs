// Conditional handling for "then" mood
import { deriveSignatureFromCall, joinSignatureWords, lookupSignatureHandler, lookupHandlersForVerb } from "./signature.mjs";

export async function handleCondition(sentence, { state, verbs, remember }) {
  const { be, subj, obj, from } = sentence;

  let fn = verbs[be];
  const sigWords = deriveSignatureFromCall(sentence, { remember });
  if (sigWords) {
    const key = joinSignatureWords(sigWords);
    fn = lookupSignatureHandler(key) ?? fn;
  }
  if (!fn) {
    const handlers = lookupHandlersForVerb(be);
    if (handlers.size === 1) fn = [...handlers][0];
  }
  if (!fn) throw new Error(`Unknown verb: ${be}`);

  let subjValue = subj;
  if (subj?.name) {
    const target = remember(subj.name);
    if (!target) throw new Error(`Unknown subj: ${subj.name}`);
    subjValue = target.obj;
  }

  const fromValue =
    from?.name && remember(from.name)?.obj !== undefined
      ? remember(from.name).obj
      : from;

  const truth = await fn({ subj: subjValue ?? obj, from: fromValue });
  state.lastCondition = truth;
  return { condition: truth };
}
