import { lowerPyashSentence } from "./sentence.mjs";
import { VliwEncodingError } from "./plus.mjs";

const STATE_TYPE = "vector float32";
const MAX_LANES = 16;

function invalid(code, message, details = {}) {
  return new VliwEncodingError(code, message, details);
}

export function isMutableVectorSentence(sentence) {
  return sentence?.exists === true
    && sentence?.mood === "ya"
    && sentence?.be === "variable"
    && sentence?.as?.name === STATE_TYPE;
}

export function lowerMutableVectorSentence(sentence) {
  const keys = Object.keys(sentence ?? {}).sort();
  if (keys.join(",") !== "as,be,by,exists,mood,su") {
    throw invalid("unsupported-sentence", "mutable float32 vectors require exists, su, state, length, be, and mood", { keys });
  }
  if (!sentence.su || Object.keys(sentence.su).join(",") !== "name" || !sentence.su.name.trim()) {
    throw invalid("unsupported-sentence", "mutable float32 vectors require a named variable");
  }
  if (!sentence.by || Object.keys(sentence.by).join(",") !== "num"
    || !Number.isInteger(sentence.by.num) || sentence.by.num < 1 || sentence.by.num > MAX_LANES) {
    throw invalid("unsupported-vector-width", `mutable float32 vectors require a length from 1 to ${MAX_LANES}`, {
      by: sentence.by
    });
  }

  const normalized = {
    mood: "ya",
    su: sentence.su,
    as: { text: STATE_TYPE },
    quoteKinds: { as: "state" },
    by: sentence.by,
    be: "variable"
  };
  return lowerPyashSentence(normalized).vectors.map((words) => ({
    sentence,
    words,
    semantic: "mutable-vector"
  }));
}
