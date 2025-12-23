export function buildErrorSentence({ name, message, from, pyash, raw }) {
  const ob = {};
  if (message) ob.text = message;
  if (pyash) ob.pyash = pyash;
  if (raw) ob.raw = raw;
  return {
    mood: "do",
    be: "error",
    su: { name },
    ob,
    from
  };
}

export function throwErrorSentence({ name, message, from, pyash, raw }) {
  const sentence = buildErrorSentence({ name, message, from, pyash, raw });
  const err = new Error(message || name || "error");
  err.sentence = sentence;
  throw err;
}
