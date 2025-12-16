import { remember } from "../remember/index.mjs";

function resolveValue(obj = {}, { rememberFn } = {}) {
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.num === "number") return obj.num;
  if (obj.name && rememberFn) {
    const fact = rememberFn(obj.name);
    if (fact?.obj?.ve?.values) return JSON.stringify(fact.obj.ve.values);
    if (fact?.obj?.text !== undefined) return fact.obj.text;
    if (fact?.obj?.num !== undefined) return fact.obj.num;
  }
  if (obj.name) return obj.name;
  return "";
}

export async function say(sentence, { remember: rememberFn = remember } = {}) {
  const text = resolveValue(sentence.obj ?? {}, { rememberFn });
  // Log for REPL friendliness
  // eslint-disable-next-line no-console
  console.log(text);
  return { obj: { text }, be: "say" };
}

export default say;

export const signatures = [
  { signatureWords: ["be", "say", "obj", "text"], handler: say },
  { signatureWords: ["be", "say", "obj", "num"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "text"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "num"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec"], handler: say }
];
