// parser.mjs
const QUOTED_PLACEHOLDER = "__QUOTED_BLOCK__";

function tokenize(line) {
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
        tokens.push(current);
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

export function parse(line) {
  let quotedText = null;
  let working = line;

  const blockMatch = working.match(/quoted\.([^.]+)\.(?:contents\s*)?([\s\S]*?)\.\1\.quoted/);
  if (blockMatch) {
    quotedText = blockMatch[2];
    working = working.replace(blockMatch[0], ` ${QUOTED_PLACEHOLDER} `);
  }

  const tokens = tokenize(working.trim());
  if (tokens.length === 0) return null;

  const mood = tokens.at(-1);
  const words = tokens.slice(0, -1);
  const s = { mood };
  let current = null;

  for (let i = 0; i < words.length; i++) {
    const t = words[i];

    // --- topic sugar: "ta loop_head be topic ya" ---
    // sugar for: subj name loop_head be topic ya
    if (t === "ta") {
      const name = words[++i];
      s.subj = { name };
      continue;
    }

    if (t === "then") {
      // (currently unused because 'then' is the mood word,
      //  but we can keep this for future nested clauses)
      const subline = words.slice(i + 1).join(" ");
      s.consequence = parse(subline);
      break;
    }

    if (["subj", "obj", "to", "from", "with"].includes(t)) {
      current = t;
      s[current] = {};
      continue;
    }

    // --- compositional context tokens, e.g., "from state draft" ---
    if (
      current &&
      ["space", "interior", "surface", "under", "time", "state", "person", "social", "discourse"].includes(t)
    ) {
      s[current].context = t;

      const next = words[i + 1];
      if (next && !["subj", "obj", "to", "from", "with", "be", "then", "ta"].includes(next)) {
        s[current].name = next;
        i++; // consume the name token
      }

      continue;
    }

    if (t === QUOTED_PLACEHOLDER && quotedText !== null) {
      if (current) {
        s[current].text = quotedText;
      } else {
        s.text = quotedText;
      }
      continue;
    }

    // --- interrogative pronoun sugar ---
    // "obj what que" ⇒ obj: { name: "what" }
    if (t === "what" && current === "obj") {
      s.obj = { name: "what" };
      continue;
    }

    // --- type tokens: name / num / number / text ---
    if (["name", "num", "number", "text"].includes(t)) {
      const raw = words[i + 1];
      const maybeNum = Number(raw);

      if (t === "name") {
        s[current].name = raw;
      } else if (t === "text") {
        s[current].text = raw;
      } else {
        // num / number → numeric
        s[current].num = isNaN(maybeNum) ? raw : maybeNum;
      }

      i++; // skip the value we just consumed
      continue;
    }

    // --- bare value after a role defaults to name ---
    if (current && s[current] && Object.keys(s[current]).length === 0) {
      s[current].name = t;
      continue;
    }

    if (t === "be") {
      s.be = words[i + 1];
      i++; // skip verb; mood already taken from last token
      continue;
    }
  }

  return s;
}
