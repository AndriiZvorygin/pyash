import { lowerPyashSentence } from "./sentence.mjs";
import { VliwEncodingError } from "./plus.mjs";

const VERB = "pluk tlas";

function invalid(message, details = {}) {
  return new VliwEncodingError("unsupported-sentence", message, details);
}

export function isPlukTlasSentence(sentence) {
  return sentence?.mood === "do" && sentence?.be === VERB;
}

export function lowerPlukTlasSentence(sentence) {
  if (!isPlukTlasSentence(sentence)) {
    throw invalid("pluk tlas requires mood do");
  }
  const keys = Object.keys(sentence).sort();
  if (keys.join(",") !== "be,by,mood,ob,to") {
    throw invalid("pluk tlas requires exactly ob, by, to, be, and mood", { keys });
  }
  for (const role of ["ob", "by"]) {
    const value = sentence[role];
    if (!value || Object.keys(value).join(",") !== "name" || typeof value.name !== "string" || !value.name.trim()) {
      throw invalid(`pluk tlas ${role} must reference a named vector`, { role, value });
    }
  }
  const output = sentence.to;
  if (
    !output
    || Object.keys(output).sort().join(",") !== "name,nameTypeWords"
    || typeof output.name !== "string"
    || !output.name.trim()
    || !Array.isArray(output.nameTypeWords)
    || output.nameTypeWords.length !== 1
    || output.nameTypeWords[0] !== "num"
  ) {
    throw invalid("pluk tlas to must name a num output", { to: output });
  }

  const lowered = lowerPyashSentence(sentence);
  return lowered.vectors.map((words) => ({
    sentence,
    words,
    semantic: "pluk-tlas"
  }));
}
