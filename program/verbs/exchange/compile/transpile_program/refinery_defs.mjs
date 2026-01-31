export function handleRefineryDefinition({
  sentence,
  sentences,
  index,
  refineryDefs,
  throwErrorSentence
} = {}) {
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
  for (const entry of body) {
    if (entry?.mood !== "ya" || entry?.be !== "platform") {
      throwErrorSentence({
        name: "platform defective",
        message: "platform declaration must be be platform ya",
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
    if (entry.from) {
      if (!entry.from?.ve || entry.from.ve.type !== "name" || !Array.isArray(entry.from.ve.values)) {
        throwErrorSentence({
          name: "depend defective",
          message: "depend list must be from ve name ...",
          from: { name: "compile" },
          raw: entry.from
        });
      }
      deps = entry.from.ve.values.map((value) => String(value));
    }
    const ob = entry?.ob;
    if (!ob || typeof ob !== "object" || !("la" in ob)) {
      throwErrorSentence({
        name: "platform defective",
        message: "platform activity must be ob la ... ko",
        from: { name: "compile" },
        raw: entry
      });
    }
    const extraKeys = Object.keys(ob).filter((key) => key !== "la");
    if (extraKeys.length > 0) {
      throwErrorSentence({
        name: "platform defective",
        message: "platform activity must contain exactly one embedded sentence",
        from: { name: "compile" },
        raw: { extra: extraKeys }
      });
    }
    const clause = ob.la;
    if (!clause || typeof clause !== "object") {
      throwErrorSentence({
        name: "platform defective",
        message: "platform activity must be ob la ... ko",
        from: { name: "compile" },
        raw: clause
      });
    }
    platforms.push({ name: platformName, deps, action: clause });
  }
  refineryDefs.set(name, { name, platforms });
  return { endIndex: j };
}
