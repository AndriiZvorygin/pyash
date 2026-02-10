import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { improveAgent } from "../agent/admin.mjs";

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

function resolveImprovePayload(sentence) {
  const text = sentence?.ob?.text;
  if (typeof text !== "string") return { purpose: "", note: "" };
  const trimmed = text.trim();
  return {
    purpose: "",
    note: trimmed
  };
}

export async function improve(sentence, { remember: rememberFn = remember } = {}) {
  if (!isHouseScope(sentence)) {
    throwErrorSentence({
      name: "improve scope defective",
      message: "improve scope defective",
      from: { name: "improve" },
      raw: { sentence }
    });
  }
  const agentName = resolveAgentName(sentence, { rememberFn });
  if (!agentName) {
    throwErrorSentence({
      name: "improve target missing",
      message: "improve target missing",
      from: { name: "improve" },
      raw: { sentence }
    });
  }
  const payload = resolveImprovePayload(sentence);
  if (!payload.purpose && !payload.note) {
    throwErrorSentence({
      name: "improve note missing",
      message: "improve note missing",
      from: { name: "improve" },
      raw: { sentence }
    });
  }
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
  const result = await improveAgent({
    worldRoot,
    agentName,
    purpose: payload.purpose,
    note: payload.note
  });
  return {
    mood: "ya",
    be: "improve",
    from: { name: agentName },
    ob: { boolean: result?.changed === true }
  };
}

export default improve;

export const signatures = [
  { signatureWords: ["be", "improve", "ob", "text"], handler: improve },
  { signatureWords: ["be", "improve", "from", "wo", "house", "ob", "text"], handler: improve },
  { signatureWords: ["be", "improve", "from", "wo", "house"], handler: improve }
];
