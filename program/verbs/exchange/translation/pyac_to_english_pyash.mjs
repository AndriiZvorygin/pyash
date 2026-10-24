import pyashWords from "../../../library/pyashWords.json" with { type: "json" };
import { sentenceToPyash } from "../../../beautiful.mjs";
import { PYASH_SURFACE_FUSED_MOODS } from "./pyash_surface.mjs";
import {
  decodePhraseVliw,
  lowerPhraseVliw,
  PHRASE_CASE_WORDS,
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
for (const entry of pyashWords) {
  if (typeof entry?.en === "string" && entry.en.endsWith("_case_")) {
    CASE_NAMES.set(entry.pya, entry.en.replace(/_case_$/u, "").replaceAll("_", " "));
  }
}

const MOOD_WORDS = new Set(PYASH_SURFACE_FUSED_MOODS);
const ENGLISH_MOOD_GLOSSES = new Map([
  ["jwih", "may"]
]);
const CASE_PREPOSITIONS = new Map([
  ["ti", "of"],
  ["te", "in"],
  ["ma", "to"],
  ["so", "from"],
  ["ta", "on"],
  ["twih", "into"],
  ["yu", "with"],
  ["mwah", "with"],
  ["pwah", "for"],
  ["swih", "as"],
  ["ga", "via"],
  ["pwih", "from"],
  ["twah", "out of"],
  ["lwah", "through"],
  ["lwih", "off"],
  ["tweh", "until"],
  ["nweh", "in"],
  ["lweh", "to"],
  ["we", "via"],
  ["ksih", "because of"],
  ["nwah", "according to"],
  ["nyeh", "from"],
  ["sweh", "onto"],
  ["txih", "beyond"],
  ["ryoh", "through"],
  ["pxeh", "of"],
  ["pxoh", "through"],
  ["dxoh", "by"],
  ["greh", "around"],
  ["rweh", "about"],
  ["lwoh", "at"],
  ["bvah", "without"],
  ["dvah", "at"],
  ["je", "by"],
  ["gveh", "by"],
  ["vwih", "away from"],
  ["bveh", "under"],
  ["dzih", "with"],
  ["tsi7h", "before"],
  ["vyah", "as"],
  ["gvah", "toward"],
  ["zreh", "outside"],
  ["psuh", "over"],
  ["sa7", "with"],
  ["ta7", "to"]
]);
const PRONOUN_FORMS = new Map([
  ["mi", { subject: "I", object: "me", possessive: "my", standalone: "mine" }],
  ["sa", { subject: "you", object: "you", possessive: "your", standalone: "yours" }],
  ["nyah", { subject: "we", object: "us", possessive: "our", standalone: "ours" }],
  ["ya", { subject: "it", object: "it", possessive: "its", standalone: "its" }],
  ["mo", { subject: "we", object: "us", possessive: "our", standalone: "ours" }]
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
  if (parts.phrases.length === 0 && parts.trailing.length === 0) {
    throw invalid("Pyac sentence requires a subject and verb");
  }
  const subjectPhrase = selectSubjectPhrase(parts);
  const verbParts = parts.trailing;
  const object = parts.phrases
    .filter((phrase) => phrase !== subjectPhrase)
    .flatMap((phrase) => phrase.tokens.map((part) => part.pya))
    .join(" ");
  const subject = subjectPhrase
    ? subjectPhrase.tokens.map((part) => part.pya).join(" ")
    : "sa";
  const sentence = {
    mood: parts.mood ?? "ya",
    su: { name: subject },
    be: verbParts.map((part) => part.pya).join(" ")
  };
  if (object) sentence.ob = { name: object };
  return sentence;
}

function selectSubjectPhrase(parts) {
  return parts.phrases.find((phrase) => phrase.case === "na")
    ?? (isImperative(parts.mood) ? null : parts.phrases[0] ?? null);
}

function isImperative(mood) {
  return mood === "pcih" || mood === "di" || mood === "ru";
}

function isPronoun(part) {
  return PRONOUN_FORMS.has(part.pya);
}

function pronounForm(part, role) {
  return PRONOUN_FORMS.get(part.pya)?.[role] ?? part.english;
}

function phraseCase(parts) {
  const last = parts.at(-1);
  return last?.kind === "case" ? last.pya : null;
}

function renderCasePreposition(caseName, words, parts, { vocativeMarker = false } = {}) {
  if (!caseName || !words) return "";
  if (caseName === "yi" && parts.some(isPronoun)) return "";
  if (caseName === "myah" && words === "today") return "";
  if (caseName === "myah" && words === "forever") return "";
  if (caseName === "wu") return vocativeMarker ? "O" : "";
  if (caseName === "na" || caseName === "ka") return "";
  return CASE_PREPOSITIONS.get(caseName) ?? (caseName === "yi" ? "to" : "");
}

function rootEnglish(part) {
  return part.english.replace(/_$/u, "");
}

function inflectVerb(parts) {
  const root = parts.find((part) => part.kind === "root");
  if (!root) return "something";
  const dictionaryForm = rootEnglish(root);
  const base = dictionaryForm.length > 5 && dictionaryForm.endsWith("ing")
    ? dictionaryForm
      .replace(/iving$/u, "ive")
      .replace(/uing$/u, "ue")
      .replace(/ing$/u, "")
    : dictionaryForm;
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

function renderPhrase(parts, { subject = false, standalone = false, vocativeMarker = false } = {}) {
  const words = [];
  let possessive = false;
  let possessivePya = null;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.kind === "root" || isPronoun(part)) {
      let word = rootEnglish(part);
      if (isPronoun(part)) word = pronounForm(part, subject ? "subject" : "object");
      if (possessive) {
        const owner = PRONOUN_FORMS.get(possessivePya);
        const ownerWord = owner?.possessive ?? `${words.at(-1)}'s`;
        words.splice(-1, 1, ownerWord);
        possessive = false;
        possessivePya = null;
      }
      words.push(word);
      continue;
    }
    if (part.pya === "ye") {
      possessive = true;
      possessivePya = words.length > 0 ? parts[index - 1]?.pya : null;
      continue;
    }
    if (part.pya === "pu" && words.length > 0) {
      words[words.length - 1] = words.at(-1).endsWith("s") ? words.at(-1) : `${words.at(-1)}s`;
      continue;
    }
    if (part.kind === "case") {
      continue;
    }
    if (part.pya === "no" || part.pya === "pyuh") {
      continue;
    }
    if (part.kind === "grammar" && part.english) words.push(part.english);
  }
  if (possessive && words.length > 0) {
    const owner = PRONOUN_FORMS.get(possessivePya);
    words[words.length - 1] = owner
      ? standalone ? owner.standalone : owner.possessive
      : `${words.at(-1)}'s`;
  }
  const rendered = words.join(" ");
  return [renderCasePreposition(phraseCase(parts), rendered, parts, { vocativeMarker }), rendered]
    .filter(Boolean)
    .join(" ");
}

function decodedPart(token, glosses) {
  return {
    pya: token.pya,
    kind: PHRASE_CASE_WORDS.has(token.pya)
      ? "case"
      : token.en.endsWith("_") ? "grammar" : "root",
    english: glosses.get(token.pya) ?? token.en.replace(/_$/u, "")
  };
}

function renderEnglishPyash(sentence, tokens, decoded, glosses) {
  const parts = phraseParts(decoded);
  const mood = ENGLISH_MOOD_GLOSSES.get(sentence.mood) ?? sentence.mood;
  if (parts.phrases.length === 0) {
    const standalone = renderPhrase(parts.trailing.map((token) => decodedPart(token, glosses)), { standalone: true });
    return [standalone, mood].filter(Boolean).join(" ");
  }
  const subjectPhrase = selectSubjectPhrase(parts);
  const nominalPredicate = parts.trailing.some((part) => ["ye", "sa", "mi", "nyah", "ya"].includes(part.pya))
    && !parts.trailing.some((part) => part.kind === "root");
  const subject = nominalPredicate
    ? renderPhrase(parts.trailing.map((token) => decodedPart(token, glosses)), { standalone: true })
    : isImperative(mood) && !subjectPhrase
      ? "you"
      : renderPhrase(subjectPhrase.tokens.map((token) => decodedPart(token, glosses)), { subject: true });
  const vocativePhrases = parts.phrases.filter((phrase) => phrase.case === "wu");
  const addressPhrases = vocativePhrases.length > 0
    ? parts.phrases.filter((phrase) => {
      const phraseIndex = parts.phrases.indexOf(phrase);
      const subjectIndex = parts.phrases.indexOf(subjectPhrase);
      return phraseIndex < subjectIndex && ["wu", "te"].includes(phrase.case);
    })
    : [];
  const argumentPhrases = nominalPredicate
    ? parts.phrases
    : parts.phrases.filter((phrase) => (
      phrase !== subjectPhrase && !addressPhrases.includes(phrase)
    ));
  const objectText = argumentPhrases
    .map((phrase) => renderPhrase(
      phrase.tokens.map((token) => decodedPart(token, glosses)),
      { vocativeMarker: true }
    ))
    .filter(Boolean)
    .join(" ");
  const verb = nominalPredicate
    ? "is"
    : inflectVerb(parts.trailing.map((token) => decodedPart(token, glosses))
    .filter((part) => part.kind !== "mood"));
  const negative = decoded.tokens.some((token) => token.pya === "no");
  const renderedVerb = negative ? `not ${verb}` : verb;
  const rendered = ["su", subject];
  if (objectText) rendered.push("ob", ...objectText.split(/\s+/u));
  rendered.push("be", renderedVerb, mood);
  if (addressPhrases.length === 0) return rendered.join(" ");
  const address = addressPhrases
    .map((phrase) => renderPhrase(
      phrase.tokens.map((token) => decodedPart(token, glosses)),
      { vocativeMarker: true }
    ))
    .filter(Boolean)
    .join(" ");
  return `${address}, ${rendered.join(" ")}`;
}

function renderEnglish(sentence, tokens, decoded, glosses) {
  const decodedParts = phraseParts(decoded);
  if (decodedParts.phrases.length === 0) {
    const standalone = renderPhrase(decodedParts.trailing.map((token) => decodedPart(token, glosses)), { standalone: true });
    return `${standalone[0].toUpperCase()}${standalone.slice(1)}.`;
  }
  const subjectPhrase = selectSubjectPhrase(decodedParts);
  const nominalPredicate = decodedParts.trailing.some((part) => ["ye", "sa", "mi", "nyah", "ya"].includes(part.pya))
    && !decodedParts.trailing.some((part) => part.kind === "root");
  const implicitImperative = isImperative(decodedParts.mood) && !subjectPhrase;
  const subject = nominalPredicate
    ? renderPhrase(decodedParts.trailing.map((token) => decodedPart(token, glosses)), { standalone: true })
    : implicitImperative
      ? ""
      : renderPhrase(subjectPhrase.tokens.map((token) => decodedPart(token, glosses)), { subject: true });
  const vocativePhrases = decodedParts.phrases.filter((phrase) => phrase.case === "wu");
  const addressPhrases = vocativePhrases.length > 0
    ? decodedParts.phrases.filter((phrase) => {
      const phraseIndex = decodedParts.phrases.indexOf(phrase);
      const subjectIndex = decodedParts.phrases.indexOf(subjectPhrase);
      return phraseIndex < subjectIndex && ["wu", "te"].includes(phrase.case);
    })
    : [];
  const objectText = (nominalPredicate
    ? decodedParts.phrases
    : decodedParts.phrases.filter((phrase) => (
      phrase !== subjectPhrase && !addressPhrases.includes(phrase)
    )))
    .map((phrase) => renderPhrase(
      phrase.tokens
        .filter((token) => token.pya !== "pcah")
        .map((token) => decodedPart(token, glosses))
    ))
    .filter(Boolean)
    .join(" ");
  let verb = nominalPredicate
    ? "is"
    : inflectVerb(decodedParts.trailing.map((token) => decodedPart(token, glosses))
    .filter((part) => part.kind !== "mood"));
  const passive = decodedParts.trailing.some((part) => part.pya === "pyoh");
  if (passive || verb === "done") verb = `be ${verb}`;
  if (decoded.tokens?.some((token) => token.pya === "no")) verb = `do not ${verb}`;
  if (decoded.tokens?.some((token) => token.pya === "pcah")) verb = `also ${verb}`;
  let result = `${subject ? `${subject} ` : ""}${verb}${objectText ? ` ${objectText}` : ""}.`;
  if (decodedParts.mood === "jwih") result = `may ${result}`;
  if (addressPhrases.length > 0) {
    const address = addressPhrases
      .map((phrase) => renderPhrase(phrase.tokens.map((token) => decodedPart(token, glosses))))
      .filter(Boolean)
      .join(" ");
    result = `${address}, ${result}`;
  }
  if (decoded.tokens?.some((token) => token.pya === "pyuh")) result = `but ${result}`;
  return `${result[0].toUpperCase()}${result.slice(1)}`;
}

export function buildPyacDecoder({ entries = pyashWords, glosses = {} } = {}) {
  const inventory = buildInventory(entries);
  const mergedGlosses = new Map([
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

export function renderEnglishFromVliw(input, { glosses = {} } = {}) {
  const decoded = input?.vectors ? decodePhraseVliw(input.vectors) : decodePhraseVliw(input);
  const mergedGlosses = new Map([
    ...Object.entries(glosses).map(([key, value]) => [key, text(value)])
  ]);
  const sentence = structuralSentence([], decoded);
  return {
    sentence,
    englishPyash: renderEnglishPyash(sentence, [], decoded, mergedGlosses),
    english: renderEnglish(sentence, [], decoded, mergedGlosses)
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
