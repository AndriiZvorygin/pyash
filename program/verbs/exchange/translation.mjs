import { buildProgram } from "../../program.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { remember, doRemember } from "../../remember/index.mjs";
import { resolveTranslationSource, resolveTranslationTarget } from "./translation/registry.mjs";
import { matchGlossToPyash } from "./translation/reverse_pairs.mjs";
import { translateNameToChinese } from "./translation/chinese.mjs";
import { translateNameToInterlingua } from "./translation/interlingua.mjs";
import { translateNameToRussian } from "./translation/russian.mjs";
import { loadAnchorWordForms } from "./translation/anchor_words.mjs";
import {
  loadEnglishTranslationPairs,
  loadRussianTranslationPairs,
  loadFrenchTranslationPairs,
  loadChineseTranslationPairs,
  loadInterlinguaTranslationPairs,
  loadEnglishTranslationTemplates,
  loadRussianTranslationTemplates,
  loadFrenchTranslationTemplates,
  loadChineseTranslationTemplates,
  loadInterlinguaTranslationTemplates
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
        const useReverse = sourceAdapter.name !== "russian" && sourceAdapter.name !== "chinese" && sourceAdapter.name !== "interlingua";
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

function resolveRolePath(sentence, tokens) {
  let current = sentence;
  for (const token of tokens) {
    if (!current || typeof current !== "object") return null;
    if (token === "consequence") {
      current = current.consequence;
      continue;
    }
    if (token === "su" || token === "ob" || token === "to" || token === "from" || token === "with" || token === "via" || token === "by") {
      current = current[token];
      continue;
    }
    return null;
  }
  return current;
}

function placeholderValueForCase(sentence, field, rolePath) {
  const target = resolveRolePath(sentence, rolePath);
  if (!target) return null;
  if (field === "pyash") return target;
  if (field === "gloss") return target;
  if (field === "name") return target.name ?? null;
  if (field === "text") return target.text ?? null;
  if (field === "num") return target.num ?? null;
  if (field === "bool" || field === "boolean") {
    if (target.boolean === true || target.boolean === false) return target.boolean;
    return null;
  }
  if (field === "date") return target.date ?? null;
  if (field === "filename") return target.filename ?? null;
  if (field === "wo") return target.wo ?? null;
  if (field === "vec" || field === "ve") return target.ve ?? null;
  return null;
}

function renderVectorForKey(vec) {
  if (!vec || typeof vec !== "object") return null;
  const type = vec.type || "num";
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
  return ["ve", type, ...rendered].join(" ");
}

function renderPlaceholderValueForKey(field, value, language) {
  if (value == null) return null;
  if (field === "pyash") {
    if (!value || typeof value !== "object") return null;
    const pyash = sentenceToPyash(value);
    return pyash || null;
  }
  if (field === "text") {
    if (typeof value !== "string") return null;
    if (/[\n\r]/.test(value)) {
      return `quoted.text.${value}.text.quoted`;
    }
    return JSON.stringify(value);
  }
  if (field === "bool" || field === "boolean") {
    return value === true ? "truth" : "lie";
  }
  if (field === "vec" || field === "ve") {
    return renderVectorForKey(value);
  }
  return String(value);
}

function renderPlaceholderValueForOutput(field, value, language, formatter) {
  if (value == null) return null;
  if (field === "gloss") {
    if (!value || typeof value !== "object") return null;
    if (typeof formatter !== "function") return null;
    try {
      return formatter(value);
    } catch {
      return null;
    }
  }
  if (field === "pyash") {
    if (!value || typeof value !== "object") return null;
    const pyash = sentenceToPyash(value);
    return pyash || null;
  }
  if (field === "text") {
    if (typeof value !== "string") return null;
    return value;
  }
  if (field === "name") {
    const name = String(value);
    if (language === "russian") return translateNameToRussian(name);
    if (language === "chinese") return translateNameToChinese(name);
    if (language === "interlingua") return translateNameToInterlingua(name);
    return name;
  }
  if (field === "bool" || field === "boolean") {
    const truth = value === true;
    if (language === "russian") return truth ? "истина" : "ложь";
    if (language === "french") return truth ? "vrai" : "faux";
    if (language === "chinese") return truth ? "真相" : "谎言";
    if (language === "interlingua") return truth ? "veritate" : "false";
    return truth ? "true" : "false";
  }
  if (field === "vec" || field === "ve") {
    return renderVectorGlossForLanguage(value, language);
  }
  return String(value);
}

function renderVectorGlossForLanguage(vec, language) {
  if (!vec || typeof vec !== "object") return null;
  const type = vec.type || "num";
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
  if (language === "russian") {
    const typeGloss = type === "text" ? "текст" : type === "bool" ? "булево" : "число";
    return ["ве", typeGloss, ...rendered].join(" ");
  }
  if (language === "french") {
    const typeGloss = type === "text" ? "texte" : type === "bool" ? "booleen" : "nombre";
    return ["ve", typeGloss, ...rendered].join(" ");
  }
  if (language === "chinese") {
    const typeGloss = type === "text" ? "文本" : type === "bool" ? "布尔" : "数";
    return ["量", typeGloss, ...rendered].join(" ");
  }
  if (language === "interlingua") {
    const typeGloss = type === "text" ? "texto" : type === "bool" ? "booleano" : "numero";
    return ["vector", typeGloss, ...rendered].join(" ");
  }
  return ["ve", type, ...rendered].join(" ");
}

function normalizeAnchorSentence(sentence, anchorForms) {
  if (!anchorForms?.formsToAnchor || !sentence || typeof sentence !== "object") return sentence;
  const formsToAnchor = anchorForms.formsToAnchor;
  const stack = [sentence];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (typeof node.name === "string") {
      node.name = normalizeAnchorName(node.name, formsToAnchor);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return sentence;
}

function normalizeAnchorName(name, formsToAnchor) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => formsToAnchor.get(token) ?? token)
    .join(" ");
}

function applyTemplatePairs(templates, sentence, pyash, language, formatter) {
  for (const template of templates) {
    const substitution = new Map();
    const outputSubstitution = new Map();
    const placeholders = template.key.match(/\[[^\]]+\]/g) ?? [];
    let ok = true;
    for (const raw of placeholders) {
      const token = raw.slice(1, -1).trim();
      const match = token.match(/^([a-zA-Z]+)\s+of\s+(.+)$/);
      if (!match) {
        ok = false;
        break;
      }
      const [, fieldRaw, roleRaw] = match;
      const field = fieldRaw.toLowerCase();
      const rolePath = roleRaw.toLowerCase().split(/\s+/).filter(Boolean);
      const value = placeholderValueForCase(sentence, field, rolePath);
      const renderedKey = renderPlaceholderValueForKey(field, value, language);
      const renderedOutput = renderPlaceholderValueForOutput(field, value, language, formatter);
      if (renderedKey == null || renderedOutput == null) {
        ok = false;
        break;
      }
      substitution.set(raw, renderedKey);
      outputSubstitution.set(raw, renderedOutput);
    }
    if (!ok) continue;
    let candidate = template.key;
    for (const [placeholder, rendered] of substitution.entries()) {
      candidate = candidate.split(placeholder).join(rendered);
    }
    if (candidate !== pyash) continue;
    let output = template.value;
    for (const [placeholder, rendered] of outputSubstitution.entries()) {
      output = output.split(placeholder).join(rendered);
    }
    return output;
  }
  return null;
}

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
