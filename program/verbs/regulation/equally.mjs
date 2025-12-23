// verbs/equally.mjs
export function equally_subj_num_from_num({ su, from }) {
  const subjVal = su?.num ?? su?.text ?? su?.value ?? su;
  const fromVal = from?.num ?? from?.text ?? from?.value ?? from;
  return subjVal === fromVal;
}

export const equally = equally_subj_num_from_num;

export const signatures = [
  { signatureWords: ["be", "equally", "from", "num", "su", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "num", "ob", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "num", "ob", "name", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "num", "su", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "num", "ob", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text", "ob", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text", "ob", "name", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text"], handler: equally_subj_num_from_num }
];
