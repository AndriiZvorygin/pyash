import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";

function resolveBoolean(ob, { rememberFn = remember } = {}) {
  if (typeof ob?.boolean === "boolean") return ob.boolean;
  if (typeof ob?.bool === "boolean") return ob.bool;
  if (typeof ob?.name === "string") {
    const fact = rememberFn(ob.name);
    if (typeof fact?.ob?.boolean === "boolean") return fact.ob.boolean;
    if (typeof fact?.ob?.bool === "boolean") return fact.ob.bool;
  }
  throwErrorSentence({
    name: "boolean defective",
    message: "boolean requires a boolean value",
    from: { name: "boolean" },
    raw: { ob }
  });
}

export function boolean(sentence, { remember: rememberFn = remember } = {}) {
  return {
    ob: { boolean: resolveBoolean(sentence?.ob, { rememberFn }) },
    be: "boolean"
  };
}

export const signatures = [
  { signatureWords: ["be", "boolean", "ob", "bool"], handler: boolean },
  { signatureWords: ["be", "boolean", "ob", "bool", "to", "name", "bool"], handler: boolean },
  { signatureWords: ["be", "boolean", "ob", "bool", "to", "name", "boolean"], handler: boolean },
  { signatureWords: ["be", "boolean", "ob", "name", "bool"], handler: boolean },
  { signatureWords: ["be", "boolean", "ob", "name", "bool", "to", "name", "bool"], handler: boolean },
  { signatureWords: ["be", "boolean", "ob", "name", "bool", "to", "name", "boolean"], handler: boolean }
];

export default boolean;
