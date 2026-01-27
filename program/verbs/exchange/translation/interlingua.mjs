import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

function sentenceToInterlingua(sentence) {
  const su = translateNameToInterlingua(sentence.su?.name);
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "cosa";
  const translatedVerb = translateTokenToInterlingua(beLabel);

  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : translateNameToInterlingua(ob.name ?? "lhs");
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : translateNameToInterlingua(sentence.from?.name ?? "rhs");
    const consequence = sentenceToInterlingua(sentence.consequence);
    const cmpLabel = beLabel === "tiny"
      ? "minus que"
      : beLabel === "giant"
        ? "plus que"
        : "equal a";
    return `si ${lhs} es ${cmpLabel} ${rhs}, alora ${consequence}`.replace(/\.$/, "") + ".";
  }

  if (!su && mood !== "do") return JSON.stringify(sentence);

  if (mood === "do") {
    const numVal = ob.num !== undefined ? ob.num : undefined;
    const textVal = ob.text !== undefined ? ob.text : undefined;
    const targetTo = translateNameToInterlingua(sentence.to?.name);
    const targetFrom = translateNameToInterlingua(sentence.from?.name);
    const targetWith = translateNameToInterlingua(sentence.with?.name);
    const verb = beLabel;

    if (verb === "plus" && numVal !== undefined && targetTo) {
      return `adde ${numVal} a ${targetTo}.`;
    }
    if (verb === "subtract" && numVal !== undefined && targetFrom) {
      return `subtrahe ${numVal} de ${targetFrom}.`;
    }
    if (verb === "multiply" && numVal !== undefined && targetWith) {
      return `multiplica ${targetWith} per ${numVal}.`;
    }
    if (verb === "divide" && numVal !== undefined && targetWith) {
      return `divide ${targetWith} per ${numVal}.`;
    }
    if (verb === "remains" && numVal !== undefined && sentence.from?.num !== undefined && targetTo) {
      return `resto de ${numVal} per ${sentence.from.num} a ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined && targetTo) {
      return `scribe \"${textVal}\" a ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined) {
      return `scribe \"${textVal}\".`;
    }
    if (verb === "write" && sentence.ob?.name) {
      return `scribe ${translateNameToInterlingua(sentence.ob.name)}.`;
    }
    if (verb === "say" && textVal !== undefined) {
      return `dice \"${textVal}\".`;
    }
    if (verb === "read" && sentence.from?.filename) {
      return `lege file ${sentence.from.filename}.`;
    }
    if (verb === "read" && targetFrom) {
      return `lege ${targetFrom}.`;
    }
    return `face ${translatedVerb}.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.boolean !== undefined || ob.bool !== undefined) {
    const value = ob.boolean ?? ob.bool;
    return `${su} es ${value ? "veritate" : "false"}.`;
  }

  if (ob.num !== undefined) {
    if (beLabel === "number") return `${su} es numero ${ob.num}.`;
    return `${su} es ${translatedVerb} ${ob.num}.`;
  }

  if (ob.text !== undefined) {
    if (beLabel === "text") return `${su} es texto \"${ob.text}\".`;
    return `${su} es ${translatedVerb} \"${ob.text}\".`;
  }

  if (ob.date !== undefined) {
    if (beLabel === "date") return `${su} es dactylo ${ob.date}.`;
    return `${su} es ${translatedVerb} ${ob.date}.`;
  }

  if (ob.ve !== undefined) {
    const vecText = renderVectorGloss(ob.ve);
    if (beLabel === "vector") return vecText ? `${su} es ${vecText}.` : `${su} es vector.`;
    return vecText ? `${su} es ${translatedVerb} ${vecText}.` : `${su} es ${translatedVerb}.`;
  }

  return `${su} es ${translatedVerb}`;
}

function interlinguaLineToSentence(line) {
  const trimmed = line.trim();
  const namePattern = "[\\p{L}\\p{N}_]+";

  const condMatch = trimmed.match(/^si\s+(.+?)\s+es\s+(minus que|plus que|equal a)\s+(.+?),\s*alora\s+(.+?)\.?$/i);
  if (condMatch) {
    const [, lhsRaw, cmpRaw, rhsRaw, consequenceRaw] = condMatch;
    const lhsNum = Number(lhsRaw);
    const rhsNum = Number(rhsRaw);
    const ob = {};
    if (!Number.isNaN(lhsNum)) ob.num = lhsNum; else ob.name = lhsRaw.trim();
    const from = {};
    if (!Number.isNaN(rhsNum)) from.num = rhsNum; else from.name = rhsRaw.trim();
    const cmp = cmpRaw.toLowerCase() === "minus que"
      ? "tiny"
      : cmpRaw.toLowerCase() === "plus que"
        ? "giant"
        : "equally";
    const consequence = interlinguaLineToSentence(consequenceRaw) ?? null;
    return {
      mood: "do",
      be: cmp,
      ob,
      from,
      consequence
    };
  }

  const addMatch = trimmed.match(new RegExp(`^adde\\s+([0-9.+-]+)\\s+a\\s+(${namePattern})\\.?$`, "iu"));
  if (addMatch) {
    const [, numRaw, target] = addMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "plus",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      to: { name: translateNameFromInterlingua(target) }
    };
  }

  const subtractMatch = trimmed.match(new RegExp(`^subtrahe\\s+([0-9.+-]+)\\s+de\\s+(${namePattern})\\.?$`, "iu"));
  if (subtractMatch) {
    const [, numRaw, target] = subtractMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "subtract",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      from: { name: translateNameFromInterlingua(target) }
    };
  }

  const multiplyMatch = trimmed.match(new RegExp(`^multiplica\\s+(${namePattern})\\s+per\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (multiplyMatch) {
    const [, target, numRaw] = multiplyMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "multiply",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromInterlingua(target) }
    };
  }

  const divideMatch = trimmed.match(new RegExp(`^divide\\s+(${namePattern})\\s+per\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (divideMatch) {
    const [, target, numRaw] = divideMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "divide",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromInterlingua(target) }
    };
  }

  const remainsMatch = trimmed.match(new RegExp(`^resto\\s+de\\s+([0-9.+-]+)\\s+per\\s+([0-9.+-]+)\\s+a\\s+(${namePattern})\\.?$`, "iu"));
  if (remainsMatch) {
    const [, numRaw, fromRaw, target] = remainsMatch;
    const numVal = Number(numRaw);
    const fromVal = Number(fromRaw);
    return {
      mood: "do",
      be: "remains",
      ob: { num: Number.isNaN(numVal) ? numRaw : numVal },
      from: { num: Number.isNaN(fromVal) ? fromRaw : fromVal },
      to: { name: translateNameFromInterlingua(target) }
    };
  }

  const writeTextMatch = trimmed.match(new RegExp(`^scribe\\s+\"([^\"]*)\"\\s+a\\s+(${namePattern})\\.?$`, "iu"));
  if (writeTextMatch) {
    const [, text, target] = writeTextMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: translateNameFromInterlingua(target) }
    };
  }

  const writeTextSoloMatch = trimmed.match(/^scribe\s+\"([^\"]*)\"\.?$/i);
  if (writeTextSoloMatch) {
    const [, text] = writeTextSoloMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text }
    };
  }

  const writeNameMatch = trimmed.match(new RegExp(`^scribe\\s+(${namePattern})\\.?$`, "iu"));
  if (writeNameMatch) {
    const [, name] = writeNameMatch;
    return {
      mood: "do",
      be: "write",
      ob: { name: translateNameFromInterlingua(name) }
    };
  }

  const sayMatch = trimmed.match(/^dice\s+\"([^\"]*)\"\.?$/i);
  if (sayMatch) {
    const [, text] = sayMatch;
    return {
      mood: "do",
      be: "say",
      ob: { text }
    };
  }

  const readFileMatch = trimmed.match(/^lege\s+file\s+(.+?)\.?$/i);
  if (readFileMatch) {
    const [, filename] = readFileMatch;
    return {
      mood: "do",
      be: "read",
      from: { filename: filename.trim() }
    };
  }

  const readMatch = trimmed.match(new RegExp(`^lege\\s+(${namePattern})\\.?$`, "iu"));
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name: translateNameFromInterlingua(name) }
    };
  }

  const numberMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+es\\s+numero\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (numberMatch) {
    const [, name, numRaw] = numberMatch;
    const n = Number(numRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromInterlingua(name) },
      be: "number",
      ob: { num: Number.isNaN(n) ? numRaw : n }
    };
  }

  const textMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+es\\s+texto\\s+\"([^\"]*)\"\\.?$`, "iu"));
  if (textMatch) {
    const [, name, text] = textMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromInterlingua(name) },
      be: "text",
      ob: { text }
    };
  }

  const dateMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+es\\s+dactylo\\s+([A-Za-z0-9:+-]+)\\.?$`, "iu"));
  if (dateMatch) {
    const [, name, date] = dateMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromInterlingua(name) },
      be: "date",
      ob: { date }
    };
  }

  const vectorMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+es\\s+vector(?:\\s+(.+))?\\.?$`, "iu"));
  if (vectorMatch) {
    const [, name, vecRaw] = vectorMatch;
    const vec = parseVectorGloss(vecRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromInterlingua(name) },
      be: "vector",
      ob: { ve: vec ?? {} }
    };
  }

  const boolMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+es\\s+(veritate|false)\\.?$`, "iu"));
  if (boolMatch) {
    const [, name, valueRaw] = boolMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromInterlingua(name) },
      ob: { boolean: valueRaw.toLowerCase() === "veritate" }
    };
  }

  const genericMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+es\\s+([\\p{L}\\p{N}_ ]+)\\.?$`, "iu"));
  if (!genericMatch) return null;
  const [, name, bePart] = genericMatch;
  return {
    mood: "ya",
    su: { name: translateNameFromInterlingua(name) },
    be: bePart.trim()
  };
}

function renderVectorGloss(vec) {
  if (!vec || typeof vec !== "object") return null;
  const type = vec.type || "num";
  const typeGloss = type === "text" ? "texto" : type === "bool" ? "booleano" : "numero";
  const values = Array.isArray(vec.values) ? vec.values : [];
  const rendered = values.map((value) => {
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "veritate" : "false";
    if (typeof value === "string") {
      if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
      return JSON.stringify(value);
    }
    return String(value);
  });
  return ["vector", typeGloss, ...rendered].join(" ");
}

function parseVectorGloss(raw) {
  if (!raw || typeof raw !== "string") return null;
  const tokens = raw.match(/"([^"\\]|\\.)*"|\\S+/g);
  if (!tokens) return null;
  if (tokens[0] === "vector" || tokens[0] === "ve") {
    tokens.shift();
  }
  const typeToken = tokens[0] || "numero";
  const type = typeToken === "texto" ? "text" : typeToken === "booleano" ? "bool" : "num";
  const values = tokens.slice(1).map((token) => parseVectorToken(type, token));
  return { type, values };
}

function parseVectorToken(type, token) {
  if (type === "bool") {
    const lower = token.toLowerCase();
    if (lower === "veritate") return true;
    if (lower === "false") return false;
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

let iaByEnglish = null;
let englishByIa = null;

function loadIaByEnglish() {
  if (iaByEnglish) return iaByEnglish;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_ia.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    iaByEnglish = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.ia) continue;
      iaByEnglish.set(String(entry.en).toLowerCase(), entry.ia);
    }
  } catch {
    iaByEnglish = new Map();
  }
  return iaByEnglish;
}

function translateTokenToInterlingua(token) {
  if (!token) return token;
  const map = loadIaByEnglish();
  const lower = token.toLowerCase();
  const translated = map.get(lower);
  if (!translated) return token;
  return translated;
}

function translateNameToInterlingua(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenToInterlingua(token))
    .join(" ");
}

function loadEnglishByIa() {
  if (englishByIa) return englishByIa;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_ia.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    englishByIa = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.ia) continue;
      englishByIa.set(String(entry.ia), String(entry.en));
    }
  } catch {
    englishByIa = new Map();
  }
  return englishByIa;
}

function translateTokenFromInterlingua(token) {
  if (!token) return token;
  const map = loadEnglishByIa();
  return map.get(token) ?? token;
}

function translateNameFromInterlingua(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenFromInterlingua(token))
    .join(" ");
}

export {
  sentenceToInterlingua,
  interlinguaLineToSentence,
  translateNameToInterlingua
};
