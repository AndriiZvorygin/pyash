import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { applyEnglishAliases } from "./english_aliases.mjs";

function sentenceToChinese(sentence) {
  const su = translateNameToChinese(sentence.su?.name);
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "事物";
  const translatedVerb = translateTokenToChinese(beLabel);

  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : translateNameToChinese(ob.name ?? "lhs");
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : translateNameToChinese(sentence.from?.name ?? "rhs");
    const consequence = sentenceToChinese(sentence.consequence);
    const cmpLabel = beLabel === "tiny"
      ? "小于"
      : beLabel === "giant"
        ? "大于"
        : "等于";
    return `如果 ${lhs} ${cmpLabel} ${rhs}, 则 ${consequence}`.replace(/\.$/, "") + ".";
  }

  if (!su && mood !== "do") return JSON.stringify(sentence);

  if (mood === "do") {
    const numVal = ob.num !== undefined ? ob.num : undefined;
    const textVal = ob.text !== undefined ? ob.text : undefined;
    const targetTo = translateNameToChinese(sentence.to?.name);
    const targetFrom = translateNameToChinese(sentence.from?.name);
    const targetWith = translateNameToChinese(sentence.with?.name);
    const verb = beLabel;

    if (verb === "plus" && numVal !== undefined && targetTo) {
      return `加 ${numVal} 到 ${targetTo}.`;
    }
    if (verb === "subtract" && numVal !== undefined && targetFrom) {
      return `减 ${numVal} 从 ${targetFrom}.`;
    }
    if (verb === "multiply" && numVal !== undefined && targetWith) {
      return `乘 ${targetWith} 以 ${numVal}.`;
    }
    if (verb === "divide" && numVal !== undefined && targetWith) {
      return `除 ${targetWith} 以 ${numVal}.`;
    }
    if (verb === "remains" && numVal !== undefined && sentence.from?.num !== undefined && targetTo) {
      return `余数 ${numVal} 以 ${sentence.from.num} 到 ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined && targetTo) {
      return `写 "${textVal}" 到 ${targetTo}.`;
    }
    if (verb === "write" && textVal !== undefined) {
      return `写 "${textVal}".`;
    }
    if (verb === "write" && sentence.ob?.name) {
      return `写 ${translateNameToChinese(sentence.ob.name)}.`;
    }
    if (verb === "say" && textVal !== undefined) {
      return `说 "${textVal}".`;
    }
    if (verb === "read" && sentence.from?.filename) {
      return `读 文件 ${sentence.from.filename}.`;
    }
    if (verb === "read" && targetFrom) {
      return `读 ${targetFrom}.`;
    }
    return `做 ${translatedVerb}.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.boolean !== undefined || ob.bool !== undefined) {
    const value = ob.boolean ?? ob.bool;
    return `${su} 是 ${value ? "真相" : "谎言"}.`;
  }

  if (ob.num !== undefined) {
    if (beLabel === "number") return `${su} 是 数 ${ob.num}.`;
    return `${su} 是 ${translatedVerb} ${ob.num}.`;
  }

  if (ob.text !== undefined) {
    if (beLabel === "text") return `${su} 是 文本 "${ob.text}".`;
    return `${su} 是 ${translatedVerb} "${ob.text}".`;
  }

  if (ob.date !== undefined) {
    if (beLabel === "date") return `${su} 是 日期 ${ob.date}.`;
    return `${su} 是 ${translatedVerb} ${ob.date}.`;
  }

  if (ob.ve !== undefined) {
    const vecText = renderVectorGloss(ob.ve);
    if (beLabel === "vector") return vecText ? `${su} 是 ${vecText}.` : `${su} 是 量.`;
    return vecText ? `${su} 是 ${translatedVerb} ${vecText}.` : `${su} 是 ${translatedVerb}.`;
  }

  return `${su} 是 ${translatedVerb}`;
}

function chineseLineToSentence(line) {
  const trimmed = line.trim();
  const namePattern = "[\\p{L}\\p{N}_]+";

  const condMatch = trimmed.match(/^如果\s+(.+?)\s+(小于|大于|等于)\s+(.+?),\s*则\s+(.+?)\.?$/i);
  if (condMatch) {
    const [, lhsRaw, cmpRaw, rhsRaw, consequenceRaw] = condMatch;
    const lhsNum = Number(lhsRaw);
    const rhsNum = Number(rhsRaw);
    const ob = {};
    if (!Number.isNaN(lhsNum)) ob.num = lhsNum; else ob.name = lhsRaw.trim();
    const from = {};
    if (!Number.isNaN(rhsNum)) from.num = rhsNum; else from.name = rhsRaw.trim();
    const cmp = cmpRaw === "小于" ? "tiny" : cmpRaw === "大于" ? "giant" : "equally";
    const consequence = chineseLineToSentence(consequenceRaw) ?? null;
    return {
      mood: "do",
      be: cmp,
      ob,
      from,
      consequence
    };
  }

  const addMatch = trimmed.match(new RegExp(`^加\\s+([0-9.+-]+)\\s+到\\s+(${namePattern})\\.?$`, "iu"));
  if (addMatch) {
    const [, numRaw, target] = addMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "plus",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      to: { name: translateNameFromChinese(target) }
    };
  }

  const subtractMatch = trimmed.match(new RegExp(`^减\\s+([0-9.+-]+)\\s+从\\s+(${namePattern})\\.?$`, "iu"));
  if (subtractMatch) {
    const [, numRaw, target] = subtractMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "subtract",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      from: { name: translateNameFromChinese(target) }
    };
  }

  const multiplyMatch = trimmed.match(new RegExp(`^乘\\s+(${namePattern})\\s+以\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (multiplyMatch) {
    const [, target, numRaw] = multiplyMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "multiply",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromChinese(target) }
    };
  }

  const divideMatch = trimmed.match(new RegExp(`^除\\s+(${namePattern})\\s+以\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (divideMatch) {
    const [, target, numRaw] = divideMatch;
    const n = Number(numRaw);
    return {
      mood: "do",
      be: "divide",
      ob: { num: Number.isNaN(n) ? numRaw : n },
      with: { name: translateNameFromChinese(target) }
    };
  }

  const remainsMatch = trimmed.match(new RegExp(`^余数\\s+([0-9.+-]+)\\s+以\\s+([0-9.+-]+)\\s+到\\s+(${namePattern})\\.?$`, "iu"));
  if (remainsMatch) {
    const [, numRaw, fromRaw, target] = remainsMatch;
    const numVal = Number(numRaw);
    const fromVal = Number(fromRaw);
    return {
      mood: "do",
      be: "remains",
      ob: { num: Number.isNaN(numVal) ? numRaw : numVal },
      from: { num: Number.isNaN(fromVal) ? fromRaw : fromVal },
      to: { name: translateNameFromChinese(target) }
    };
  }

  const writeTextMatch = trimmed.match(new RegExp(`^写\\s+\"([^\"]*)\"\\s+到\\s+(${namePattern})\\.?$`, "iu"));
  if (writeTextMatch) {
    const [, text, target] = writeTextMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text },
      to: { name: translateNameFromChinese(target) }
    };
  }

  const writeTextSoloMatch = trimmed.match(/^写\s+\"([^\"]*)\"\.?$/i);
  if (writeTextSoloMatch) {
    const [, text] = writeTextSoloMatch;
    return {
      mood: "do",
      be: "write",
      ob: { text }
    };
  }

  const writeNameMatch = trimmed.match(new RegExp(`^写\\s+(${namePattern})\\.?$`, "iu"));
  if (writeNameMatch) {
    const [, name] = writeNameMatch;
    return {
      mood: "do",
      be: "write",
      ob: { name: translateNameFromChinese(name) }
    };
  }

  const sayMatch = trimmed.match(/^说\s+\"([^\"]*)\"\.?$/i);
  if (sayMatch) {
    const [, text] = sayMatch;
    return {
      mood: "do",
      be: "say",
      ob: { text }
    };
  }

  const readFileMatch = trimmed.match(/^读\s+文件\s+(.+?)\.?$/i);
  if (readFileMatch) {
    const [, filename] = readFileMatch;
    return {
      mood: "do",
      be: "read",
      from: { filename: filename.trim() }
    };
  }

  const readMatch = trimmed.match(new RegExp(`^读\\s+(${namePattern})\\.?$`, "iu"));
  if (readMatch) {
    const [, name] = readMatch;
    return {
      mood: "do",
      be: "read",
      from: { name: translateNameFromChinese(name) }
    };
  }

  const numberMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+是\\s+数\\s+([0-9.+-]+)\\.?$`, "iu"));
  if (numberMatch) {
    const [, name, numRaw] = numberMatch;
    const n = Number(numRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromChinese(name) },
      be: "number",
      ob: { num: Number.isNaN(n) ? numRaw : n }
    };
  }

  const textMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+是\\s+文本\\s+\"([^\"]*)\"\\.?$`, "iu"));
  if (textMatch) {
    const [, name, text] = textMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromChinese(name) },
      be: "text",
      ob: { text }
    };
  }

  const dateMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+是\\s+日期\\s+([A-Za-z0-9:+-]+)\\.?$`, "iu"));
  if (dateMatch) {
    const [, name, date] = dateMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromChinese(name) },
      be: "date",
      ob: { date }
    };
  }

  const vectorMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+是\\s+(?:向量|量)(?:\\s+(.+))?\\.?$`, "iu"));
  if (vectorMatch) {
    const [, name, vecRaw] = vectorMatch;
    const vec = parseVectorGloss(vecRaw);
    return {
      mood: "ya",
      su: { name: translateNameFromChinese(name) },
      be: "vector",
      ob: { ve: vec ?? {} }
    };
  }

  const boolMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+是\\s+(真相|谎言)\\.?$`, "iu"));
  if (boolMatch) {
    const [, name, valueRaw] = boolMatch;
    return {
      mood: "ya",
      su: { name: translateNameFromChinese(name) },
      ob: { boolean: valueRaw === "真相" }
    };
  }

  const genericMatch = trimmed.match(new RegExp(`^(${namePattern})\\s+是\\s+([\\p{L}\\p{N}_ ]+)\\.?$`, "iu"));
  if (!genericMatch) return null;
  const [, name, bePart] = genericMatch;
  return {
    mood: "ya",
    su: { name: translateNameFromChinese(name) },
    be: bePart.trim()
  };
}

function renderVectorGloss(vec) {
  if (!vec || typeof vec !== "object") return null;
  const type = vec.type || "num";
  const typeGloss = type === "text" ? "文本" : type === "bool" ? "布尔" : "数";
  const values = Array.isArray(vec.values) ? vec.values : [];
  const rendered = values.map((value) => {
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "真相" : "谎言";
    if (typeof value === "string") {
      if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
      return JSON.stringify(value);
    }
    return String(value);
  });
  return ["量", typeGloss, ...rendered].join(" ");
}

function parseVectorGloss(raw) {
  if (!raw || typeof raw !== "string") return null;
  const tokens = raw.match(/"([^"\\]|\\.)*"|\\S+/g);
  if (!tokens) return null;
  if (tokens[0] === "向量" || tokens[0] === "量" || tokens[0] === "ve") {
    tokens.shift();
  }
  const typeToken = tokens[0] || "数";
  const type = typeToken === "文本" ? "text" : typeToken === "布尔" ? "bool" : "num";
  const values = tokens.slice(1).map((token) => parseVectorToken(type, token));
  return { type, values };
}

function parseVectorToken(type, token) {
  if (type === "bool") {
    if (token === "真相") return true;
    if (token === "谎言") return false;
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

let zhByEnglish = null;
let englishByZh = null;

function loadZhByEnglish() {
  if (zhByEnglish) return zhByEnglish;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_zh.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    zhByEnglish = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.zh) continue;
      zhByEnglish.set(String(entry.en).toLowerCase(), entry.zh);
    }
    applyEnglishAliases(zhByEnglish);
  } catch {
    zhByEnglish = new Map();
  }
  return zhByEnglish;
}

function translateTokenToChinese(token) {
  if (!token) return token;
  const map = loadZhByEnglish();
  const lower = token.toLowerCase();
  return map.get(lower) ?? token;
}

function translateNameToChinese(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenToChinese(token))
    .join(" ");
}

function loadEnglishByZh() {
  if (englishByZh) return englishByZh;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../..");
    const path = resolve(repoRoot, "caterer/pyac/lyac/kwon_zh.json");
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    englishByZh = new Map();
    for (const entry of data) {
      if (!entry?.en || !entry?.zh) continue;
      englishByZh.set(String(entry.zh), String(entry.en));
    }
  } catch {
    englishByZh = new Map();
  }
  return englishByZh;
}

function translateTokenFromChinese(token) {
  if (!token) return token;
  const map = loadEnglishByZh();
  return map.get(token) ?? token;
}

function translateNameFromChinese(name) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => translateTokenFromChinese(token))
    .join(" ");
}

export {
  sentenceToChinese,
  chineseLineToSentence,
  translateNameToChinese
};
