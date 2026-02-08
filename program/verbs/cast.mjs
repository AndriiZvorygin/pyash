import { remember } from "../remember/index.mjs";

function resolveInputText(ob, { rememberFn = remember } = {}) {
  if (!ob || typeof ob !== "object") return "";
  if (typeof ob.text === "string") return ob.text;
  if (typeof ob.num === "number") return String(ob.num);
  if (typeof ob.name === "string") {
    const fact = rememberFn(ob.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
    if (typeof fact?.ob?.num === "number") return String(fact.ob.num);
  }
  return "";
}

function parseFirstNumber(text) {
  const match = String(text ?? "").match(/[-+]?(?:\d+\.?\d*|\.\d+)/u);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cast(sentence, { remember: rememberFn = remember } = {}) {
  const targetIsNum = sentence?.become?.num !== undefined || sentence?.become?.name === "num";
  if (!targetIsNum) {
    return { ob: { hollow: true }, be: "hollow" };
  }

  const value = parseFirstNumber(resolveInputText(sentence?.ob, { rememberFn }));
  if (value === null) return { ob: { hollow: true }, be: "hollow" };

  const min = Number(sentence?.from?.num);
  const max = Number(sentence?.to?.num);
  if (Number.isFinite(min) && value < min) return { ob: { hollow: true }, be: "hollow" };
  if (Number.isFinite(max) && value > max) return { ob: { hollow: true }, be: "hollow" };
  return { ob: { num: value }, be: "number" };
}

export const signatures = [
  { signatureWords: ["be", "cast", "become", "num", "ob", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "ob", "name", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "ob", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "ob", "name", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "name", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "name", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "ob", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "ob", "name", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "ob", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "ob", "name", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "name", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "name", "text", "to", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "text", "to", "name", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "name", "text", "to", "name", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "text", "to", "name", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "name", "text", "to", "name", "num"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "text", "to", "name", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "num", "from", "num", "ob", "name", "text", "to", "name", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "text", "to", "name", "text"], handler: cast },
  { signatureWords: ["be", "cast", "become", "name", "num", "from", "num", "ob", "name", "text", "to", "name", "text"], handler: cast }
];

export default cast;
