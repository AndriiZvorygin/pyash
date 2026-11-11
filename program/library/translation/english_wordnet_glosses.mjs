function tokens(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

export function englishWordNetDefinition(gloss) {
  return typeof gloss === "string"
    ? gloss.normalize("NFC").split(";")[0].trim()
    : "";
}

export function isCircularEnglishWordNetGloss(gloss, targetLemmas = []) {
  const definitionTokens = tokens(englishWordNetDefinition(gloss));
  const lemmaPhrases = [...new Map((Array.isArray(targetLemmas) ? targetLemmas : [])
    .map((lemma) => tokens(lemma))
    .filter((phrase) => phrase.length > 0)
    .map((phrase) => [phrase.join(" "), phrase])).values()];
  return lemmaPhrases.some((lemmaTokens) => {
    for (let start = 0; start <= definitionTokens.length - lemmaTokens.length; start += 1) {
      if (lemmaTokens.every((token, index) => definitionTokens[start + index] === token)) return true;
    }
    return false;
  });
}
