import { sanitizeName } from "./util.mjs";
import { pathFromGenitive } from "./expr_helpers.mjs";

function inferRetKind(slot, { localsTypes, declaredTypes } = {}) {
  if (!slot) return "number";
  if (slot.text !== undefined) return "text";
  if (slot.num !== undefined) return "number";
  if (slot.boolean !== undefined) return "bool";
  if (slot.name) {
    const base = sanitizeName(slot.name);
    const localType = localsTypes?.get(base);
    const declaredType = declaredTypes?.get(base);
    const knownType = localType || declaredType;
    if (knownType === "text") return "text";
    if (knownType === "number") return "number";
  }
  if (slot.genitive) {
    const chainArr = Array.isArray(slot.genitive) ? slot.genitive : slot.genitive?.chain;
    if (Array.isArray(chainArr)) {
      if (chainArr.includes("text")) return "text";
      if (chainArr.includes("bool") || chainArr.includes("boolean")) return "bool";
    }
  }
  return "number";
}

function wrapRetValue(expr, kind, lang) {
  if (lang !== "c") return `return ${expr};`;
  if (kind === "text") return `return pya_value_text(${expr});`;
  if (kind === "bool") return `return pya_value_num(${expr} ? 1 : 0);`;
  return `return pya_value_num(${expr});`;
}

function handleRetSentence(sentence, { lang, sentenceArg, locals, declared, localsTypes, declaredTypes, cHelpers } = {}) {
  if (sentence.mood !== "ret") return null;
  const sourceName = sentence?.ret?.name || sentence?.ob?.name || sentence?.su?.name;
  if (lang === "c" && cHelpers) cHelpers.usesCeremonyValue = true;
  if (sourceName) {
    const sourceVar = sanitizeName(sourceName);
    const kind = inferRetKind({ name: sourceName }, { localsTypes, declaredTypes });
    return wrapRetValue(sourceVar, kind, lang);
  }
  if (sentence.ob?.genitive) {
    const expr = pathFromGenitive(sentence.ob.genitive, sentenceArg, { locals, declared, allowCGlobals: lang === "c" });
    if (expr) {
      const kind = inferRetKind(sentence.ob, { localsTypes, declaredTypes });
      return wrapRetValue(expr, kind, lang);
    }
  }
  if (sentence.ob?.num !== undefined) {
    return wrapRetValue(`${Number(sentence.ob.num) || 0}`, "number", lang);
  }
  if (typeof sentence.ob?.text === "string") {
    return wrapRetValue(JSON.stringify(sentence.ob.text), "text", lang);
  }
  if (lang === "c") return "return pya_value_from_this();";
  return "return sentence;";
}

export { inferRetKind, wrapRetValue, handleRetSentence };
