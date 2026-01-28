import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { applyEnglishAliases } from "./english_aliases.mjs";

function sentenceToHindi(sentence) {
  const su = translateNameToHindi(sentence.su?.name);
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "वस्तु";
  const translatedVerb = translateTokenToHindi(beLabel);

  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : translateNameToHindi(ob.name ?? "lhs");
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : translateNameToHindi(sentence.from?.name ?? "rhs");
    const consequence = sentenceToHindi(sentence.consequence);
    const cmpLabel = beLabel === "tiny"
      ? "कम"
      : beLabel === "giant"
        ? "अधिक"
        : "बराबर";
    return `यदि ${lhs} ${cmpLabel} ${rhs} है, तो ${consequence}`.replace(/\.$/, "") + ".";
  }

  if (!su && mood !== "do") return JSON.stringify(sentence);

  if (mood === "do") {
    const numVal = ob.num !== undefined ? ob.num : undefined;
    const textVal = ob.text !== undefined ? ob.text : undefined;
    const targetTo = translateNameToHindi(sentence.to?.name);
    const targetFrom = translateNameToHindi(sentence.from?.name);
    const targetWith = translateNameToHindi(sentence.with?.name);
    const verb = beLabel;

    if (verb === "plus" && numVal !== undefined && targetTo) {
      return `${targetTo} में ${numVal} जोड़ो.`;
    }
    if (verb === "subtract" && numVal !== undefined && targetFrom) {
      return `${targetFrom} से ${numVal} घटाओ.`;
    }
    if (verb === "multiply" && numVal !== undefined && targetWith) {
      return `${targetWith} को ${numVal} से गुणा करो.`;
    }
    if (verb === "divide" && numVal !== undefined && targetWith) {
      return `${targetWith} को ${numVal} से भाग दो.`;
    }
    if (verb === "remains" && numVal !== undefined && sentence.from?.num !== undefined && targetTo) {
      return `${numVal} को ${sentence.from.num} से भाग देने पर शेष ${targetTo} को दो.`;
    }
    if (verb === "write" && textVal !== undefined && targetTo) {
      return `${targetTo} में \"${textVal}\" लिखो.`;
    }
    if (verb === "write" && textVal !== undefined) {
      return `\"${textVal}\" लिखो.`;
    }
    if (verb === "write" && sentence.ob?.name) {
      return `${translateNameToHindi(sentence.ob.name)} लिखो.`;
    }
    if (verb === "say" && textVal !== undefined) {
      return `\"${textVal}\" कहो.`;
    }
    if (verb === "read" && sentence.from?.filename) {
      return `फाइल ${sentence.from.filename} पढ़ो.`;
    }
    if (verb === "read" && targetFrom) {
      return `${targetFrom} पढ़ो.`;
    }
    return `${translatedVerb} करो.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.boolean !== undefined || ob.bool !== undefined) {
    const value = ob.boolean ?? ob.bool;
    return `${su} ${value ? "सच" : "झूठ"} है.`;
  }

  if (ob.num !== undefined) {
    if (beLabel === "number") return `${su} संख्या ${ob.num} है.`;
    return `${su} ${translatedVerb} ${ob.num} है.`;
  }

  if (ob.text !== undefined) {
    if (beLabel === "text") return `${su} टेक्स्ट \"${ob.text}\" है.`;
    return `${su} ${translatedVerb} \"${ob.text}\" है.`;
  }

  if (ob.date !== undefined) {
    if (beLabel === "date") return `${su} तारीख ${ob.date} है.`;
    return `${su} ${translatedVerb} ${ob.date} है.`;
  }

  if (ob.ve !== undefined) {
    const vecText = renderVectorGloss(ob.ve);
    if (beLabel === "vector") return vecText ? `${su} ${vecText} है.` : `${su} वेक्टर है.`;
    return vecText ? `${su} ${translatedVerb} ${vecText} है.` : `${su} ${translatedVerb} है.`;
  }

  return `${su} ${translatedVerb} है`;
}

function hindiLineToSentence(line) {
  const trimmed = line.trim();
  const namePattern = ".+?";

  const condMatch = trimmed.match(/^यदि\s+(.+?)\s+(कम|अधिक|बराबर)\s+(.+?)\s+है,\s*तो\s+(.+?)\.?$/i);
  if (condMatch) {
    const [, lhsRaw, cmpRaw, rhsRaw, consequenceRaw] = condMatch;
    const lhsNum = Number(lhsRaw);
    const rhsNum = Number(rhsRaw);
    const ob = {};
    if (!Number.isNaN(lhsNum)) ob.num = lhsNum; else ob.name = lhsRaw.trim();
    const from = {};
    if (!Number.isNaN(rhsNum)) from.num = rhsNum; else from.name = rhsRaw.trim();
    const cmp = cmpRaw === "कम"
      ? "tiny"
      : cmpRaw === "अधिक"
        ? "giant"
        : "equally";
    const consequence = hindiLineToSentence(consequenceRaw) ?? null;
    return {
      mood: "do",
      be: cmp,
      ob,
      from,
      consequence
    };
  }

  const addMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+में\\s+([0-9.+-]+)\\s+जोड़ो\\.?$`, "iu"));
  if (addMatch) {
    const [, target, numRaw] = addMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "plus",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      to: { name: translateNameFromHindi(target) }
    };
  }

  const subtractMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+से\\s+([0-9.+-]+)\\s+घटाओ\\.?$`, "iu"));
  if (subtractMatch) {
    const [, target, numRaw] = subtractMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "subtract",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      from: { name: translateNameFromHindi(target) }
    };
  }

  const multiplyMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+को\\s+([0-9.+-]+)\\s+से\\s+गुणा\\s+करो\\.?$`, "iu"));
  if (multiplyMatch) {
    const [, target, numRaw] = multiplyMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "multiply",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromHindi(target) }
    };
  }

  const divideMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+को\\s+([0-9.+-]+)\\s+से\\s+भाग\\s+दो\\.?$`, "iu"));
  if (divideMatch) {
    const [, target, numRaw] = divideMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "divide",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromHindi(target) }
    };
  }

  const remainsMatch = trimmed.match(new RegExp(`^([0-9.+-]+)\\s+को\\s+([0-9.+-]+)\\s+से\\s+भाग\\s+देने\\s+पर\\s+शेष\\s+(${namePattern})\\s+को\\s+दो\\.?$`, "iu"));
  if (remainsMatch) {
    const [, numRaw, fromRaw, target] = remainsMatch;
    const numVal = Number(numRaw);
    const fromVal = Number(fromRaw);
    return {
      mood: "do",
      be: "remains",
      ob: { num: Number.isNaN(numVal) ? numRaw : numVal },
      from: { num: Number.isNaN(fromVal) ? fromRaw : fromVal },
      to: { name: translateNameFromHindi(target) }
    };
  }

  const writeTextMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+में\\s+\"([^\"]*)\"\\s+लिखो\\.?$`, "iu"));
  if (writeTextMatch) {
    const [, target, text] = writeTextMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: translateNameFromHindi(target) }
    };
  }

  const writeTextSoloMatch = trimmed.match(/^\"([^\"]*)\"\s+लिखो\.?$/i);
  if (writeTextSoloMatch) {
    const [, text] = writeTextSoloMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text }
    };
  }

  const writeNameMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+लिखो\\.?$`, "iu"));
  if (writeNameMatch) {
    const [, name] = writeNameMatch;
    return {
      mood: "do",
      be: "write",
      ob: { name: translateNameFromHindi(name) }
    };
  }

  const sayMatch = trimmed.match(/^\"([^\"]*)\"\s+कहो\.?$/i);
  if (sayMatch) {
    const [, text] = sayMatch;
    return {
      mood: "do",
      be: "say",
      ob: { text }
    };
  }

  const readFileMatch = trimmed.match(/^फाइल\s+(.+?)\s+पढ़ो\.?$/i);
  if (readFileMatch) {
    const [, filename] = readFileMatch;
    return {
      mood: "do",
      be: "read",
      from: { filename: filename.trim() }
    };
  }

  const readMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+पढ़ो\\.?$`, "iu"));
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name: translateNameFromHindi(name) }
    };
  }

  const numberMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+संख्या\\s+([0-9.+-]+)\\s+है\\.?$`, "iu"));
  if (numberMatch) {
    const [, name, numRaw] = numberMatch;
    const n = Number(numRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromHindi(name) },
      be: "number",
      ob: { num: Number.isNaN(n) ? numRaw : n }
    };
  }

  const textMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+टेक्स्ट\\s+\"([^\"]*)\"\\s+है\\.?$`, "iu"));
  if (textMatch) {
    const [, name, text] = textMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromHindi(name) },
      be: "text",
      ob: { text }
    };
  }

  const dateMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+तारीख\\s+([A-Za-z0-9:+-]+)\\s+है\\.?$`, "iu"));
  if (dateMatch) {
    const [, name, date] = dateMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromHindi(name) },
      be: "date",
      ob: { date }
    };
  }

  const vectorMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+वेक्टर(?:\\s+(.+))?\\s+है\\.?$`, "iu"));
  if (vectorMatch) {
    const [, name, vecRaw] = vectorMatch;
    const vec = parseVectorGloss(vecRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromHindi(name) },
      be: "vector",
      ob: { ve: vec ?? {} }
    };
  }

  const boolMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+(सच|झूठ)\\s+है\\.?$`, "iu"));
  if (boolMatch) {
    const [, name, valueRaw] = boolMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromHindi(name) },
      ob: { boolean: valueRaw === "सच" }
    };
  }

  const genericMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+(.+)\\s+है\\.?$`, "iu"));
  if (!genericMatch) return null;
  const [, name, bePart] = genericMatch;
  return {
    mood: "ya",
    su: { name: translateNameFromHindi(name) },
    be: bePart.trim()
  };
}

function renderVectorGloss(vec) {
  if (!vec || typeof vec !== "object") return null;
  const type = vec.type || "num";
  const typeGloss = type === "text" ? "टेक्स्ट" : type === "bool" ? "बूलियन" : "संख्या";
  const values = Array.isArray(vec.values) ? vec.values : [];
  const rendered = values.map((value) => {
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "सच" : "झूठ";
    if (typeof value === "string") {
      if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
      return JSON.stringify(value);
    }
    return String(value);
  });
  return ["वेक्टर", typeGloss, ...rendered].join(" ");
}

function parseVectorGloss(raw) {
  if (!raw || typeof raw !== "string") return null;
  const tokens = raw.match(/"([^"\\]|\\.)*"|\\S+/g);
  if (!tokens) return null;
  if (tokens[0] === "वेक्टर" || tokens[0] === "ve") {
    tokens.shift();
  }
  const typeToken = tokens[0] || "संख्या";
  const type = typeToken === "टेक्स्ट" ? "text" : typeToken === "बूलियन" ? "bool" : "num";
  const values = tokens.slice(1).map((token) => parseVectorToken(type, token));
  return { type, values };
}

function parseVectorToken(type, token) {
  if (type === "bool") {
    if (token === "सच") return true;
    if (token === "झूठ") return false;
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

let hiByEnglish = null;
let englishByHi = null;

function loadHiByEnglish() {
  if (hiByEnglish) return hiByEnglish;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_hi.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    hiByEnglish = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.hi) continue;
      hiByEnglish.set(String(entry.en).toLowerCase(), entry.hi);
    }
    applyEnglishAliases(hiByEnglish);
  } catch {
    hiByEnglish = new Map();
  }
  return hiByEnglish;
}

function translateTokenToHindi(token) {
  if (!token) return token;
  const map = loadHiByEnglish();
  const lower = token.toLowerCase();
  const translated = map.get(lower);
  if (!translated) return token;
  return translated;
}

function translateNameToHindi(name) {
  if (!name) return name;
  const raw = String(name).trim();
  const map = loadHiByEnglish();
  const whole = map.get(raw.toLowerCase());
  if (whole) return whole;
  return raw
    .split(/\s+/)
    .map((token) => translateTokenToHindi(token))
    .join(" ");
}

function loadEnglishByHi() {
  if (englishByHi) return englishByHi;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_hi.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    englishByHi = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.hi) continue;
      englishByHi.set(String(entry.hi), String(entry.en));
    }
  } catch {
    englishByHi = new Map();
  }
  return englishByHi;
}

function translateTokenFromHindi(token) {
  if (!token) return token;
  const map = loadEnglishByHi();
  return map.get(token) ?? token;
}

function translateNameFromHindi(name) {
  if (!name) return name;
  const raw = String(name).trim();
  const map = loadEnglishByHi();
  const whole = map.get(raw);
  if (whole) return whole;
  return raw
    .split(/\s+/)
    .map((token) => translateTokenFromHindi(token))
    .join(" ");
}

export {
  sentenceToHindi,
  hindiLineToSentence,
  translateNameToHindi
};
