import { parse as parseRaw } from "./parse_tokens.mjs";
import { MOODS } from "../library/grammar/keywords.mjs";
import { matchGlossToPyash } from "../verbs/exchange/translation/reverse_pairs.mjs";

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
    return parseRaw(fallback);
  }
  if (error) throw error;
  return result;
}
