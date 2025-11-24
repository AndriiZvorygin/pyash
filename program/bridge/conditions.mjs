// Conditional handling for "then" mood
export async function handleCondition(sentence, { state, verbs, remember }) {
  const { be, subj, obj, from } = sentence;
  const fn = verbs[be];
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
