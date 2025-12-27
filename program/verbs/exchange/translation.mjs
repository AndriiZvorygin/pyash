import { buildProgram } from "../../program.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { remember, doRemember } from "../../remember/index.mjs";

function sentenceToEnglish(sentence) {
  const su = sentence.su?.name;
  const ob = sentence.ob ?? {};
  const mood = sentence.mood;
  const beWords = (sentence.be || "").split(" ").filter(Boolean);
  const beLabel = beWords.length ? beWords.join(" ") : "something";

  // Conditional
  const isComparator = ["tiny", "giant", "equally"].includes(beLabel);
  if (sentence.consequence && isComparator) {
    const lhs = ob.num !== undefined ? ob.num : ob.name ?? "lhs";
    const rhs = sentence.from?.num !== undefined ? sentence.from.num : sentence.from?.name ?? "rhs";
    const consequence = sentenceToEnglish(sentence.consequence);
    return `if ${lhs} is ${beLabel} from ${rhs} then ${consequence}`.replace(/\.$/, "") + ".";
  }

  if (!su && mood !== "do") return JSON.stringify(sentence);

  if (mood === "do") {
    const numVal = ob.num !== undefined ? ob.num : undefined;
    const textVal = ob.text !== undefined ? ob.text : undefined;
    const verb = beLabel;
    const targetTo = sentence.to?.name;
    const targetFrom = sentence.from?.name;
    if (numVal !== undefined && targetTo) {
      return `do ${verb} ${numVal} to ${targetTo}.`;
    }
    if (numVal !== undefined && targetFrom) {
      return `do ${verb} ${numVal} from ${targetFrom}.`;
    }
    if (textVal !== undefined && targetTo) {
      return `do ${verb} "${textVal}" to ${targetTo}.`;
    }
    return `do ${verb}.`;
  }

  if (mood !== "ya") return JSON.stringify(sentence);

  if (ob.num !== undefined) {
    return `${su} is ${beLabel} ${ob.num}.`;
  }

  if (ob.text !== undefined) {
    return `${su} is ${beLabel} "${ob.text}".`;
  }

  return `${su} is ${beLabel}`;
}

function englishLineToSentence(line) {
  const trimmed = line.trim();

  // Conditional: "if 3 is tiny from 5 then do add 1 to total."
  const condMatch = trimmed.match(/^if\s+(.+?)\s+is\s+(tiny|giant|equally)\s+(?:from\s+)?(.+?)\s+then\s+(.+?)\.?$/i);
  if (condMatch) {
    const [, lhsRaw, cmp, rhsRaw, consequenceRaw] = condMatch;
    const lhsNum = Number(lhsRaw);
    const rhsNum = Number(rhsRaw);
    const ob = {};
    if (!Number.isNaN(lhsNum)) ob.num = lhsNum; else ob.name = lhsRaw.trim();
    const from = {};
    if (!Number.isNaN(rhsNum)) from.num = rhsNum; else from.name = rhsRaw.trim();
    const consequence = englishLineToSentence(consequenceRaw) ?? null;
    return {
      mood: "do",
      be: cmp.toLowerCase(),
      ob,
      from,
      consequence
    };
  }

  // Imperative form: "do subtract 2 from collector"
  const doMatch = trimmed.match(/^do ([A-Za-z0-9_]+) ([0-9.+-]+) (to|from) ([A-Za-z0-9_]+)\.?$/i);
  if (doMatch) {
    const [, verb, numRaw, dir, target] = doMatch;
    const cleanNum = numRaw.replace(/\.$/, "");
    const n = Number(cleanNum);
    const ob = { num: Number.isNaN(n) ? cleanNum : n };
    const sentence = {
      mood: "do",
      be: verb.toLowerCase(),
      ob,
    };
    if (dir.toLowerCase() === "to") {
      sentence.to = { name: target };
    } else {
      sentence.from = { name: target };
    }
    return sentence;
  }

  // Expect format: "<name> is <be> <value>."
  const match = trimmed.match(/^([A-Za-z0-9_]+) is ([A-Za-z0-9_ ]+?)(?: "([^"]*)")?(?: ([0-9.+-]+))?\.?$/);
  if (!match) return null;

  const [, name, bePart, textVal, numVal] = match;
  const be = bePart.trim();
  const sentence = { mood: "ya", su: { name }, be };

  if (textVal !== undefined) {
    sentence.ob = { text: textVal };
  } else if (numVal !== undefined) {
    const clean = numVal.replace(/\.$/, "");
    const n = Number(clean);
    sentence.ob = { num: Number.isNaN(n) ? numVal : n };
  }

  return sentence;
}

function parseNumberToken(token) {
  const n = Number(token);
  return Number.isNaN(n) ? token : n;
}

function javascriptLineToSentence(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;
  const withoutSemi = trimmed.replace(/;$/, "");

  // Declarations with numbers
  let match = withoutSemi.match(/^(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([0-9.+-]+)$/);
  if (match) {
    const [, kind, name, numRaw] = match;
    const num = parseNumberToken(numRaw);
    const be =
      kind === "const" ? "permanent number" :
      "number";
    return {
      mood: "ya",
      su: { name },
      ob: { num },
      be,
      exists: true
    };
  }

  // Declarations with text
  match = withoutSemi.match(/^(let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"']*)["']$/);
  if (match) {
    const [, kind, name, text] = match;
    const be =
      kind === "const" ? "permanent text" :
      "text";
    return {
      mood: "ya",
      su: { name },
      ob: { text },
      be,
      exists: true
    };
  }

  // Simple assignment number
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*=\s*([0-9.+-]+)$/);
  if (match) {
    const [, name, numRaw] = match;
    return {
      mood: "ya",
      su: { name },
      ob: { num: parseNumberToken(numRaw) },
      be: "number"
    };
  }

  // Simple assignment text
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*=\s*["']([^"']*)["']$/);
  if (match) {
    const [, name, text] = match;
    return {
      mood: "ya",
      su: { name },
      ob: { text },
      be: "text"
    };
  }

  // Add/subtract/multiply/divide with explicit left reference
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*=\s*\1\s*([+\-*/])\s*([0-9.+-]+)$/);
  if (match) {
    const [, name, op, numRaw] = match;
    const verb =
      op === "+" ? "add" :
      op === "-" ? "subtract" :
      op === "*" ? "multiply" :
      "divide";
    return {
      mood: "do",
      be: verb,
      ob: { num: parseNumberToken(numRaw) },
      to: { name }
    };
  }

  // Compound assignment (+=, -=, *=, /=)
  match = withoutSemi.match(/^([A-Za-z_$][\w$]*)\s*([+\-*/])=\s*([0-9.+-]+)$/);
  if (match) {
    const [, name, op, numRaw] = match;
    const verb =
      op === "+" ? "add" :
      op === "-" ? "subtract" :
      op === "*" ? "multiply" :
      "divide";
    return {
      mood: "do",
      be: verb,
      ob: { num: parseNumberToken(numRaw) },
      to: { name }
    };
  }

  return null;
}

export async function translation_from_text_to_name_text(sentence) {
  const sourceName = sentence?.ob?.name ?? sentence?.from?.name;
  const sourceText =
    sentence?.from?.text ??
    sentence?.ob?.text ??
    (sourceName ? remember(sourceName)?.ob?.text : null);

  if (typeof sourceText !== "string") {
    throw new Error("translation: source text is required");
  }

  const sourceLang = (sentence?.fromstate?.name || "").toLowerCase();
  const isEnglishSource = sourceLang === "english";
  const isJavaScriptSource = sourceLang === "javascript" || sourceLang === "js";
  let translation = "";
  let sentences = [];

  if (isEnglishSource || isJavaScriptSource) {
    const mapper = isEnglishSource ? englishLineToSentence : javascriptLineToSentence;
    sentences = sourceText
      .replaceAll("\\n", "\n")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(mapper)
      .filter(Boolean);
    translation = sentences
      .map(s => sentenceToPyash(s) ?? JSON.stringify(s))
      .join("\n");
  } else {
    const program = buildProgram(sourceText.replaceAll("\\n", "\n"));
    sentences = program.sentences;
    const lines = program.sentences.map(sentenceToEnglish);
    translation = lines.join("\n");
  }

  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  if (targetName) {
    doRemember({
      su: { name: targetName },
      be: sentence?.become?.name ?? (isEnglishSource || isJavaScriptSource ? "pyash" : "english"),
      ob: { text: translation, sentences },
      mood: "ya"
    });
  }

  return { ob: { text: translation, sentences }, be: sentence?.become?.name ?? (isEnglishSource || isJavaScriptSource ? "pyash" : "english") };
}

export default translation_from_text_to_name_text;

export const signatures = [
  {
    signatureWords: ["be", "translation", "become", "name", "text", "from", "text", "fromstate", "name", "text", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "english", "from", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "english", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "javascript", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "text", "from", "text", "fromstate", "name", "text", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "num", "from", "text", "fromstate", "name", "num", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "text", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "num", "from", "text", "fromstate", "name", "num", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "text", "from", "text", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "from", "text", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  }
];
