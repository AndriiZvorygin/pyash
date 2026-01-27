function sentenceToFrench(sentence) {
  const su = sentence.su?.name;
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "quelque chose";

  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : ob.name ?? "lhs";
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : sentence.from?.name ?? "rhs";
    const consequence = sentenceToFrench(sentence.consequence);
    const cmpLabel = beLabel === "tiny"
      ? "plus petit que"
      : beLabel === "giant"
        ? "plus grand que"
        : "egal a";
    return `si ${lhs} est ${cmpLabel} ${rhs}, alors ${consequence}`.replace(/\.$/, "") + ".";
  }

  if (!su && mood !== "do") return JSON.stringify(sentence);

  if (mood === "do") {
    const numVal = ob.num !== undefined ? ob.num : undefined;
    const textVal = ob.text !== undefined ? ob.text : undefined;
    const targetTo = sentence.to?.name;
    const targetFrom = sentence.from?.name;
    const targetWith = sentence.with?.name;
    const verb = beLabel;

    if (verb === "plus" && numVal !== undefined && targetTo) {
      return `ajoute ${numVal} a ${targetTo}.`;
    }
    if (verb === "subtract" && numVal !== undefined && targetFrom) {
      return `soustrais ${numVal} de ${targetFrom}.`;
    }
    if (verb === "multiply" && numVal !== undefined && targetWith) {
      return `multiplie ${targetWith} par ${numVal}.`;
    }
    if (verb === "divide" && numVal !== undefined && targetWith) {
      return `divise ${targetWith} par ${numVal}.`;
    }
    if (verb === "remains" && numVal !== undefined && sentence.from?.num !== undefined && targetTo) {
      return `reste de ${numVal} par ${sentence.from.num} vers ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined && targetTo) {
      return `ecris "${textVal}" dans ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined) {
      return `ecris "${textVal}".`;
    }
    if (verb === "write" && sentence.ob?.name) {
      return `ecris ${sentence.ob.name}.`;
    }
    if (verb === "say" && textVal !== undefined) {
      return `dis "${textVal}".`;
    }
    if (verb === "read" && sentence.from?.filename) {
      return `lis le fichier ${sentence.from.filename}.`;
    }
    if (verb === "read" && targetFrom) {
      return `lis ${targetFrom}.`;
    }
    return `fais ${verb}.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.boolean !== undefined || ob.bool !== undefined) {
    const value = ob.boolean ?? ob.bool;
    return `${su} est ${value ? "vrai" : "faux"}.`;
  }

  if (ob.num !== undefined) {
    if (beLabel === "number") return `${su} est nombre ${ob.num}.`;
    return `${su} est ${beLabel} ${ob.num}.`;
  }

  if (ob.text !== undefined) {
    if (beLabel === "text") return `${su} est texte "${ob.text}".`;
    return `${su} est ${beLabel} "${ob.text}".`;
  }

  if (ob.date !== undefined) {
    if (beLabel === "date") return `${su} est date ${ob.date}.`;
    return `${su} est ${beLabel} ${ob.date}.`;
  }

  if (ob.ve !== undefined) {
  const vecText = renderVectorGloss(ob.ve);
    if (beLabel === "vector") return vecText ? `${su} est vecteur ${vecText}.` : `${su} est vecteur.`;
    return vecText ? `${su} est ${beLabel} ${vecText}.` : `${su} est ${beLabel}.`;
  }

  return `${su} est ${beLabel}`;
}

function frenchLineToSentence(line) {
  const trimmed = line.trim();

  const condMatch = trimmed.match(/^si\s+(.+?)\s+est\s+(plus petit que|plus grand que|egal a)\s+(.+?),\s*alors\s+(.+?)\.?$/i);
  if (condMatch) {
    const [, lhsRaw, cmpRaw, rhsRaw, consequenceRaw] = condMatch;
    const lhsNum = Number(lhsRaw);
    const rhsNum = Number(rhsRaw);
    const ob = {};
    if (!Number.isNaN(lhsNum)) ob.num = lhsNum; else ob.name = lhsRaw.trim();
    const from = {};
    if (!Number.isNaN(rhsNum)) from.num = rhsNum; else from.name = rhsRaw.trim();
    const cmp = cmpRaw.toLowerCase() === "plus petit que"
      ? "tiny"
      : cmpRaw.toLowerCase() === "plus grand que"
        ? "giant"
        : "equally";
    const consequence = frenchLineToSentence(consequenceRaw) ?? null;
    return {
      mood: "do",
      be: cmp,
      ob,
      from,
      consequence
    };
  }

  const addMatch = trimmed.match(/^ajoute\s+([0-9.+-]+)\s+a\s+([A-Za-z0-9_]+)\.?$/i);
  if (addMatch) {
    const [, numRaw, target] = addMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "plus",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      to: { name: target }
    };
  }

  const subtractMatch = trimmed.match(/^soustrais\s+([0-9.+-]+)\s+de\s+([A-Za-z0-9_]+)\.?$/i);
  if (subtractMatch) {
    const [, numRaw, target] = subtractMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "subtract",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      from: { name: target }
    };
  }

  const multiplyMatch = trimmed.match(/^multiplie\s+([A-Za-z0-9_]+)\s+par\s+([0-9.+-]+)\.?$/i);
  if (multiplyMatch) {
    const [, target, numRaw] = multiplyMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "multiply",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: target }
    };
  }

  const divideMatch = trimmed.match(/^divise\s+([A-Za-z0-9_]+)\s+par\s+([0-9.+-]+)\.?$/i);
  if (divideMatch) {
    const [, target, numRaw] = divideMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "divide",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: target }
    };
  }

  const remainsMatch = trimmed.match(/^reste\s+de\s+([0-9.+-]+)\s+par\s+([0-9.+-]+)\s+vers\s+([A-Za-z0-9_]+)\.?$/i);
  if (remainsMatch) {
    const [, numRaw, fromRaw, target] = remainsMatch;
    const numVal = Number(numRaw);
    const fromVal = Number(fromRaw);
    return {
      mood: "do",
      be: "remains",
      ob: { num: Number.isNaN(numVal) ? numRaw : numVal },
      from: { num: Number.isNaN(fromVal) ? fromRaw : fromVal },
      to: { name: target }
    };
  }

  const writeTextMatch = trimmed.match(/^ecris\s+\"([^\"]*)\"\s+dans\s+([A-Za-z0-9_]+)\.?$/i);
  if (writeTextMatch) {
    const [, text, target] = writeTextMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: target }
    };
  }

  const writeTextSoloMatch = trimmed.match(/^ecris\s+\"([^\"]*)\"\.?$/i);
  if (writeTextSoloMatch) {
    const [, text] = writeTextSoloMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text }
    };
  }

  const writeNameMatch = trimmed.match(/^ecris\s+([A-Za-z0-9_]+)\.?$/i);
  if (writeNameMatch) {
    const [, name] = writeNameMatch;
    return {
      mood: "do",
      be: "write",
      ob: { name }
    };
  }

  const sayMatch = trimmed.match(/^dis\s+\"([^\"]*)\"\.?$/i);
  if (sayMatch) {
    const [, text] = sayMatch;
    return {
      mood: "do",
      be: "say",
      ob: { text }
    };
  }

  const readFileMatch = trimmed.match(/^lis\s+le\s+fichier\s+(.+?)\.?$/i);
  if (readFileMatch) {
    const [, filename] = readFileMatch;
    return {
      mood: "do",
      be: "read",
      from: { filename: filename.trim() }
    };
  }

  const readMatch = trimmed.match(/^lis\s+([A-Za-z0-9_]+)\.?$/i);
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name }
    };
  }

  const numberMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+est\s+(?:le\s+)?nombre\s+([0-9.+-]+)\.?$/i);
  if (numberMatch) {
    const [, name, numRaw] = numberMatch;
    const n = Number(numRaw);
    return {
      mood: "ya",
      su: { name },
      be: "number",
      ob: { num: Number.isNaN(n) ? numRaw : n }
    };
  }

  const textMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+est\s+(?:le\s+)?texte\s+\"([^\"]*)\"\.?$/i);
  if (textMatch) {
    const [, name, text] = textMatch;
    return {
      mood: "ya",
      su: { name },
      be: "text",
      ob: { text }
    };
  }

  const dateMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+est\s+(?:la\s+)?date\s+([A-Za-z0-9:+-]+)\.?$/i);
  if (dateMatch) {
    const [, name, date] = dateMatch;
    return {
      mood: "ya",
      su: { name },
      be: "date",
      ob: { date }
    };
  }

  const vectorMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+est\s+(?:un\s+)?vecteur(?:\s+(ve\s+.+))?\.?$/i);
  if (vectorMatch) {
    const [, name] = vectorMatch;
    const vecText = trimmed.replace(/^([A-Za-z0-9_]+)\s+est\s+(?:un\s+)?vecteur\s*/i, "").replace(/\.$/, "");
    let vec = null;
    const tokens = vecText.trim().split(/\s+/).filter(Boolean);
    if (tokens && tokens.length > 0) {
      let idx = 0;
      if (tokens[0].toLowerCase() === "ve") idx = 1;
      const typeToken = tokens[idx] ? tokens[idx].toLowerCase() : "nombre";
      const type = typeToken === "texte" ? "text" : typeToken === "booleen" ? "bool" : "num";
      const values = tokens.slice(idx + 1).map((token) => parseVectorToken(type, token));
      vec = { type, values };
    }
    return {
      mood: "ya",
      su: { name },
      be: "vector",
      ob: { ve: vec ?? {} }
    };
  }

  const boolMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+est\s+(vrai|faux)\.?$/i);
  if (boolMatch) {
    const [, name, valueRaw] = boolMatch;
    return {
      mood: "ya",
      su: { name },
      ob: { boolean: valueRaw.toLowerCase() === "vrai" }
    };
  }

  const genericMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+est\s+([A-Za-z0-9_ ]+)\.?$/i);
  if (!genericMatch) return null;
  const [, name, bePart] = genericMatch;
  return {
    mood: "ya",
    su: { name },
    be: bePart.trim()
  };
}

function renderVectorGloss(vec) {
  if (!vec || typeof vec !== "object") return null;
  const type = vec.type || "num";
  const typeGloss = type === "text" ? "texte" : type === "bool" ? "booleen" : "nombre";
  const values = Array.isArray(vec.values) ? vec.values : [];
  const rendered = values.map((value) => {
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "truth" : "lie";
    if (typeof value === "string") {
      if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
      return JSON.stringify(value);
    }
    return String(value);
  });
  return ["ve", typeGloss, ...rendered].join(" ");
}

function parseVectorGloss(raw) {
  if (!raw || typeof raw !== "string") return null;
  const tokens = raw.match(/"([^"\\]|\\.)*"|\\S+/g);
  if (!tokens || tokens.length === 0) return null;
  let idx = 0;
  const head = tokens[0].toLowerCase();
  if (head === "ve") idx = 1;
  const typeToken = tokens[idx] ? tokens[idx].toLowerCase() : "nombre";
  const type = typeToken === "texte" ? "text" : typeToken === "booleen" ? "bool" : "num";
  const values = tokens.slice(idx + 1).map((token) => parseVectorToken(type, token));
  return { type, values };
}

function parseVectorToken(type, token) {
  if (type === "bool") {
    const lower = token.toLowerCase();
    if (lower === "truth" || lower === "true" || lower === "vrai") return true;
    if (lower === "lie" || lower === "false" || lower === "faux") return false;
    return token;
  }
  if (type === "num") {
    const n = Number(token);
    return Number.isNaN(n) ? token : n;
  }
  if (type === "text") {
    if (token.startsWith("\"")) {
      try {
        return JSON.parse(token);
      } catch {
        return token;
      }
    }
    return token;
  }
  return token;
}

export { sentenceToFrench, frenchLineToSentence };
