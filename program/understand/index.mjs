import { parse as parseRaw } from "./parse_tokens.mjs";
import { MOODS } from "../library/grammar/keywords.mjs";
import { matchGlossToPyash } from "../library/translation/reverse_pairs.mjs";

function attachParseSource(error, sourceText, parseAttempt, originalSourceText) {
  if (!error || typeof error !== "object") return error;
  error.parseDiagnostic = {
    ...(error.parseDiagnostic ?? {}),
    sourceText: String(sourceText),
    parseAttempt,
    ...(originalSourceText !== undefined ? { originalSourceText: String(originalSourceText) } : {})
  };
  return error;
}

export function parse(line) {
  let result = null;
  let error = null;
  try {
    result = parseRaw(line);
  } catch (err) {
    error = err;
  }

  if (result?.mood && MOODS.includes(result.mood)) return result;
  const fallback = matchGlossToPyash(line);
  if (fallback) {
    try {
      return parseRaw(fallback);
    } catch (fallbackError) {
      throw attachParseSource(fallbackError, fallback, "dictionary-fallback", line);
    }
  }
  if (error) throw attachParseSource(error, line, "primary");
  return result;
}
