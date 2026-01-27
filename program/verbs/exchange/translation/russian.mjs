function sentenceToRussian(sentence) {
  const su = sentence.su?.name;
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "что-то";

  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : ob.name ?? "lhs";
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : sentence.from?.name ?? "rhs";
    const consequence = sentenceToRussian(sentence.consequence);
    const cmpLabel = beLabel === "tiny"
      ? "меньше"
      : beLabel === "giant"
        ? "больше"
        : "равно";
    return `если ${lhs} ${cmpLabel} ${rhs}, то ${consequence}`.replace(/\.$/, "") + ".";
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
      return `прибавь ${numVal} к ${targetTo}.`;
    }
    if (verb === "subtract" && numVal !== undefined && targetFrom) {
      return `вычти ${numVal} из ${targetFrom}.`;
    }
    if (verb === "multiply" && numVal !== undefined && targetWith) {
      return `умножь ${targetWith} на ${numVal}.`;
    }
    if (verb === "divide" && numVal !== undefined && targetWith) {
      return `раздели ${targetWith} на ${numVal}.`;
    }
    if (verb === "remains" && numVal !== undefined && sentence.from?.num !== undefined && targetTo) {
      return `остаток от ${numVal} по ${sentence.from.num} в ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined && targetTo) {
      return `запиши "${textVal}" в ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined) {
      return `запиши "${textVal}".`;
    }
    if (verb === "write" && sentence.ob?.name) {
      return `запиши ${sentence.ob.name}.`;
    }
    if (verb === "say" && textVal !== undefined) {
      return `скажи "${textVal}".`;
    }
    if (verb === "read" && sentence.from?.filename) {
      return `прочитай файл ${sentence.from.filename}.`;
    }
    if (verb === "read" && targetFrom) {
      return `прочитай ${targetFrom}.`;
    }
    return `сделай ${verb}.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.boolean !== undefined || ob.bool !== undefined) {
    const value = ob.boolean ?? ob.bool;
    return `${su} есть ${value ? "истина" : "ложь"}.`;
  }

  if (ob.num !== undefined) {
    if (beLabel === "number") return `${su} есть число ${ob.num}.`;
    return `${su} есть ${beLabel} ${ob.num}.`;
  }

  if (ob.text !== undefined) {
    if (beLabel === "text") return `${su} есть текст "${ob.text}".`;
    return `${su} есть ${beLabel} "${ob.text}".`;
  }

  if (ob.date !== undefined) {
    if (beLabel === "date") return `${su} есть дата ${ob.date}.`;
    return `${su} есть ${beLabel} ${ob.date}.`;
  }

  if (ob.ve !== undefined) {
  const vecText = renderVectorGloss(ob.ve);
    if (beLabel === "vector") return vecText ? `${su} есть вектор ${vecText}.` : `${su} есть вектор.`;
    return vecText ? `${su} есть ${beLabel} ${vecText}.` : `${su} есть ${beLabel}.`;
  }

  return `${su} есть ${beLabel}`;
}

function russianLineToSentence(line) {
  const trimmed = line.trim();

  const condMatch = trimmed.match(/^если\s+(.+?)\s+(меньше|больше|равно)\s+(.+?),\s*то\s+(.+?)\.?$/i);
  if (condMatch) {
    const [, lhsRaw, cmpRaw, rhsRaw, consequenceRaw] = condMatch;
    const lhsNum = Number(lhsRaw);
    const rhsNum = Number(rhsRaw);
    const ob = {};
    if (!Number.isNaN(lhsNum)) ob.num = lhsNum; else ob.name = lhsRaw.trim();
    const from = {};
    if (!Number.isNaN(rhsNum)) from.num = rhsNum; else from.name = rhsRaw.trim();
    const cmp = cmpRaw.toLowerCase() === "меньше"
      ? "tiny"
      : cmpRaw.toLowerCase() === "больше"
        ? "giant"
        : "equally";
    const consequence = russianLineToSentence(consequenceRaw) ?? null;
    return {
      mood: "do",
      be: cmp,
      ob,
      from,
      consequence
    };
  }

  const addMatch = trimmed.match(/^прибавь\s+([0-9.+-]+)\s+к\s+([A-Za-z0-9_]+)\.?$/i);
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

  const subtractMatch = trimmed.match(/^вычти\s+([0-9.+-]+)\s+из\s+([A-Za-z0-9_]+)\.?$/i);
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

  const multiplyMatch = trimmed.match(/^умножь\s+([A-Za-z0-9_]+)\s+на\s+([0-9.+-]+)\.?$/i);
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

  const divideMatch = trimmed.match(/^раздели\s+([A-Za-z0-9_]+)\s+на\s+([0-9.+-]+)\.?$/i);
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

  const remainsMatch = trimmed.match(/^остаток\s+от\s+([0-9.+-]+)\s+по\s+([0-9.+-]+)\s+в\s+([A-Za-z0-9_]+)\.?$/i);
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

  const writeTextMatch = trimmed.match(/^запиши\s+\"([^\"]*)\"\s+в\s+([A-Za-z0-9_]+)\.?$/i);
  if (writeTextMatch) {
    const [, text, target] = writeTextMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: target }
    };
  }

  const writeTextSoloMatch = trimmed.match(/^запиши\s+\"([^\"]*)\"\.?$/i);
  if (writeTextSoloMatch) {
    const [, text] = writeTextSoloMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text }
    };
  }

  const writeNameMatch = trimmed.match(/^запиши\s+([A-Za-z0-9_]+)\.?$/i);
  if (writeNameMatch) {
    const [, name] = writeNameMatch;
    return {
      mood: "do",
      be: "write",
      ob: { name }
    };
  }

  const sayMatch = trimmed.match(/^скажи\s+\"([^\"]*)\"\.?$/i);
  if (sayMatch) {
    const [, text] = sayMatch;
    return {
      mood: "do",
      be: "say",
      ob: { text }
    };
  }

  const readFileMatch = trimmed.match(/^прочитай\s+файл\s+(.+?)\.?$/i);
  if (readFileMatch) {
    const [, filename] = readFileMatch;
    return {
      mood: "do",
      be: "read",
      from: { filename: filename.trim() }
    };
  }

  const readMatch = trimmed.match(/^прочитай\s+([A-Za-z0-9_]+)\.?$/i);
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name }
    };
  }

  const numberMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+есть\s+число\s+([0-9.+-]+)\.?$/i);
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

  const textMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+есть\s+текст\s+\"([^\"]*)\"\.?$/i);
  if (textMatch) {
    const [, name, text] = textMatch;
    return {
      mood: "ya",
      su: { name },
      be: "text",
      ob: { text }
    };
  }

  const dateMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+есть\s+дата\s+([A-Za-z0-9:+-]+)\.?$/i);
  if (dateMatch) {
    const [, name, date] = dateMatch;
    return {
      mood: "ya",
      su: { name },
      be: "date",
      ob: { date }
    };
  }

  const vectorMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+есть\s+вектор(?:\s+(ve\s+.+))?\.?$/i);
  if (vectorMatch) {
    const [, name, vecRaw] = vectorMatch;
    const vec = parseVectorGloss(vecRaw);
    return {
      mood: "ya",
      su: { name },
      be: "vector",
      ob: { ve: vec ?? {} }
    };
  }

  const boolMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+есть\s+(истина|ложь)\.?$/i);
  if (boolMatch) {
    const [, name, valueRaw] = boolMatch;
    return {
      mood: "ya",
      su: { name },
      ob: { boolean: valueRaw.toLowerCase() === "истина" }
    };
  }

  const genericMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+есть\s+(.+)\.?$/i);
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
  const typeGloss = type === "text" ? "текст" : type === "bool" ? "булево" : "число";
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
  return ["ве", typeGloss, ...rendered].join(" ");
}

function parseVectorGloss(raw) {
  if (!raw || typeof raw !== "string") return null;
  const tokens = raw.match(/"([^"\\]|\\.)*"|\\S+/g);
  if (!tokens || (tokens[0] !== "ve" && tokens[0] !== "ве")) return null;
  const typeToken = tokens[1] || "число";
  const type = typeToken === "текст" ? "text" : typeToken === "булево" ? "bool" : "num";
  const values = tokens.slice(2).map((token) => parseVectorToken(type, token));
  return { type, values };
}

function parseVectorToken(type, token) {
  if (type === "bool") {
    const lower = token.toLowerCase();
    if (lower === "truth" || lower === "true" || lower === "истина") return true;
    if (lower === "lie" || lower === "false" || lower === "ложь") return false;
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

export { sentenceToRussian, russianLineToSentence };
