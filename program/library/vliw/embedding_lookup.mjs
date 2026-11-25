import { lowerPyashSentence } from "./sentence.mjs";
import { VliwEncodingError } from "./plus.mjs";

const VERB = "tsoc hsat";

function invalid(message, details = {}) {
  return new VliwEncodingError("unsupported-sentence", message, details);
}

export function isEmbeddingLookupSentence(sentence) {
  return sentence?.be === VERB && sentence?.mood === "do";
}

export function lowerEmbeddingLookupSentence(sentence) {
  const keys = Object.keys(sentence).sort();
  if (!isEmbeddingLookupSentence(sentence) || keys.join(",") !== "at,be,from,mood,to") {
    throw invalid("embedding row lookup requires exactly from, at, to, be, and mood", { keys });
  }
  const hasLiteralRow = Number.isInteger(sentence.at?.num)
    && sentence.at.num >= 0 && sentence.at.num <= 0xffff;
  const hasNamedIndex = typeof sentence.at?.name === "string" && sentence.at.name.trim().length > 0;
  if (
    typeof sentence.from?.name !== "string" || !sentence.from.name.trim()
    || typeof sentence.to?.name !== "string" || !sentence.to.name.trim()
    || (!hasLiteralRow && !hasNamedIndex)
  ) {
    throw invalid("embedding row lookup requires named table and result plus a uint16 literal or named scalar index section", {
      from: sentence.from,
      at: sentence.at,
      to: sentence.to
    });
  }

  return lowerPyashSentence(sentence).vectors.map((words) => ({
    sentence,
    words,
    semantic: "embedding-row-lookup"
  }));
}
