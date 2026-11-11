import { QUOTED_TEXT_PREFIX } from "./constants.mjs";

const JSON_STRING_ESCAPES = {
  "\"": "\"",
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t"
};

export function tokenize(line) {
  const tokens = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuote) {
      if (ch === "\\" && i + 1 < line.length) {
        const next = line[i + 1];
        if (Object.hasOwn(JSON_STRING_ESCAPES, next)) {
          current += JSON_STRING_ESCAPES[next];
          i += 1;
          continue;
        }
        if (next === "u" && /^[\da-f]{4}$/iu.test(line.slice(i + 2, i + 6))) {
          current += String.fromCharCode(Number.parseInt(line.slice(i + 2, i + 6), 16));
          i += 5;
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
