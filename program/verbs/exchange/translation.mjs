import { buildProgram } from "../../program.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { remember, doRemember } from "../../remember/index.mjs";
import { resolveTranslationSource, resolveTranslationTarget } from "./translation/registry.mjs";
import { matchGlossToPyash } from "./translation/reverse_pairs.mjs";
import { loadAnchorWordForms } from "./translation/anchor_words.mjs";
import { normalizeAnchorSentence, applyTemplatePairs } from "./translation/helpers.mjs";
import {
  loadEnglishTranslationPairs,
  loadRussianTranslationPairs,
  loadFrenchTranslationPairs,
  loadChineseTranslationPairs,
  loadInterlinguaTranslationPairs,
  loadHindiTranslationPairs,
  loadEnglishTranslationTemplates,
  loadRussianTranslationTemplates,
  loadFrenchTranslationTemplates,
  loadChineseTranslationTemplates,
  loadInterlinguaTranslationTemplates,
  loadHindiTranslationTemplates
} from "./translation/pairs.mjs";

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
  const targetLang = (sentence?.become?.name || sentence?.tostate?.name || "").toLowerCase();
  const sourceAdapter = resolveTranslationSource(sourceLang);
  const outputLang = targetLang || (sourceAdapter ? "pyash" : "english");
  let translation = "";
  let sentences = [];

  if (sourceAdapter) {
    let anchorForms = null;
    try {
      anchorForms = await loadAnchorWordForms();
    } catch {
      anchorForms = null;
    }
    sentences = sourceText
      .replaceAll("\\n", "\n")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const useReverse = sourceAdapter.name !== "russian"
          && sourceAdapter.name !== "chinese"
          && sourceAdapter.name !== "interlingua"
          && sourceAdapter.name !== "hindi"
          && sourceAdapter.name !== "javascript"
          && sourceAdapter.name !== "whisper-english";
        const matched = useReverse ? matchGlossToPyash(line, { language: sourceAdapter.name }) : null;
        if (matched) {
          const program = buildProgram(matched);
          return program.sentences.map((sentence) => normalizeAnchorSentence(sentence, anchorForms));
        }
        const parsed = sourceAdapter.toPyash(line);
        return parsed ? [normalizeAnchorSentence(parsed, anchorForms)] : [];
      });
    translation = sentences
      .map(s => sentenceToPyash(s) ?? JSON.stringify(s))
      .join("\n");
  } else {
    const program = buildProgram(sourceText.replaceAll("\\n", "\n"));
    sentences = program.sentences;
    const targetAdapter = resolveTranslationTarget(outputLang) ?? resolveTranslationTarget("english");
    const formatter = targetAdapter?.fromPyash;
    if (!formatter) {
      throw new Error("translation: target adapter missing");
    }
    let pairs = null;
    if (targetAdapter?.name === "english") {
      try {
        pairs = await loadEnglishTranslationPairs();
      } catch (err) {
        pairs = null;
      }
    }
    if (!pairs && targetAdapter?.name === "russian") {
      try {
        pairs = await loadRussianTranslationPairs();
      } catch (err) {
        pairs = null;
      }
    }
    if (!pairs && targetAdapter?.name === "french") {
      try {
        pairs = await loadFrenchTranslationPairs();
      } catch (err) {
        pairs = null;
      }
    }
    if (!pairs && targetAdapter?.name === "chinese") {
      try {
        pairs = await loadChineseTranslationPairs();
      } catch (err) {
        pairs = null;
      }
    }
    if (!pairs && targetAdapter?.name === "interlingua") {
      try {
        pairs = await loadInterlinguaTranslationPairs();
      } catch (err) {
        pairs = null;
      }
    }
    if (!pairs && targetAdapter?.name === "hindi") {
      try {
        pairs = await loadHindiTranslationPairs();
      } catch (err) {
        pairs = null;
      }
    }
    let templates = null;
    if (targetAdapter?.name === "english") {
      try {
        templates = await loadEnglishTranslationTemplates();
      } catch (err) {
        templates = null;
      }
    }
    if (!templates && targetAdapter?.name === "russian") {
      try {
        templates = await loadRussianTranslationTemplates();
      } catch (err) {
        templates = null;
      }
    }
    if (!templates && targetAdapter?.name === "french") {
      try {
        templates = await loadFrenchTranslationTemplates();
      } catch (err) {
        templates = null;
      }
    }
    if (!templates && targetAdapter?.name === "chinese") {
      try {
        templates = await loadChineseTranslationTemplates();
      } catch (err) {
        templates = null;
      }
    }
    if (!templates && targetAdapter?.name === "interlingua") {
      try {
        templates = await loadInterlinguaTranslationTemplates();
      } catch (err) {
        templates = null;
      }
    }
    if (!templates && targetAdapter?.name === "hindi") {
      try {
        templates = await loadHindiTranslationTemplates();
      } catch (err) {
        templates = null;
      }
    }
    const lines = program.sentences.map((s) => {
      if (pairs) {
        const pyash = sentenceToPyash(s);
        const text = pyash ? pairs.get(pyash) : null;
        if (typeof text === "string") return text;
      }
      if (templates) {
        const pyash = sentenceToPyash(s);
        const templated = pyash ? applyTemplatePairs(templates, s, pyash, targetAdapter?.name ?? outputLang, formatter) : null;
        if (typeof templated === "string") return templated;
      }
      return formatter(s);
    });
    translation = lines.join("\n");
  }

  const targetName = sentence?.to?.name ?? sentence?.su?.name;
  if (targetName) {
    doRemember({
      su: { name: targetName },
      be: sentence?.become?.name ?? outputLang,
      ob: { text: translation, sentences },
      mood: "ya"
    });
  }

  return { ob: { text: translation, sentences }, be: sentence?.become?.name ?? outputLang };
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
    signatureWords: ["be", "translation", "become", "name", "english", "from", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "english", "from", "filename", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "english", "from", "filename", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "english", "from", "name", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "english", "from", "name", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "russian", "from", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "russian", "from", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "chinese", "from", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "chinese", "from", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "french", "from", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "interlingua", "from", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "interlingua", "from", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "spanish", "from", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "spanish", "from", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "hindi", "from", "text", "fromstate", "name", "pyash", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "hindi", "from", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "french", "from", "text", "fromstate", "name", "pyash", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "english", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "russian", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "french", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "interlingua", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "spanish", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "hindi", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "chinese", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "whisper-english", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "whisper-english", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "russian", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "french", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "interlingua", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "spanish", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "hindi", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "chinese", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "whisperenglish", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "whisperenglish", "to", "name", "text"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "whisper_english", "to", "name", "num"],
    handler: translation_from_text_to_name_text
  },
  {
    signatureWords: ["be", "translation", "become", "name", "pyash", "from", "text", "fromstate", "name", "whisper_english", "to", "name", "text"],
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
