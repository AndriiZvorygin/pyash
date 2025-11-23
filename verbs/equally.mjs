// verbs/equally.mjs
export function equally({ subj, from }) {
  const subjVal = subj?.num ?? subj?.value ?? subj;
  const fromVal = from?.num ?? from?.value ?? from;
  return subjVal === fromVal;
}
