// verbs/equally.mjs
export function equally_subj_num_from_num({ su, from }) {
  const subjVal = su?.num ?? su?.text ?? su?.bool ?? su?.boolean ?? su?.value ?? su;
  const fromVal = from?.num ?? from?.text ?? from?.bool ?? from?.boolean ?? from?.value ?? from;
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
  { signatureWords: ["be", "equally", "from", "name", "text", "su", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "text", "ob", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "text", "ob", "name", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text", "ob", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text", "ob", "name", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "text"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "bool", "ob", "bool"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "bool"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "bool", "su", "bool"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "bool"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "bool", "ob", "bool"], handler: equally_subj_num_from_num },
  { signatureWords: ["be", "equally", "from", "name", "bool", "ob", "name", "bool"], handler: equally_subj_num_from_num }
];
