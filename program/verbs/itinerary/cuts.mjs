import { throwErrorSentence } from "../../error.mjs";

export function sectionWordTokens(text = "") {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function validateSectionCoverage({ sourceText = "", sections = [], mode = "", sentence = {} } = {}) {
  const sourceTokens = sectionWordTokens(sourceText);
  const mergedTokens = sectionWordTokens((Array.isArray(sections) ? sections : []).join(" "));
  if (!sourceTokens.length || !mergedTokens.length) return;
  if (mergedTokens.length !== sourceTokens.length) {
    throwErrorSentence({
      name: "cut defective",
      message: "cut defective: section coverage mismatch",
      from: { name: "cut" },
      raw: {
        sentence,
        mode,
        sourceWords: sourceTokens.length,
        sectionWords: mergedTokens.length,
        sourceHead: sourceTokens.slice(0, 8).join(" "),
        sectionHead: mergedTokens.slice(0, 8).join(" ")
      }
    });
  }
  for (let i = 0; i < sourceTokens.length; i += 1) {
    if (sourceTokens[i] !== mergedTokens[i]) {
      throwErrorSentence({
        name: "cut defective",
        message: "cut defective: section coverage mismatch",
        from: { name: "cut" },
        raw: {
          sentence,
          mode,
          atindex: i,
          sourceWord: sourceTokens[i],
          sectionWord: mergedTokens[i],
          sourceHead: sourceTokens.slice(0, 8).join(" "),
          sectionHead: mergedTokens.slice(0, 8).join(" ")
        }
      });
    }
  }
}

