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

    if (["subj", "obj", "to", "from"].includes(t)) {
      current = t;
      s[current] = {};
      continue;
    }

    // --- interrogative pronoun sugar ---
    // "obj what que" ⇒ obj: { name: "what" }
    if (t === "what" && current === "obj") {
      s.obj = { name: "what" };
      continue;
    }

    // --- type tokens: name / num / number ---
    if (["name", "num", "number"].includes(t)) {
      const raw = words[i + 1];
      const maybeNum = Number(raw);

      if (t === "name") {
        s[current].name = raw;
      } else {
        // num / number → numeric
        s[current].num = isNaN(maybeNum) ? raw : maybeNum;
      }

      i++; // skip the value we just consumed
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
