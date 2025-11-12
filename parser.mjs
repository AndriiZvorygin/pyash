export function parse(line) {
  const tokens = line.trim().split(/\s+/);
  const mood = tokens.at(-1); // ya / do / que
  const words = tokens.slice(0, -1);

  const sentence = { mood };
  let currentRole = null;

  for (let i = 0; i < words.length; i++) {
    const t = words[i];

    // handle roles like subj, obj, to
    if (["subj", "obj", "to"].includes(t)) {
      currentRole = t;
      sentence[currentRole] = {};
      continue;
    }

    // attributes
    if (["name", "num"].includes(t)) {
      sentence[currentRole][t] = isNaN(Number(words[i + 1]))
        ? words[i + 1]
        : Number(words[i + 1]);
      i++;
      continue;
    }

    // "be" introduces the main predicate / verb
    if (t === "be") {
      sentence.be = words[i + 1];
      i++;
      continue;
    }
  }

  return sentence;
}
