// verbs/equally.mjs
export function equally_subj_num_from_num({ subj, from }) {
  const subjVal = subj?.num ?? subj?.text ?? subj?.value ?? subj;
  const fromVal = from?.num ?? from?.text ?? from?.value ?? from;
  return subjVal === fromVal;
}

export const equally = equally_subj_num_from_num;

export const signatures = [
  { signatureWords: ["be", "equally", "from", "num", "subj", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "num", "obj", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "num", "obj", "name", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "num", "obj", "num"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text", "obj", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text", "obj", "name", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text"], handler: equally_subj_num_from_num }
];
