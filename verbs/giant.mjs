// verbs/giant.mjs
export function giant({ subj, from }) {
  const subjVal = subj?.num ?? subj?.value ?? 0;
  const fromVal = from?.num ?? from?.value ?? 0;
  return subjVal > fromVal;
}
