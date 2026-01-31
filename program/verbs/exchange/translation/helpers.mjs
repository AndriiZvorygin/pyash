import { sentenceToPyash } from "../../../beautiful.mjs";
import { translateNameToChinese } from "./chinese.mjs";
import { translateNameToHindi } from "./hindi.mjs";
import { translateNameToInterlingua } from "./interlingua.mjs";
import { translateNameToRussian } from "./russian.mjs";

export function resolveRolePath(sentence, tokens) {
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

export function placeholderValueForCase(sentence, field, rolePath) {
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

export function renderVectorForKey(vec) {
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

export function renderPlaceholderValueForKey(field, value, language) {
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

export function renderPlaceholderValueForOutput(field, value, language, formatter) {
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
    if (language === "hindi") return translateNameToHindi(name);
    return name;
  }
  if (field === "bool" || field === "boolean") {
    const truth = value === true;
    if (language === "russian") return truth ? "истина" : "ложь";
    if (language === "french") return truth ? "vrai" : "faux";
    if (language === "chinese") return truth ? "真相" : "谎言";
    if (language === "interlingua") return truth ? "veritate" : "false";
    if (language === "hindi") return truth ? "सच" : "झूठ";
    return truth ? "true" : "false";
  }
  if (field === "vec" || field === "ve") {
    return renderVectorGlossForLanguage(value, language);
  }
  return String(value);
}

export function renderVectorGlossForLanguage(vec, language) {
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
  if (language === "hindi") {
    const typeGloss = type === "text" ? "टेक्स्ट" : type === "bool" ? "बूलियन" : "संख्या";
    return ["वेक्टर", typeGloss, ...rendered].join(" ");
  }
  return ["ve", type, ...rendered].join(" ");
}

export function normalizeAnchorSentence(sentence, anchorForms) {
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

export function normalizeAnchorName(name, formsToAnchor) {
  if (!name) return name;
  return String(name)
    .split(/\s+/)
    .map((token) => formsToAnchor.get(token) ?? token)
    .join(" ");
}

export function applyTemplatePairs(templates, sentence, pyash, language, formatter) {
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
