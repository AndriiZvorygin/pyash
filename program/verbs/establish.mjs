import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { establishAgent } from "../agent/admin.mjs";

function isHouseScope(sentence) {
  if (!sentence?.from) return true;
  const raw = sentence?.from?.wo ?? sentence?.from?.text ?? sentence?.from?.name ?? "";
  return String(raw ?? "").trim().toLowerCase() === "house";
}

function resolveAgentName(sentence, { rememberFn }) {
  if (typeof sentence?.su?.name === "string" && sentence.su.name.trim()) return sentence.su.name.trim();
  const ob = sentence?.ob ?? {};
  if (typeof ob.name === "string" && ob.name.trim()) return ob.name.trim();
  const rendered = renderSayValue(ob, { rememberFn });
  const text = String(rendered ?? "").trim();
  return text || null;
}

function resolvePurpose(sentence) {
  const text = sentence?.ob?.text;
  if (typeof text !== "string") return "";
  return text.trim();
}

export async function establish(sentence, { remember: rememberFn = remember } = {}) {
  if (!isHouseScope(sentence)) {
    throwErrorSentence({
      name: "establish scope defective",
      message: "establish scope defective",
      from: { name: "establish" },
      raw: { sentence }
    });
  }
  const agentName = resolveAgentName(sentence, { rememberFn });
  if (!agentName) {
    throwErrorSentence({
      name: "establish target missing",
      message: "establish target missing",
      from: { name: "establish" },
      raw: { sentence }
    });
  }
  const purpose = resolvePurpose(sentence);
  if (!purpose) {
    throwErrorSentence({
      name: "establish purpose missing",
      message: "establish purpose missing",
      from: { name: "establish" },
      raw: { sentence }
    });
  }
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
  await establishAgent({ worldRoot, agentName, purpose });
  return {
    mood: "ya",
    be: "establish",
    from: { name: agentName },
    ob: { boolean: true }
  };
}

export default establish;

export const signatures = [
  { signatureWords: ["be", "establish", "ob", "text"], handler: establish },
  { signatureWords: ["be", "establish", "from", "wo", "house", "ob", "text"], handler: establish },
  { signatureWords: ["be", "establish", "from", "wo", "house"], handler: establish }
];
