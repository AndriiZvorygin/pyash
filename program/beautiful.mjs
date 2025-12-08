// beautiful.mjs

// Render a NP like { name: "collector" } or { num: 7 }
export function npToPyash(np = {}) {
  if (np.name !== undefined) return `name ${np.name}`;
  if (np.num !== undefined) return `num ${np.num}`;
  if (np.text !== undefined) {
    const quotedBlockMatch = typeof np.text === "string" && np.text.match(/^quoted\.([^.]+)\.[\s\S]*\.\1\.quoted$/);
    if (quotedBlockMatch) {
      return `text ${np.text}`;
    }
    return `text ${JSON.stringify(np.text)}`;
  }
  if (np.filename !== undefined) return `filename ${np.filename}`;
  return ""; // can refine later
}

// Render a full sentence object into surface Pyash
export function sentenceToPyash(s = {}) {
  const parts = [];

  if (s.exists) {
    parts.push("exists");
  }

  if (s.subj) {
    parts.push("subj");
    const np = npToPyash(s.subj);
    if (np) parts.push(np.split(" "));
  }

  if (s.obj) {
    parts.push("obj");
    const np = npToPyash(s.obj);
    if (np) parts.push(np.split(" "));
  }

  if (s.to) {
    parts.push("to");
    const np = npToPyash(s.to);
    if (np) parts.push(np.split(" "));
  }

  if (s.be) {
    parts.push("be", s.be);
  }

  if (s.from) {
    parts.push("from");
    const np = npToPyash(s.from);
    if (np) parts.push(np.split(" "));
  }

  if (s.consequence) {
    parts.push("then");
    const rendered = sentenceToPyash(s.consequence);
    if (rendered) parts.push(rendered);
  }

  if (s.mood && !s.consequence) {
    parts.push(s.mood);
  }

  // flatten, because we sometimes push arrays
  return parts.flat().join(" ");
}
