import { lowerPyashSentence } from "./sentence.mjs";
import { VliwEncodingError } from "./plus.mjs";

const STATE_TYPE = "vector float32";
const MAX_LANES = 16;

function invalid(code, message, details = {}) {
  return new VliwEncodingError(code, message, details);
}

export function isMutableVectorSentence(sentence) {
  return (sentence?.exists === true || sentence?.exists === undefined)
    && sentence?.mood === "ya"
    && sentence?.be === "variable"
    && (sentence?.as?.name === STATE_TYPE
      || (sentence?.as?.text === STATE_TYPE && sentence?.quoteKinds?.as === "state"));
}

export function normalizeMutableVectorSentence(sentence) {
  const keys = Object.keys(sentence ?? {}).sort();
  if (!new Set(["as,be,by,exists,mood,su", "as,be,by,mood,quoteKinds,su"]).has(keys.join(","))) {
    throw invalid("unsupported-sentence", "mutable float32 vectors require exists, su, state, length, be, and mood", { keys });
  }
  if (!sentence.su || Object.keys(sentence.su).join(",") !== "name" || !sentence.su.name.trim()) {
    throw invalid("unsupported-sentence", "mutable float32 vectors require a named variable");
  }
  const isRawState = sentence.as?.name === STATE_TYPE;
  const isNormalizedState = sentence.as?.text === STATE_TYPE && sentence.quoteKinds?.as === "state";
  if (!isRawState && !isNormalizedState) {
    throw invalid("unsupported-sentence", "mutable float32 vectors require the vector float32 state type");
  }
  if (!sentence.by || Object.keys(sentence.by).join(",") !== "num"
    || !Number.isInteger(sentence.by.num) || sentence.by.num < 1 || sentence.by.num > MAX_LANES) {
    throw invalid("unsupported-vector-width", `mutable float32 vectors require a length from 1 to ${MAX_LANES}`, {
      by: sentence.by
    });
  }

  return {
    mood: "ya",
    su: sentence.su,
    as: { text: STATE_TYPE },
    quoteKinds: { as: "state" },
    by: sentence.by,
    be: "variable"
  };
}

export function lowerMutableVectorSentence(sentence) {
  const normalized = normalizeMutableVectorSentence(sentence);
  return lowerPyashSentence(normalized).vectors.map((words) => ({
    sentence,
    words,
    semantic: "mutable-vector"
  }));
}
