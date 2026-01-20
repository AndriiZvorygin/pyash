import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { closeMcpServer } from "../motor/mcp.mjs";

function resolveTargetName(sentence, { rememberFn }) {
  const ob = sentence?.ob ?? {};
  if (typeof ob.name === "string" && ob.name.trim()) return ob.name.trim();
  if (typeof ob.text === "string" && ob.text.trim()) return ob.text.trim();
  const raw = renderSayValue(ob, { rememberFn });
  const text = String(raw ?? "").trim();
  return text || null;
}

function resolveDischargeType(sentence) {
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

export async function discharge(sentence, { remember: rememberFn = remember } = {}) {
  const targetName = resolveTargetName(sentence, { rememberFn });
  if (!targetName) {
    throwErrorSentence({
      name: "discharge target missing",
      message: "discharge target missing",
      from: { name: "discharge" },
      raw: { sentence }
    });
  }
  const dischargeType = resolveDischargeType(sentence);
  if (dischargeType && dischargeType !== "mcp") {
    throwErrorSentence({
      name: "discharge target defective",
      message: `discharge target defective: ${dischargeType}`,
      from: { name: "discharge" },
      raw: { sentence }
    });
  }
  const mcpName = resolveMcpServerName(targetName, { rememberFn, explicitMcp: dischargeType === "mcp" });
  if (mcpName) {
    closeMcpServer(mcpName);
    return {
      mood: "ya",
      be: "discharge",
      ob: { name: mcpName },
      from: { name: "mcp" }
    };
  }
  throwErrorSentence({
    name: "discharge target unknown",
    message: "discharge target unknown",
    from: { name: "discharge" },
    raw: { targetName }
  });
}

export default discharge;

export const signatures = [
  { signatureWords: ["be", "discharge", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "ob", "name", "map"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "name", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "name", "map"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "name", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "name", "map"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "name", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "name", "map"], handler: discharge }
];
