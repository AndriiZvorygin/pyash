// verbs/tiny.mjs
export function tiny_subj_num_from_num({ subj, from }) {
  const subjVal = subj?.num ?? subj?.value ?? 0;
  const fromVal = from?.num ?? from?.value ?? 0;
  return subjVal < fromVal;
}

export const tiny = tiny_subj_num_from_num;

export const signatures = [
  { signatureWords: ["be", "tiny", "from", "num"], handler: tiny_subj_num_from_num }
];
