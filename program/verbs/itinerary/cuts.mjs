import { throwErrorSentence } from "../../error.mjs";

export function isMarkdownDivider(text = "") {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return /^(?:[-*_]\s*){3,}$/u.test(value);
}

export function splitTextParagraphs(text = "") {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  return source
    .split(/\n\s*\n+/u)
    .map((entry) => String(entry ?? "").replace(/[ \t]+\n/g, "\n").replace(/\s+/g, " " ).trim())
    .filter(Boolean)
    .filter((entry) => !isMarkdownDivider(entry))
    .filter((entry) => hasSpeakableContent(entry));
}

export function splitTextSentences(text = "") {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const normalized = source
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    // Drop markdown emphasis/code markers that can break sentence boundary detection.
    .replace(/(\*\*|__|~~|`+)/g, "")
    .trim();
  if (!normalized) return [];
  const protectedRefs = normalized
    .replace(/(\d)\s*\.\s*(\d)/g, "$1§$2")
    .replace(/(\d)\s*:\s*(\d)/g, "$1§$2")
    .replace(/\b((?:[A-Za-z]\.){2,})/g, (m) => m.replaceAll(".", "§"));
  const matches = protectedRefs.match(/[^.!?]+(?:[.!?]+(?:["'”’)\]]+)?(?=\s|$)|$)/g);
  const sentences = (matches ?? [protectedRefs])
    .map((entry) => String(entry ?? "").replace(/§/g, ".").replace(/\s+/g, " ").trim())
    .filter((entry) => /[\p{L}\p{N}]/u.test(entry))
    .filter(Boolean);
  return sentences;
}

export function splitTextPhrases(text = "") {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  return source
    .split(/[,.\n]+/u)
    .map((entry) => String(entry ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((entry) => hasSpeakableContent(entry));
}

export function hasSpeakableContent(text = "") {
  return /[\p{L}\p{N}]/u.test(String(text ?? ""));
}

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

