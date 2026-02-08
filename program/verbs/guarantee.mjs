import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveBool(ob, { rememberFn = remember } = {}) {
  if (!ob || typeof ob !== "object") return null;
  if (typeof ob.boolean === "boolean") return ob.boolean;
  if (typeof ob.bool === "boolean") return ob.bool;
  if (typeof ob.name === "string") {
    const fact = rememberFn(ob.name);
    if (typeof fact?.ob?.boolean === "boolean") return fact.ob.boolean;
  }
  if (typeof ob.text === "string") {
    const text = ob.text.trim().toLowerCase();
    if (text === "truth" || text === "true" || text === "1" || text === "pass") return true;
    if (text === "lie" || text === "false" || text === "0" || text === "fail") return false;
  }
  return null;
}

export function guarantee(sentence, { remember: rememberFn = remember } = {}) {
  const ok = resolveBool(sentence?.ob, { rememberFn });
  if (ok === true) return { ob: { boolean: true }, be: "truth" };
  const message = sentence?.fromtext?.text ?? "guarantee defective";
  throwErrorSentence({
    name: "guarantee defective",
    message: String(message),
    from: { name: "guarantee" },
    raw: { sentence }
  });
}

export const signatures = [
  { signatureWords: ["be", "guarantee", "ob", "bool"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "ob", "boolean"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "ob", "name", "bool"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "ob", "name", "boolean"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "ob", "text"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "fromtext", "text", "ob", "bool"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "fromtext", "text", "ob", "boolean"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "fromtext", "text", "ob", "name", "bool"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "fromtext", "text", "ob", "name", "boolean"], handler: guarantee },
  { signatureWords: ["be", "guarantee", "fromtext", "text", "ob", "text"], handler: guarantee }
];

export default guarantee;
