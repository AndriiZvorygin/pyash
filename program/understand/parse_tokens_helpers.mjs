export const UNIT_TYPE_ALIASES = {
  months: "month",
  seconds: "second",
  minutes: "minute",
  hours: "hour",
  days: "day",
  weeks: "week",
  lines: "line",
  bytes: "byte"
};

export function parseAllEnumeration(words, startIdx, { ROLE_KEYS, CONTEXT_KEYS }) {
  if (words[startIdx] !== "all") return null;
  let idx = startIdx + 1;
  let role = null;
  if (words[idx] === "su" || words[idx] === "ob") {
    role = words[idx];
    idx += 1;
  }
  if (words[idx] === "of" || words[idx] === "ti") {
    idx += 1;
  } else if (!role) {
    return null;
  }
  const nameTokens = [];
  while (
    idx < words.length &&
    !ROLE_KEYS.includes(words[idx]) &&
    !CONTEXT_KEYS.includes(words[idx]) &&
    !["be", "then", "ta", "ret"].includes(words[idx])
  ) {
    nameTokens.push(words[idx]);
    idx += 1;
  }
  if (nameTokens.length === 0) return null;
  const mapName = nameTokens.join(" ");
  const chain = role ? [mapName, role, "all"] : [mapName, "all"];
  return { chain, endIndex: idx };
}

export function parseClause(words, startIdx, { parseTokens, quotedText }) {
  if (words[startIdx] !== "la") return null;
  let depth = 1;
  const clauseTokens = [];
  for (let j = startIdx + 1; j < words.length; j++) {
    const word = words[j];
    if (word === "la") {
      depth += 1;
    } else if (word === "ko") {
      depth -= 1;
      if (depth === 0) {
        const clause = parseTokens(clauseTokens, { allowMoodless: true, quotedText });
        if (!clause) throw new Error("malformed embedded sentence form");
        return { clause, endIndex: j };
      }
    }
    clauseTokens.push(word);
  }
  throw new Error("subordinate clause missing ko");
}
