import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

function sentenceToRussian(sentence) {
  const su = translateNameToRussian(sentence.su?.name);
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "что-то";

  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : translateNameToRussian(ob.name ?? "lhs");
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : translateNameToRussian(sentence.from?.name ?? "rhs");
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
    const targetTo = translateNameToRussian(sentence.to?.name);
    const targetFrom = translateNameToRussian(sentence.from?.name);
    const targetWith = translateNameToRussian(sentence.with?.name);
    const verb = beLabel;
    const translatedVerb = translateTokenToRussian(beLabel);

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
      return `запиши ${translateNameToRussian(sentence.ob.name)}.`;
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
    return `сделай ${translatedVerb}.`;
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

  const writeTextSoloMatch = trimmed.match(/^запиши\s+\"([^\"]*)\"\.?$/i);
  if (writeTextSoloMatch) {
    const [, text] = writeTextSoloMatch;
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

  const readMatch = trimmed.match(new RegExp(`^прочитай\\s+(${namePattern})\\.?$`, "iu"));
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name: translateNameFromRussian(name) }
    };
  }

  const numberMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+число\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (numberMatch) {
    const [, name, numRaw] = numberMatch;
    const n = Number(numRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      be: "number",
      ob: { num: Number.isNaN(n) ? numRaw : n }
    };
  }

  const textMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+текст\\s+\"([^\"]*)\"\\.?$`, "iu"));
  if (textMatch) {
    const [, name, text] = textMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      be: "text",
      ob: { text }
    };
  }

  const dateMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+дата\\s+([A-Za-z0-9:+-]+)\\.?$`, "iu"));
  if (dateMatch) {
    const [, name, date] = dateMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      be: "date",
      ob: { date }
    };
  }

  const vectorMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+вектор(?:\\s+(ve\\s+.+))?\\.?$`, "iu"));
  if (vectorMatch) {
    const [, name, vecRaw] = vectorMatch;
    const vec = parseVectorGloss(vecRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromRussian(name) },
      be: "vector",
      ob: { ve: vec ?? {} }
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

  const genericMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+есть\\s+(.+)\\.?$`, "iu"));
  if (!genericMatch) return null;
  const [, name, bePart] = genericMatch;
  return {
    mood: "ya",
    su: { name: translateNameFromRussian(name) },
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

let isvByEnglish = null;
let englishByIsv = null;

function loadIsvByEnglish() {
  if (isvByEnglish) return isvByEnglish;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_isv.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    isvByEnglish = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.isv) continue;
      isvByEnglish.set(String(entry.en).toLowerCase(), entry.isv);
    }
  } catch {
    isvByEnglish = new Map();
  }
  return isvByEnglish;
}

function translateTokenToRussian(token) {
  if (!token) return token;
  const map = loadIsvByEnglish();
  const lower = token.toLowerCase();
  const translated = map.get(lower);
  if (!translated) return token;
  if (token[0] && token[0] === token[0].toUpperCase()) {
    return translated[0].toUpperCase() + translated.slice(1);
  }
  return translated;
}

function translateNameToRussian(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenToRussian(token))
    .join(" ");
}

function loadEnglishByIsv() {
  if (englishByIsv) return englishByIsv;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_isv.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    englishByIsv = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.isv) continue;
      englishByIsv.set(String(entry.isv), String(entry.en));
    }
  } catch {
    englishByIsv = new Map();
  }
  return englishByIsv;
}

function translateTokenFromRussian(token) {
  if (!token) return token;
  const map = loadEnglishByIsv();
  return map.get(token) ?? token;
}

function translateNameFromRussian(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenFromRussian(token))
    .join(" ");
}

export { sentenceToRussian, russianLineToSentence, translateNameToRussian };
