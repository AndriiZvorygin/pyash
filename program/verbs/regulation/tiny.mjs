// verbs/tiny.mjs
export function tiny_subj_num_from_num({ su, from }) {
  const subjVal =
    su?.num ?? su?.value ?? (typeof su === "number" ? su : 0);
  const fromVal =
    from?.num ?? from?.value ?? (typeof from === "number" ? from : 0);
  return subjVal < fromVal;
}

export const tiny = tiny_subj_num_from_num;

export const signatures = [
  { signatureWords: ["be", "tiny", "from", "num", "su", "num"], handler: tiny_subj_num_from_num },
  { signatureWords: ["be", "tiny", "from", "num"], handler: tiny_subj_num_from_num },
  { signatureWords: ["be", "tiny", "from", "num", "ob", "num"], handler: tiny_subj_num_from_num },
  { signatureWords: ["be", "tiny", "from", "num", "ob", "name", "num"], handler: tiny_subj_num_from_num },
  { signatureWords: ["be", "tiny", "from", "name", "num", "su", "num"], handler: tiny_subj_num_from_num },
  { signatureWords: ["be", "tiny", "from", "name", "num"], handler: tiny_subj_num_from_num },
  { signatureWords: ["be", "tiny", "from", "name", "num", "ob", "num"], handler: tiny_subj_num_from_num },
  { signatureWords: ["be", "tiny", "from", "name", "num", "ob", "name", "num"], handler: tiny_subj_num_from_num }
];
