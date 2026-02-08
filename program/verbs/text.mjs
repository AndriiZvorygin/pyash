import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";
import { resolveGenitiveTarget } from "./mathematics/plus_helpers.mjs";

function resolveTextValue(ob = {}, { rememberFn } = {}) {
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.filename === "string") return ob.filename;
  if (ob.name && rememberFn) {
    const fact = rememberFn(ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.num === "number") return String(fact.ob.num);
    if (typeof fact?.ob?.boolean === "boolean") return fact.ob.boolean ? "truth" : "lie";
    if (fact?.ob?.hollow) return "null";
  }
  if (ob.genitive) {
    const v = renderSayValue({ genitive: ob.genitive }, { rememberFn });
    if (v !== undefined) return String(v);
  }
  const fallback = renderSayValue(ob, { rememberFn });
  return fallback !== undefined ? String(fallback) : "";
}

export async function text(sentence, { remember: rememberFn = remember } = {}) {
  const value = resolveTextValue(sentence.ob ?? {}, { rememberFn });
  if (sentence.to?.genitive) {
    const target = resolveGenitiveTarget(sentence.to.genitive, rememberFn);
    if (target) {
      if (target.value && typeof target.value === "object" && target.value.ob && typeof target.value.ob === "object") {
        target.value.ob.text = value;
      } else if (target.value && typeof target.value === "object" && !Array.isArray(target.value)) {
        target.value.text = value;
      } else {
        target.parent[target.key] = { text: value };
      }
    }
  }
  return { ob: { text: value }, be: "text" };
}

export default text;

export const signatures = [
  { signatureWords: ["be", "text", "ob", "text"], handler: text },
  { signatureWords: ["be", "text", "ob", "filename"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "num"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "text"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "filename"], handler: text },
  { signatureWords: ["be", "text", "ob", "text", "to", "name", "text"], handler: text },
  { signatureWords: ["be", "text", "ob", "text", "to", "name", "num"], handler: text },
  { signatureWords: ["be", "text", "ob", "filename", "to", "name", "text"], handler: text },
  { signatureWords: ["be", "text", "ob", "filename", "to", "name", "num"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "num", "to", "name", "text"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "num", "to", "name", "num"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "text", "to", "name", "text"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "text", "to", "name", "num"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "filename", "to", "name", "text"], handler: text },
  { signatureWords: ["be", "text", "ob", "name", "filename", "to", "name", "num"], handler: text }
];
