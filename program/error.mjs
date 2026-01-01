import { state } from "./bridge/state.mjs";

export function buildErrorSentence({ name, message, from, pyash, raw, by }) {
  let fromValue = from ? { ...from } : {};
  let byValue = by;
  if (state.currentSourceFilename && fromValue.filename === undefined) {
    fromValue.filename = state.currentSourceFilename;
  }
  let atValue = undefined;
  if (state.currentSourceSentence) {
    atValue = { la: state.currentSourceSentence };
  }
  if (!byValue && typeof state.currentSourceLine === "number") {
    byValue = { num: state.currentSourceLine };
  }
  const ob = {};
  if (message) ob.text = message;
  if (pyash) ob.pyash = pyash;
  if (raw) ob.raw = raw;
  const sentence = {
    mood: "do",
    be: "error",
    su: { name },
    ob,
    from: Object.keys(fromValue).length > 0 ? fromValue : undefined
  };
  if (atValue) sentence.at = atValue;
  if (byValue) sentence.by = byValue;
  return sentence;
}

export function surfaceErrorSentence(errorLike) {
  if (!errorLike) return errorLike;
  const sentence = errorLike.sentence ?? errorLike;
  if (!sentence || typeof sentence !== "object") return sentence;
  if (sentence.be !== "error" || sentence.mood !== "do") return sentence;
  return { ...sentence, mood: "ya" };
}

export function throwErrorSentence({ name, message, from, pyash, raw, by }) {
  const sentence = buildErrorSentence({ name, message, from, pyash, raw, by });
  const err = new Error(message || name || "error");
  err.sentence = sentence;
  throw err;
}
