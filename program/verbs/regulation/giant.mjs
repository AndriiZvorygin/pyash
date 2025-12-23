// verbs/giant.mjs
export function giant_subj_num_from_num({ su, from }) {
  const subjVal =
    su?.num ?? su?.value ?? (typeof su === "number" ? su : 0);
  const fromVal =
    from?.num ?? from?.value ?? (typeof from === "number" ? from : 0);
  return subjVal > fromVal;
}

export const giant = giant_subj_num_from_num;

export const signatures = [
  { signatureWords: ["be", "giant", "from", "num", "su", "num"], handler: giant_subj_num_from_num },
  { signatureWords: ["be", "giant", "from", "num"], handler: giant_subj_num_from_num },
  { signatureWords: ["be", "giant", "from", "num", "ob", "num"], handler: giant_subj_num_from_num },
  { signatureWords: ["be", "giant", "from", "num", "ob", "name", "num"], handler: giant_subj_num_from_num },
  { signatureWords: ["be", "giant", "from", "name", "num", "su", "num"], handler: giant_subj_num_from_num },
  { signatureWords: ["be", "giant", "from", "name", "num"], handler: giant_subj_num_from_num },
  { signatureWords: ["be", "giant", "from", "name", "num", "ob", "num"], handler: giant_subj_num_from_num },
  { signatureWords: ["be", "giant", "from", "name", "num", "ob", "name", "num"], handler: giant_subj_num_from_num }
];
