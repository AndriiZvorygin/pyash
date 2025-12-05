// verbs/equally.mjs
export function equally_subj_num_from_num({ subj, from }) {
  const subjVal = subj?.num ?? subj?.value ?? subj;
  const fromVal = from?.num ?? from?.value ?? from;
  return subjVal === fromVal;
}

export const equally = equally_subj_num_from_num;

export const signatures = [
  { signatureWords: ["be", "equally", "from", "num", "subj", "num"], handler: equally_subj_num_from_num }
];
