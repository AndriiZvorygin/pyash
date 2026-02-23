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

function replaceObNameTextWithNum(words) {
  const out = [...words];
  for (let i = 0; i < out.length - 2; i += 1) {
    if (out[i] === "ob" && out[i + 1] === "name" && out[i + 2] === "text") {
      out[i + 2] = "num";
      return out;
    }
  }
  return null;
}

const obNameNumSignatures = baseMindSignatureWords
  .map(replaceObNameTextWithNum)
  .filter(Boolean);

const baseAndNameNumSignatures = baseMindSignatureWords.concat(obNameNumSignatures);

function replaceWithWoTools(words) {
  const out = [...words];
  for (let i = 0; i < out.length - 2; i += 1) {
    if (out[i] === "with" && out[i + 1] === "name" && out[i + 2] === "map") {
      out.splice(i, 3, "with", "wo", "tools");
      return out;
    }
  }
  return null;
}

const withWoToolsSignatures = baseAndNameNumSignatures
  .map(replaceWithWoTools)
  .filter(Boolean);

function removeToNameText(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === "to" && words[i + 1] === "name" && words[i + 2] === "text") {
      i += 2;
      continue;
    }
    out.push(words[i]);
  }
  return out;
}

function removeToText(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === "to" && words[i + 1] === "text") {
      i += 1;
      continue;
    }
    out.push(words[i]);
  }
  return out;
}

const withWoToolsNoToSignatures = withWoToolsSignatures
  .filter(words => !words.includes("totext"))
  .map((words) => {
    const withoutNameText = removeToNameText(words);
    const withoutText = removeToText(withoutNameText);
    return withoutText;
  })
  .filter(words => words.includes("ob") && words.includes("for") && words.includes("with"));

const agentCwdSignatures = baseAndNameNumSignatures.map(words => [
  "be",
  "write",
  "at",
  "filename",
  ...words.slice(2)
]);

const agentCwdWithWoToolsSignatures = agentCwdSignatures
  .map(replaceWithWoTools)
  .filter(Boolean);

const allMindSignatureWords = baseAndNameNumSignatures
  .concat(withWoToolsSignatures)
  .concat(withWoToolsNoToSignatures)
  .concat(agentCwdSignatures)
  .concat(agentCwdWithWoToolsSignatures);

export const mindSignatureWords = [...new Set(allMindSignatureWords.map(words => words.join(" ")))]
  .map(signature => signature.split(" "));
