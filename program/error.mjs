export function buildErrorSentence({ name, message, from, pyash, raw }) {
  const obj = {};
  if (message) obj.text = message;
  if (pyash) obj.pyash = pyash;
  if (raw) obj.raw = raw;
  return {
    mood: "do",
    be: "error",
    subj: { name },
    obj,
    from
  };
}

export function throwErrorSentence({ name, message, from, pyash, raw }) {
  const sentence = buildErrorSentence({ name, message, from, pyash, raw });
  const err = new Error(message || name || "error");
  err.sentence = sentence;
  throw err;
}
