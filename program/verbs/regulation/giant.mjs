// verbs/giant.mjs
export function giant_subj_num_from_num({ subj, from }) {
  const subjVal = subj?.num ?? subj?.value ?? 0;
  const fromVal = from?.num ?? from?.value ?? 0;
  return subjVal > fromVal;
}

export const giant = giant_subj_num_from_num;

export const signatures = [
  { signatureWords: ["be", "giant", "from", "num"], handler: giant_subj_num_from_num }
];
