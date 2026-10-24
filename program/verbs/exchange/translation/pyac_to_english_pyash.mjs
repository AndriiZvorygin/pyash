import pyashWords from "../../../library/pyashWords.json" with { type: "json" };
import { sentenceToPyash } from "../../../beautiful.mjs";
import { PYASH_SURFACE_FUSED_MOODS } from "./pyash_surface.mjs";
import {
  decodePhraseVliw,
  lowerPhraseVliw,
  phraseParts
} from "../../../library/vliw/phrase.mjs";

export const PYAC_TO_ENGLISH_PYASH_FORMAT = "pyac-to-english-pyash-v1";

const CASE_NAMES = new Map([
  ["na", "nominative"],
  ["ka", "accusative"],
  ["ti", "genitive"],
  ["te", "location"],
  ["ma", "destination"],
  ["so", "source"],
  ["yi", "dative"],
  ["wu", "vocative"],
  ["ta", "topic"],
  ["myah", "temporal"],
  ["twih", "illative"]
]);

const MOOD_WORDS = new Set(PYASH_SURFACE_FUSED_MOODS);
const CASE_WORDS = new Set([
  "na", "ka", "ti", "te", "ma", "so", "yi", "wu", "ta", "myah", "twih"
]);
const COMMON_GLOSSES = new Map([
  ["mi", "me"],
  ["sa", "you"],
  ["nyah", "us"],
  ["ye", "possessive"],
  ["pu", "plural"],
  ["pfin", "walk"],
  ["kwin", "give"],
  ["hpap", "father"],
  ["hdef", "debt"],
  ["hgen", "debtor"],
  ["hson", "forgive"],
  ["tlak", "bring"],
  ["hxuc", "deliver"],
  ["hret", "amen"]
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-pyac-translation";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function cleanToken(value) {
  return text(value).replace(/[.,;:!?]+$/u, "");
}

function isGrammarWord(entry) {
  return text(entry?.en).endsWith("_");
}

function englishWord(entry) {
  return text(entry?.en).replace(/_$/u, "").replaceAll("_", " ");
}

function buildInventory(entries = pyashWords) {
  const roots = new Map();
  const grammar = new Map();
  for (const entry of entries) {
    const pya = text(entry?.pya);
    if (!pya) continue;
    const target = isGrammarWord(entry) ? grammar : roots;
    if (!target.has(pya)) target.set(pya, []);
    target.get(pya).push(entry);
  }
  return { roots, grammar };
}

function grammarPart(pya, entries) {
  const entry = entries?.[0];
  const english = englishWord(entry);
  const caseName = CASE_NAMES.get(pya);
  return {
    pya,
    kind: caseName ? "case" : MOOD_WORDS.has(pya) ? "mood" : "grammar",
    english: caseName ?? english,
    pyash: pya
  };
}

function rootPart(pya, entries, glosses) {
  const override = glosses.get(pya);
  const entry = entries?.[0];
  return {
    pya,
    kind: "root",
    english: override ?? (englishWord(entry) || pya),
    pyash: pya
  };
}

function segmentGrammar(value, grammar, memo = new Map()) {
  if (!value) return [];
  if (memo.has(value)) return memo.get(value);
  const options = [...grammar.keys()]
    .filter((pya) => value.startsWith(pya))
    .sort((left, right) => right.length - left.length);
  for (const pya of options) {
    const remainder = value.slice(pya.length);
    if (!remainder) {
      const result = [pya];
      memo.set(value, result);
      return result;
    }
    const rest = segmentGrammar(remainder, grammar, memo);
    if (rest.length > 0) {
      const result = [pya, ...rest];
      memo.set(value, result);
      return result;
    }
  }
  memo.set(value, []);
  return [];
}

function segmentToken(token, inventory) {
  const value = cleanToken(token);
  if (!value) throw invalid("Pyac input contains an empty token");
  const rootOptions = [...new Set([...inventory.roots.keys(), ...inventory.grammar.keys()])]
    .filter((pya) => value.startsWith(pya))
    .sort((left, right) => right.length - left.length);
  for (const root of rootOptions) {
    const remainder = value.slice(root.length);
    if (!remainder) return [root];
    const suffixes = segmentGrammar(remainder, inventory.grammar);
    if (suffixes.length > 0) return [root, ...suffixes];
  }
  if (inventory.grammar.has(value)) return [value];
  throw invalid("Pyac token cannot be segmented from the vocabulary", { token: value });
}

function decodeToken(token, inventory, glosses) {
  const pyaParts = segmentToken(token, inventory);
  return {
    surface: cleanToken(token),
    parts: pyaParts.map((pya) => inventory.grammar.has(pya)
      ? grammarPart(pya, inventory.grammar.get(pya))
      : rootPart(pya, inventory.roots.get(pya), glosses))
  };
}

function splitSentence(source) {
  if (typeof source !== "string") throw invalid("Pyac source must be text");
  return source
    .normalize("NFC")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function moodPart(parts) {
  const last = parts.at(-1);
  return last?.kind === "mood" ? last : null;
}

function structuralSentence(tokens, decoded) {
  const parts = phraseParts(decoded);
  if (parts.phrases.length === 0 || parts.trailing.length === 0) {
    throw invalid("Pyac sentence requires a subject and verb");
  }
  const subject = parts.phrases[0].tokens.map((part) => part.pya).join(" ");
  const verbParts = parts.trailing;
  const object = parts.phrases.slice(1)
    .flatMap((phrase) => phrase.tokens.map((part) => part.pya))
    .join(" ");
  const sentence = {
    mood: parts.mood ?? "ya",
    su: { name: subject },
    be: verbParts.map((part) => part.pya).join(" ")
  };
  if (object) sentence.ob = { name: object };
  return sentence;
}

function rootEnglish(part) {
  return part.english.replace(/_$/u, "");
}

function inflectVerb(parts) {
  const root = parts.find((part) => part.kind === "root");
  if (!root) return "something";
  const base = rootEnglish(root);
  const markers = new Set(parts.filter((part) => part.kind === "grammar").map((part) => part.pya));
  if (markers.has("ki")) {
    return new Map([
      ["walk", "walked"],
      ["give", "gave"],
      ["bring", "brought"],
      ["come", "came"],
      ["forgive", "forgave"]
    ]).get(base) ?? `${base}ed`;
  }
  if (markers.has("pfih")) return `${base}ing`;
  return base;
}

function renderPhrase(parts, { subject = false } = {}) {
  const words = [];
  let possessive = false;
  for (const part of parts) {
    if (part.kind === "root" || ["mi", "sa", "nyah"].includes(part.pya)) {
      let word = rootEnglish(part);
      if (part.kind !== "root") word = COMMON_GLOSSES.get(part.pya) ?? part.english;
      if (part.pya === "mi" && subject) word = "I";
      if (part.pya === "nyah" && subject) word = "we";
      if (part.pya === "nyah" && !subject) word = "us";
      words.push(word);
      if (possessive && words.length > 1) {
        const owner = words.at(-2);
        const ownerWord = owner === "us" ? "our" : owner === "you" ? "your" : owner === "I" ? "my" : `${owner}'s`;
        words.splice(-2, 2, ownerWord, word);
        possessive = false;
      }
      continue;
    }
    if (part.pya === "ye") {
      possessive = true;
      continue;
    }
    if (part.pya === "pu" && words.length > 0) {
      words[words.length - 1] = words.at(-1).endsWith("s") ? words.at(-1) : `${words.at(-1)}s`;
      continue;
    }
    if (part.kind === "case") {
      if (part.pya === "twih") words.unshift("into");
      if (part.pya === "so") words.unshift("from");
      if (part.pya === "ma") words.unshift("to");
      if (part.pya === "te") words.unshift("in");
      continue;
    }
  }
  if (possessive && words.length > 0) words[words.length - 1] = `${words.at(-1)}'s`;
  return words.join(" ");
}

function decodedPart(token, glosses) {
  return {
    pya: token.pya,
    kind: CASE_WORDS.has(token.pya)
      ? "case"
      : token.en.endsWith("_") ? "grammar" : "root",
    english: glosses.get(token.pya) ?? token.en.replace(/_$/u, "")
  };
}

function renderEnglishPyash(sentence, tokens, decoded, glosses) {
  const parts = phraseParts(decoded);
  const mood = sentence.mood === "ya" ? "ya" : sentence.mood;
  const subject = renderPhrase(parts.phrases[0].tokens.map((token) => decodedPart(token, glosses)), { subject: true });
  const object = parts.phrases.slice(1)
    .flatMap((phrase) => phrase.tokens)
    .map((token) => decodedPart(token, glosses))
    .filter((part) => part.pya !== "ka")
    .map((part) => part.pya === "na" ? null : part)
    .filter(Boolean);
  const objectText = renderPhrase(object);
  const verb = inflectVerb(parts.trailing.map((token) => decodedPart(token, glosses))
    .filter((part) => part.kind !== "mood"));
  const rendered = ["su", subject];
  if (objectText) rendered.push("ob", "name", JSON.stringify(objectText));
  rendered.push("be", verb, mood);
  return rendered.join(" ");
}

function renderEnglish(sentence, tokens, decoded, glosses) {
  const decodedParts = phraseParts(decoded);
  const subject = renderPhrase(decodedParts.phrases[0].tokens.map((token) => decodedPart(token, glosses)), { subject: true });
  const object = decodedParts.phrases.slice(1)
    .flatMap((phrase) => phrase.tokens)
    .map((token) => decodedPart(token, glosses))
    .filter((part) => !["ka", "na"].includes(part.pya));
  const objectText = renderPhrase(object);
  const verb = inflectVerb(decodedParts.trailing.map((token) => decodedPart(token, glosses))
    .filter((part) => part.kind !== "mood"));
  return `${subject} ${verb}${objectText ? ` ${objectText}` : ""}.`;
}

export function buildPyacDecoder({ entries = pyashWords, glosses = {} } = {}) {
  const inventory = buildInventory(entries);
  const mergedGlosses = new Map([
    ...COMMON_GLOSSES,
    ...Object.entries(glosses).map(([key, value]) => [key, text(value)])
  ]);
  return {
    decode(source) {
      const tokens = cleanToken(source).split(/\s+/u).filter(Boolean)
        .map((token) => decodeToken(token, inventory, mergedGlosses));
      const lowered = lowerPhraseVliw({ tokens: tokens.flatMap((token) => token.parts.map((part) => part.pyash)) });
      const decoded = decodePhraseVliw(lowered.vectors);
      const sentence = structuralSentence(tokens, decoded);
      return {
        format: PYAC_TO_ENGLISH_PYASH_FORMAT,
        source: text(source),
        tokens,
        sentence,
        vliw: decoded,
        pyash: sentenceToPyash(sentence),
        englishPyash: renderEnglishPyash(sentence, tokens, decoded, mergedGlosses),
        english: renderEnglish(sentence, tokens, decoded, mergedGlosses)
      };
    }
  };
}

export function decodePyacSentence(source, options = {}) {
  return buildPyacDecoder(options).decode(source);
}

export function translatePyacToEnglishPyash(source, options = {}) {
  const decoder = buildPyacDecoder(options);
  const records = splitSentence(source).map((line) => decoder.decode(line));
  return {
    format: PYAC_TO_ENGLISH_PYASH_FORMAT,
    source,
    records,
    pyash: records.map((record) => record.pyash).join("\n"),
    englishPyash: records.map((record) => record.englishPyash).join("\n"),
    english: records.map((record) => record.english).join("\n")
  };
}
