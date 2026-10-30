import { translateNameFromRussian } from "./isv.mjs";

export function russianLineToSentence(line) {
  const trimmed = line.trim();
  const namePattern = "[\\p{L}\\p{N}_]+";

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

  const addMatch = trimmed.match(new RegExp(`^прибавь\\s+([0-9.+-]+)\\s+к\\s+(${namePattern})\\.?$`, "iu"));
  if (addMatch) {
    const [, numRaw, target] = addMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "plus",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      to: { name: translateNameFromRussian(target) }
    };
  }

  const subtractMatch = trimmed.match(new RegExp(`^вычти\\s+([0-9.+-]+)\\s+из\\s+(${namePattern})\\.?$`, "iu"));
  if (subtractMatch) {
    const [, numRaw, target] = subtractMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "subtract",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      from: { name: translateNameFromRussian(target) }
    };
  }

  const multiplyMatch = trimmed.match(new RegExp(`^умножь\\s+(${namePattern})\\s+на\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (multiplyMatch) {
    const [, target, numRaw] = multiplyMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "multiply",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromRussian(target) }
    };
  }

  const divideMatch = trimmed.match(new RegExp(`^раздели\\s+(${namePattern})\\s+на\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (divideMatch) {
    const [, target, numRaw] = divideMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "divide",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromRussian(target) }
    };
  }

  const remainsMatch = trimmed.match(new RegExp(`^остаток\\s+от\\s+([0-9.+-]+)\\s+по\\s+([0-9.+-]+)\\s+в\\s+(${namePattern})\\.?$`, "iu"));
  if (remainsMatch) {
    const [, numRaw, fromRaw, target] = remainsMatch;
    const numVal = Number(numRaw);
    const fromVal = Number(fromRaw);
    return {
      mood: "do",
      be: "remains",
      ob: { num: Number.isNaN(numVal) ? numRaw : numVal },
      from: { num: Number.isNaN(fromVal) ? fromRaw : fromVal },
      to: { name: translateNameFromRussian(target) }
    };
  }

  const writeTextMatch = trimmed.match(new RegExp(`^запиши\\s+\"([^\"]*)\"\\s+в\\s+(${namePattern})\\.?$`, "iu"));
  if (writeTextMatch) {
    const [, text, target] = writeTextMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: translateNameFromRussian(target) }
    };
  }

  const writeMatch = trimmed.match(new RegExp(`^запиши\\s+\"([^\"]*)\"\\.?$`, "iu"));
  if (writeMatch) {
    const [, text] = writeMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text }
    };
  }

  const writeNameMatch = trimmed.match(new RegExp(`^запиши\\s+(${namePattern})\\.?$`, "iu"));
  if (writeNameMatch) {
    const [, name] = writeNameMatch;
    return {
      mood: "do",
      be: "write",
      ob: { name: translateNameFromRussian(name) }
    };
  }

  const sayMatch = trimmed.match(new RegExp(`^скажи\\s+\"([^\"]*)\"\\.?$`, "iu"));
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

  const readMatch = trimmed.match(new RegExp(`^прочитай\\s+(${namePattern})\\.?$`, "iu"));
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name: translateNameFromRussian(name) }
    };
  }

  const mapDefMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+определение\\s+карты\\.?$`, "iu"));
  if (mapDefMatch) {
    const [, name] = mapDefMatch;
    return {
      mood: "def",
      exists: true,
      su: { name: translateNameFromRussian(name) },
      be: "map"
    };
  }

  const mapEndMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+конец\\s+карты\\.?$`, "iu"));
  if (mapEndMatch) {
    const [, name] = mapEndMatch;
    return {
      mood: "prah",
      su: { name: translateNameFromRussian(name) },
      be: "map"
    };
  }

  const ceremonyDefMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+определение\\s+церемонии\\.?$`, "iu"));
  if (ceremonyDefMatch) {
    const [, name] = ceremonyDefMatch;
    return {
      mood: "def",
      exists: true,
      su: { name: translateNameFromRussian(name) },
      be: "ceremony"
    };
  }

  const ceremonyEndMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+конец\\s+церемонии\\.?$`, "iu"));
  if (ceremonyEndMatch) {
    const [, name] = ceremonyEndMatch;
    return {
      mood: "prah",
      su: { name: translateNameFromRussian(name) },
      be: "ceremony"
    };
  }

  const boolMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+(истина|ложь)\\.?$`, "iu"));
  if (boolMatch) {
    const [, name, valueRaw] = boolMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      ob: { boolean: valueRaw.toLowerCase() === "истина" }
    };
  }

  const textMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+текст\\s+\"([^\"]*)\"\\.?$`, "iu"));
  if (textMatch) {
    const [, name, text] = textMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      ob: { text },
      be: "text"
    };
  }

  const numMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+число\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (numMatch) {
    const [, name, numRaw] = numMatch;
    const n = Number(numRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      ob: { num: Number.isNaN(n) ? numRaw : n },
      be: "number"
    };
  }

  const dateMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+дата\\s+([^\s]+)\\.?$`, "iu"));
  if (dateMatch) {
    const [, name, date] = dateMatch;
    const cleaned = date.replace(/[.]+$/, "");
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      ob: { date: cleaned },
      be: "date"
    };
  }

  const vectorMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+вектор\\s+(.+?)\\.?$`, "iu"));
  if (vectorMatch) {
    const [, name, vecRaw] = vectorMatch;
    const vec = parseVectorGloss(vecRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      ob: { ve: vec },
      be: "vector"
    };
  }

  const genericMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+(.+)\\.?$`, "iu"));
  if (!genericMatch) return null;
  const [, name, bePart] = genericMatch;
  return {
    mood: "ya",
    su: { name: translateNameFromRussian(name) },
    be: bePart.trim()
  };
}

export function parseVectorGloss(raw) {
  if (!raw || typeof raw !== "string") return null;
  const tokens = raw.match(/"([^"\\]|\\.)*"|\S+/g);
  if (!tokens || tokens.length === 0) return null;
  let idx = 0;
  const head = tokens[0].toLowerCase();
  if (head === "ve" || head === "ве") idx = 1;
  const typeToken = tokens[idx] ? tokens[idx].toLowerCase() : "число";
  const type = typeToken === "текст" ? "text" : typeToken === "булево" ? "bool" : "num";
  const values = tokens.slice(idx + 1).map((token) => parseVectorToken(type, token));
  return { type, values };
}

export function parseVectorToken(type, token) {
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
