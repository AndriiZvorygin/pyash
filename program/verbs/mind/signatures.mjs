const baseMindSignatureWords = [
  ["be", "write", "ob", "text", "to", "name", "mind", "vyah", "stream"],
  ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "vyah", "stream"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"],
  // Type-style target: write ... to name mind
  ["be", "write", "ob", "text", "to", "name", "mind"],
  ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map"],
  // New preferred form: for name <mind> to name <output>
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text"],
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "text"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text"],
  ["be", "write", "by", "num", "for", "name", "mind", "ob", "text", "to", "name", "text"],
  ["be", "write", "by", "num", "for", "name", "mind", "ob", "name", "text", "to", "name", "text"],
  ["be", "write", "by", "num", "for", "name", "mind", "ob", "text", "to", "text"],
  ["be", "write", "by", "num", "for", "name", "mind", "ob", "name", "text", "to", "text"],
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "with", "name", "map"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "with", "name", "map"],
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "with", "name", "map"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "with", "name", "map"],
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "vyah", "stream"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "vyah", "stream"],
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "vyah", "stream"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "vyah", "stream"],
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "name", "text", "vyah", "stream", "with", "name", "map"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "name", "text", "vyah", "stream", "with", "name", "map"],
  ["be", "write", "for", "name", "mind", "ob", "text", "to", "text", "vyah", "stream", "with", "name", "map"],
  ["be", "write", "for", "name", "mind", "ob", "name", "text", "to", "text", "vyah", "stream", "with", "name", "map"],
  // Legacy compatibility: to name <mind> totext name <output>
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text"],
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text"],
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "with", "name", "map"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "with", "name", "map"],
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "with", "name", "map"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "with", "name", "map"],
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream"],
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "vyah", "stream"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "vyah", "stream"],
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream", "with", "name", "map"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "name", "text", "vyah", "stream", "with", "name", "map"],
  ["be", "write", "ob", "text", "to", "name", "mind", "totext", "text", "vyah", "stream", "with", "name", "map"],
  ["be", "write", "ob", "name", "text", "to", "name", "mind", "totext", "text", "vyah", "stream", "with", "name", "map"]
];

const agentCwdSignatures = baseMindSignatureWords.map(words => [
  "be",
  "write",
  "at",
  "filename",
  ...words.slice(2)
]);

export const mindSignatureWords = baseMindSignatureWords.concat(agentCwdSignatures);
