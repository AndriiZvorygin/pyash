import { remember } from "../remember/index.mjs";
import { state } from "../bridge/state.mjs";

function resolveGenitive(genitive, { rememberFn } = {}) {
  const chainArr = Array.isArray(genitive?.chain) ? genitive.chain : [];
  if (chainArr.length === 0) return undefined;

  const [root, ...rest] = chainArr;
  let curr =
    root === "this"
      ? (state.currentEvokeRef || state.currentEvoke)
      : (typeof root === "string" && rememberFn ? rememberFn(root) : undefined);

  for (const part of rest) {
    if (curr && typeof curr === "object" && curr.name && rememberFn) {
      const fact = rememberFn(curr.name);
      if (fact) curr = fact.obj ?? fact;
    }
    curr = curr?.[part];
  }

  if (typeof curr === "number") return curr;
  if (typeof curr === "string") return curr;
  if (curr && typeof curr === "object") {
    if (typeof curr.num === "number") return curr.num;
    if (typeof curr.text === "string") return curr.text;
    if (typeof curr.boolean === "boolean") return curr.boolean ? "truth" : "lie";
    if (curr.ve?.values) return JSON.stringify(curr.ve.values);
  }
  return curr;
}

function resolveValue(obj = {}, { rememberFn } = {}) {
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.num === "number") return obj.num;
  if (obj.genitive) {
    const v = resolveGenitive(obj.genitive, { rememberFn });
    if (v !== undefined) return v;
  }
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
  { signatureWords: ["be", "say", "obj", "name", "vec"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec", "num"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec", "text"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec", "bool"], handler: say }
];
