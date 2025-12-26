import fs from "node:fs/promises";
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
      if (fact) curr = fact.ob ?? fact;
    }
    if (curr && typeof curr === "object") {
      if (curr.ob?.map && Object.prototype.hasOwnProperty.call(curr.ob.map, part)) {
        curr = curr.ob.map[part];
      } else if (curr.ob && curr.ob[part] !== undefined) {
        curr = curr.ob[part];
      } else {
        curr = curr?.[part];
      }
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
  }
  return curr;
}

export function renderSayValue(ob = {}, { rememberFn } = {}) {
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.num === "number") return ob.num;
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  if (ob.hollow) return "null";
  if (ob.genitive) {
    const v = resolveGenitive(ob.genitive, { rememberFn });
    if (v !== undefined) return v;
  }
  if (ob.name && rememberFn) {
    const fact = rememberFn(ob.name);
    if (fact?.ob?.text !== undefined) return fact.ob.text;
    if (fact?.ob?.num !== undefined) return fact.ob.num;
    if (fact?.ob?.boolean !== undefined) return fact.ob.boolean ? "truth" : "lie";
    if (fact?.ob?.hollow) return "null";
  }
  if (ob.name) return ob.name;
  return "";
}

export async function say(sentence, { remember: rememberFn = remember } = {}) {
  const text = renderSayValue(sentence.ob ?? {}, { rememberFn });
  if (sentence?.to?.filename) {
    await fs.writeFile(sentence.to.filename, String(text ?? ""), "utf8");
  }
  // Log for REPL friendliness
  // eslint-disable-next-line no-console
  console.log(text);
  return { ob: { text }, be: "say" };
}

export default say;

export const signatures = [
  { signatureWords: ["be", "say", "ob", "text"], handler: say },
  { signatureWords: ["be", "say", "ob", "num"], handler: say },
  { signatureWords: ["be", "say", "ob", "bool"], handler: say },
  { signatureWords: ["be", "say", "ob", "hollow"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "text"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "num"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "bool"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "hollow"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "num"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "text"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "bool"], handler: say },
  { signatureWords: ["be", "say", "ob", "vec"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "text"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "num"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "bool"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "hollow"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "text"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "num"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "bool"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "hollow"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "num"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "text"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "bool"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "vec"], handler: say },
  { signatureWords: ["be", "say", "ob", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "name", "vec", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "ob", "vec", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "text", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "num", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "bool", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "hollow", "to", "filename"], handler: say },
  { signatureWords: ["be", "say", "become", "text", "ob", "name", "vec", "to", "filename"], handler: say }
];
