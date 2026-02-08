import { remember } from "../remember/index.mjs";

function resolveInputText(ob, { rememberFn = remember } = {}) {
  if (!ob || typeof ob !== "object") return "";
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.name === "string") {
    const fact = rememberFn(ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
    if (typeof fact?.ob?.num === "number") return String(fact.ob.num);
  }
  return "";
}

export function lineTail(sentence, { remember: rememberFn = remember } = {}) {
  const input = resolveInputText(sentence?.ob, { rememberFn });
  const count = Math.max(1, Math.trunc(Number(sentence?.atmost?.num ?? 1)));
  const lines = String(input)
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-count).join("\n");
  return { ob: { text: tail }, be: "text" };
}

export const signatures = [
  { signatureWords: ["be", "line", "tail", "ob", "text"], handler: lineTail },
  { signatureWords: ["be", "line", "tail", "ob", "name", "text"], handler: lineTail },
  { signatureWords: ["be", "line", "tail", "atmost", "num", "ob", "text"], handler: lineTail },
  { signatureWords: ["be", "line", "tail", "atmost", "num", "ob", "name", "text"], handler: lineTail },
  { signatureWords: ["be", "line", "tail", "atmost", "num", "ob", "text", "to", "name", "text"], handler: lineTail },
  { signatureWords: ["be", "line", "tail", "atmost", "num", "ob", "name", "text", "to", "name", "text"], handler: lineTail }
];

export default lineTail;
