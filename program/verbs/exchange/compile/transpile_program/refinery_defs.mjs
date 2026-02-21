export function handleRefineryDefinition({
  sentence,
  sentences,
  index,
  refineryDefs,
  throwErrorSentence
} = {}) {
  function normalizeDependencyVector(values = []) {
    const deps = [];
    for (let i = 0; i < values.length; i += 1) {
      const token = String(values[i] ?? "");
      if (!token) continue;
      if (token === "name") {
        const next = String(values[i + 1] ?? "");
        if (next) {
          deps.push(next);
          i += 1;
        }
        continue;
      }
      deps.push(token);
    }
    return deps;
  }

  if (!sentence || sentence.mood !== "def" || sentence.be !== "refinery") return null;
  const name = sentence?.su?.name;
  if (!name) {
    throwErrorSentence({
      name: "refinery defective",
      message: "refinery name required",
      from: { name: "compile" },
      raw: sentence
    });
  }
  const body = [];
  let j = index + 1;
  for (; j < sentences.length; j++) {
    if (sentences[j].mood === "prah") break;
    body.push(sentences[j]);
  }
  const platforms = [];
  const seen = new Set();
  let priorName = null;
  for (const entry of body) {
    const isPlatformDecl = entry?.mood === "ya" && entry?.be === "platform";
    if (isPlatformDecl) {
      throwErrorSentence({
        name: "platform defective",
        message: "platform declarations are deprecated; use series entries",
        from: { name: "compile" },
        raw: entry
      });
    }
    if (!isPlatformDecl && (entry?.mood === "def" || entry?.mood === "prah")) {
      throwErrorSentence({
        name: "platform defective",
        message: "refinery entries must be series sentences (su name ...)",
        from: { name: "compile" },
        raw: entry
      });
    }
    const platformName = entry?.su?.name;
    if (!platformName) {
      throwErrorSentence({
        name: "platform defective",
        message: "platform name required",
        from: { name: "compile" },
        raw: entry
      });
    }
    if (seen.has(platformName)) {
      throwErrorSentence({
        name: "platform defective",
        message: `platform name duplicated: ${platformName}`,
        from: { name: "compile" },
        raw: entry
      });
    }
    seen.add(platformName);
    let deps = [];
    let action = null;
    if (entry.from?.ve?.type === "name" && Array.isArray(entry.from.ve.values)) {
      deps = normalizeDependencyVector(entry.from.ve.values);
    } else if (typeof entry.from?.name === "string" && entry.from.name) {
      const fromName = String(entry.from.name);
      if (seen.has(fromName)) deps = [fromName];
    } else if (entry.from && (entry.from.filename || entry.from.text || entry.from.name || entry.from.genitive)) {
      // allow non-depend "from" cases (e.g. from filename) to pass through as part of the action
    } else if (entry.from) {
      throwErrorSentence({
        name: "depend defective",
        message: "depend list must be from ve name ...",
        from: { name: "compile" },
        raw: entry.from
      });
    }
    if (priorName && !deps.includes(priorName)) deps = [...deps, priorName];
    action = { ...entry };
    if (action.from?.ve?.type === "name" || (typeof action.from?.name === "string" && action.from.name)) {
      const { ve, ...fromRest } = action.from;
      if (ve?.type === "name") fromRest.ve = undefined;
      const cleaned = Object.fromEntries(Object.entries(fromRest).filter(([, v]) => v !== undefined));
      if (Object.keys(cleaned).length > 0) action.from = cleaned;
      else delete action.from;
    }
    platforms.push({ name: platformName, deps, action });
    priorName = platformName;
  }
  refineryDefs.set(name, { name, platforms });
  return { endIndex: j };
}
