import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { ensureMcpServer } from "../motor/mcp.mjs";

function resolveTargetName(sentence, { rememberFn }) {
  const ob = sentence?.ob ?? {};
  if (typeof ob.name === "string" && ob.name.trim()) return ob.name.trim();
  if (typeof ob.text === "string" && ob.text.trim()) return ob.text.trim();
  const raw = renderSayValue(ob, { rememberFn });
  const text = String(raw ?? "").trim();
  return text || null;
}

function resolveBeginType(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.name ?? sentence?.as?.text ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text || null;
}

function resolveMcpServerName(targetName, { rememberFn, explicitMcp }) {
  if (!targetName) return null;
  const trimmed = String(targetName).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("mcp ")) return trimmed.slice(4).trim();
  if (explicitMcp) return trimmed;
  if (rememberFn && rememberFn(`mcp ${trimmed}`)) return trimmed;
  const fact = rememberFn ? rememberFn(trimmed) : null;
  if (fact?.be === "mcp") return trimmed;
  if (fact?.su?.name && String(fact.su.name).startsWith("mcp ")) {
    return String(fact.su.name).slice(4).trim();
  }
  return null;
}

export async function begin(sentence, { remember: rememberFn = remember } = {}) {
  const targetName = resolveTargetName(sentence, { rememberFn });
  if (!targetName) {
    throwErrorSentence({
      name: "begin target missing",
      message: "begin target missing",
      from: { name: "begin" },
      raw: { sentence }
    });
  }
  const beginType = resolveBeginType(sentence);
  if (beginType && beginType !== "mcp") {
    throwErrorSentence({
      name: "begin target defective",
      message: `begin target defective: ${beginType}`,
      from: { name: "begin" },
      raw: { sentence }
    });
  }
  const mcpName = resolveMcpServerName(targetName, { rememberFn, explicitMcp: beginType === "mcp" });
  if (mcpName) {
    await ensureMcpServer(mcpName, { rememberFn, source: "begin" });
    return {
      mood: "ya",
      be: "begin",
      ob: { name: mcpName },
      from: { name: "mcp" }
    };
  }
  throwErrorSentence({
    name: "begin target unknown",
    message: "begin target unknown",
    from: { name: "begin" },
    raw: { targetName }
  });
}

export default begin;

export const signatures = [
  { signatureWords: ["be", "begin", "ob", "text"], handler: begin },
  { signatureWords: ["be", "begin", "ob", "name", "num"], handler: begin },
  { signatureWords: ["be", "begin", "ob", "name", "map"], handler: begin },
  { signatureWords: ["be", "begin", "as", "name", "num", "ob", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "name", "num", "ob", "name", "num"], handler: begin },
  { signatureWords: ["be", "begin", "as", "name", "num", "ob", "name", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "name", "num", "ob", "name", "map"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "ob", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "ob", "name", "num"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "ob", "name", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "ob", "name", "map"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "name", "num"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "name", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "name", "map"], handler: begin }
];
