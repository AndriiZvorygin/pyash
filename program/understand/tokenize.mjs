import { QUOTED_TEXT_PREFIX } from "./constants.mjs";

export function tokenize(line) {
  const tokens = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuote) {
      if (ch === "\\" && i + 1 < line.length) {
        // allow escapes for quotes/backslashes inside text tokens
        const next = line[i + 1];
        if (next === '"' || next === "\\") {
          current += next;
          i++;
          continue;
        }
      }

      if (ch === '"') {
        tokens.push(`${QUOTED_TEXT_PREFIX}${current}`);
        current = "";
        inQuote = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (current) {
        tokens.push(current);
        current = "";
      }
      inQuote = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}
