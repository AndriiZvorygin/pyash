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
  const hasPosition = Object.hasOwn(sentence ?? {}, "fromindex");
  const expectedKeys = hasPosition
    ? "at,be,from,fromindex,mood,to"
    : "at,be,from,mood,to";
  if (!isEmbeddingLookupSentence(sentence) || keys.join(",") !== expectedKeys) {
    throw invalid("embedding row lookup requires from, at, optional fromindex, to, be, and mood", { keys });
  }
  const hasLiteralRow = Number.isInteger(sentence.at?.num)
    && sentence.at.num >= 0 && sentence.at.num <= 0xffff;
  const hasNamedIndex = typeof sentence.at?.name === "string" && sentence.at.name.trim().length > 0;
  const hasValidSequencePosition = Number.isInteger(sentence.fromindex?.num)
    && sentence.fromindex.num >= 0 && sentence.fromindex.num <= 0xffff;
  if (
    typeof sentence.from?.name !== "string" || !sentence.from.name.trim()
    || typeof sentence.to?.name !== "string" || !sentence.to.name.trim()
    || (!hasLiteralRow && !hasNamedIndex)
    || (hasPosition && (!hasNamedIndex || !hasValidSequencePosition))
  ) {
    throw invalid("embedding row lookup requires named table and result plus a uint16 row, named index, or indexed named sequence", {
      from: sentence.from,
      at: sentence.at,
      fromindex: sentence.fromindex,
      to: sentence.to
    });
  }

  return lowerPyashSentence(sentence).vectors.map((words) => ({
    sentence,
    words,
    semantic: "embedding-row-lookup"
  }));
}
