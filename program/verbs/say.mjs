import { remember } from "../remember/index.mjs";
import { state } from "../bridge/state.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

function vectorLiteral(values = [], type = "num") {
  const parts = ["ve", type];
  for (const value of values) {
    if (typeof value === "number") {
      parts.push(String(value));
    } else if (typeof value === "boolean") {
      parts.push(value ? "truth" : "lie");
    } else if (typeof value === "string") {
      if (/^[A-Za-z0-9_.-]+$/.test(value)) {
        parts.push(value);
      } else {
        parts.push(JSON.stringify(value));
      }
    } else {
      parts.push(String(value));
    }
  }
  return parts.join(" ");
}

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
    if (curr && typeof curr === "object" && curr.obj && curr.obj[part] !== undefined) {
      curr = curr.obj[part];
    } else {
      curr = curr?.[part];
    }
  }

  if (typeof curr === "number") return curr;
  if (typeof curr === "string") return curr;
  if (curr && typeof curr === "object") {
    if (typeof curr.num === "number") return curr.num;
    if (typeof curr.text === "string") return curr.text;
    if (typeof curr.boolean === "boolean") return curr.boolean ? "truth" : "lie";
    if (Array.isArray(curr.values)) return vectorLiteral(curr.values, curr.type || "num");
    if (curr.ve?.values) return vectorLiteral(curr.ve.values, curr.ve.type || "num");
  }
  return curr;
}

function resolveValue(obj = {}, { rememberFn } = {}) {
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.num === "number") return obj.num;
  if (typeof obj.boolean === "boolean") return obj.boolean ? "truth" : "lie";
  if (obj.hollow) return "null";
  if (obj.genitive) {
    const v = resolveGenitive(obj.genitive, { rememberFn });
    if (v !== undefined) return v;
  }
  if (obj.name && rememberFn) {
    const fact = rememberFn(obj.name);
    if (fact?.obj?.ve?.values) return sentenceToPyash(fact);
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
  { signatureWords: ["be", "say", "obj", "bool"], handler: say },
  { signatureWords: ["be", "say", "obj", "hollow"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "text"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "num"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "bool"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "hollow"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec", "num"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec", "text"], handler: say },
  { signatureWords: ["be", "say", "obj", "name", "vec", "bool"], handler: say },
  { signatureWords: ["be", "say", "obj", "vec"], handler: say }
];
