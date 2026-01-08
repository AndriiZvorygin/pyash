import { buildProgram } from "../../program.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { remember, doRemember } from "../../remember/index.mjs";
import { englishLineToSentence, sentenceToEnglish } from "./translation/english.mjs";
import { javascriptLineToSentence } from "./translation/javascript.mjs";

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
