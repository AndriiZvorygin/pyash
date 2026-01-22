import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { doRemember } from "../remember/index.mjs";

function resolveValue(ob, { rememberFn } = {}) {
  if (!ob) return null;
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.num === "number") return String(ob.num);
  if (typeof ob.boolean === "boolean") return ob.boolean ? "truth" : "lie";
  if (ob.hollow) return "";
  if (ob.name && rememberFn) {
    const fact = rememberFn(ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.num === "number") return String(fact.ob.num);
    if (typeof fact?.ob?.boolean === "boolean") return fact.ob.boolean ? "truth" : "lie";
  }
  return null;
}

function envMap() {
  const entries = Object.entries(process.env).sort((a, b) => a[0].localeCompare(b[0]));
  const map = {};
  for (const [key, value] of entries) {
    map[key] = { text: String(value ?? "") };
  }
  return map;
}

export async function ecology(sentence, { remember: rememberFn = remember } = {}) {
  const key = sentence?.su?.name;
  const hasValue = sentence?.ob !== undefined;
  if (!key && !hasValue) {
    const mapName = "ecology env";
    const map = envMap();
    doRemember({ mood: "ya", su: { name: mapName }, be: "map", ob: { map } });
    return { mood: "ya", su: { name: "ecology" }, be: "ecology", ob: { name: mapName } };
  }

  if (!key) {
    throwErrorSentence({
      name: "ecology target missing",
      message: "ecology target missing",
      from: { name: "ecology" },
      raw: { sentence }
    });
  }

  if (hasValue) {
    const value = resolveValue(sentence.ob, { rememberFn });
    if (value === null) {
      throwErrorSentence({
        name: "ecology value missing",
        message: "ecology value missing",
        from: { name: "ecology" },
        raw: { sentence }
      });
    }
    process.env[key] = value;
  }
  const current = process.env[key];
  if (current === undefined) {
    return { mood: "ya", su: { name: key }, be: "ecology", ob: { hollow: true } };
  }
  return { mood: "ya", su: { name: key }, be: "ecology", ob: { text: String(current) } };
}

export default ecology;

export const signatures = [
  { signatureWords: ["be", "ecology"], handler: ecology },
  { signatureWords: ["be", "ecology", "ob", "text"], handler: ecology },
  { signatureWords: ["be", "ecology", "ob", "name", "text"], handler: ecology },
  { signatureWords: ["be", "ecology", "ob", "num"], handler: ecology },
  { signatureWords: ["be", "ecology", "ob", "name", "num"], handler: ecology },
  { signatureWords: ["be", "ecology", "ob", "bool"], handler: ecology },
  { signatureWords: ["be", "ecology", "ob", "name", "bool"], handler: ecology }
];
