// parser.mjs
export function parse(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0) return null;

  const mood = tokens.at(-1);
  const words = tokens.slice(0, -1);
  const s = { mood };
  let current = null;

  for (let i = 0; i < words.length; i++) {
    const t = words[i];

    // --- special sugar: topic label ---
    // "ta loop_head be topic ya"
    if (t === "ta") {
      // treat as "subj name <label>"
      const name = words[++i];
      s.subj = { name };
      continue;
    }

    if (t === "then") {
      // everything after 'then' is the nested clause
      const subline = words.slice(i + 1).join(" ");
      s.consequence = parse(subline);
      break;
    }

    if (["subj", "obj", "to", "from"].includes(t)) {
      current = t;
      s[current] = {};
      continue;
    }

    if (["name", "num"].includes(t)) {
      const raw = words[i + 1];
      const maybeNum = Number(raw);
      s[current][t] = isNaN(maybeNum) ? raw : maybeNum;
      i++;
      continue;
    }

    if (t === "be") {
      s.be = words[i + 1];
      i++; // skip verb
      // mood already taken from last token
    }
  }

  return s;
}
