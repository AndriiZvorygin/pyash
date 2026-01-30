// Conditional handling for "then" mood
import { deriveSignatureFromCall, joinSignatureWords, lookupSignatureHandler } from "./signature.mjs";

export async function handleCondition(sentence, { state, remember }) {
  const { be, su, ob, from } = sentence;

  let fn = null;
  const sigWords = deriveSignatureFromCall(sentence, { remember });
  if (sigWords) {
    const key = joinSignatureWords(sigWords);
    fn = lookupSignatureHandler(key) ?? fn;
  }
  if (!fn && sigWords) {
    const key = joinSignatureWords(sigWords);
    throw new Error(`Unknown verb: ${be}`);
  }
  if (!fn) throw new Error(`Unknown verb: ${be}`);

  let subjValue = su;
  if (su?.name) {
    const target = remember(su.name);
    if (!target) throw new Error(`Unknown su: ${su.name}`);
    subjValue = target.ob;
  } else if (ob?.name) {
    const target = remember(ob.name);
    if (target) subjValue = target.ob;
  }

  const fromValue =
    from?.name && remember(from.name)?.ob !== undefined
      ? remember(from.name).ob
      : from;

  const truth = await fn({ su: subjValue ?? ob, from: fromValue });
  state.lastCondition = truth;
  if (!sentence.consequence && !state.executingBody) {
    state.pendingCondition = truth;
  }
  return { condition: truth };
}
