export function parse(line) {
  const tokens = line.trim().split(/\s+/);
  const mood = tokens.at(-1);
  const words = tokens.slice(0, -1);
  const s = { mood };
  let current = null;

  for (let i = 0; i < words.length; i++) {
    const t = words[i];

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
      s[current][t] = isNaN(Number(words[i + 1])) ? words[i + 1] : Number(words[i + 1]);
      i++;
      continue;
    }

    if (t === "be") {
      s.be = words[i + 1];
      i++;
    }
  }

  return s;
}
