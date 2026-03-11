import { remember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveVector(sentence, { rememberFn = remember } = {}) {
  const ob = sentence?.ob ?? {};
  if (ob?.ve?.values && (ob.ve.type === "text" || !ob.ve.type)) {
    return ob.ve.values.map(value => String(value ?? ""));
  }
  if (typeof ob?.name === "string") {
    const fact = rememberFn(ob.name);
    const values = fact?.ob?.ve?.values;
    const type = String(fact?.ob?.ve?.type ?? "").trim().toLowerCase();
    if (Array.isArray(values) && (type === "text" || type === "")) {
      return values.map(value => String(value ?? ""));
    }
  }
  return null;
}

function resolveDelimiter(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.by?.wo === "string") {
    if (sentence.by.wo === "newline") return "\n";
    return sentence.by.wo;
  }
  if (typeof sentence?.by?.text === "string") return sentence.by.text;
  if (typeof sentence?.by?.name === "string") {
    const fact = rememberFn(sentence.by.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return null;
}

export async function gather(sentence, { remember: rememberFn = remember, doRemember: doRememberFn = doRemember } = {}) {
  const values = resolveVector(sentence, { rememberFn });
  if (!Array.isArray(values)) {
    throwErrorSentence({
      name: "gather defective",
      message: "gather defective: missing text vector",
      from: { name: "gather" },
      raw: sentence
    });
  }

  const delimiter = resolveDelimiter(sentence, { rememberFn });
  if (typeof delimiter !== "string") {
    throwErrorSentence({
      name: "gather defective",
      message: "gather defective: missing delimiter",
      from: { name: "gather" },
      raw: sentence
    });
  }

  const joined = values.join(delimiter);
  const out = {
    mood: "ya",
    su: { name: sentence?.to?.name ?? "gathered text" },
    be: "text",
    ob: { text: joined }
  };
  if (sentence?.to?.name) doRememberFn(out);
  return out;
}

export default gather;

export const signatures = [
  { signatureWords: ["be", "gather", "ob", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "ob", "name", "vec", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "ob", "name", "vec", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "text", "ob", "vec", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "text", "ob", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "text", "ob", "name", "vec", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "text", "ob", "name", "vec", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "name", "text", "ob", "vec", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "name", "text", "ob", "name", "vec", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "name", "text", "ob", "name", "vec", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "wo", "newline", "ob", "vec", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "wo", "newline", "ob", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "wo", "newline", "ob", "name", "vec", "text", "to", "name", "text"], handler: gather },
  { signatureWords: ["be", "gather", "by", "wo", "newline", "ob", "name", "vec", "to", "name", "text"], handler: gather }
];
