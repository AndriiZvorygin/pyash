import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { ensureMcpServer, closeMcpServer } from "../motor/mcp.mjs";

function resolveTargetName(sentence, { rememberFn }) {
  const ob = sentence?.ob ?? {};
  if (typeof ob.name === "string" && ob.name.trim()) return ob.name.trim();
  if (typeof ob.text === "string" && ob.text.trim()) return ob.text.trim();
  const raw = renderSayValue(ob, { rememberFn });
  const text = String(raw ?? "").trim();
  return text || null;
}

function resolveRestartType(sentence) {
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
  if (fact?.su?.name && String(fact.su.name).startsWith("mcp ")) {
    return String(fact.su.name).slice(4).trim();
  }
  return null;
}

export async function restart(sentence, { remember: rememberFn = remember } = {}) {
  const targetName = resolveTargetName(sentence, { rememberFn });
  if (!targetName) {
    throwErrorSentence({
      name: "restart target missing",
      message: "restart target missing",
      from: { name: "restart" },
      raw: { sentence }
    });
  }
  const restartType = resolveRestartType(sentence);
  if (restartType && restartType !== "mcp") {
    throwErrorSentence({
      name: "restart target defective",
      message: `restart target defective: ${restartType}`,
      from: { name: "restart" },
      raw: { sentence }
    });
  }
  const mcpName = resolveMcpServerName(targetName, { rememberFn, explicitMcp: restartType === "mcp" });
  if (mcpName) {
    closeMcpServer(mcpName);
    await ensureMcpServer(mcpName, { rememberFn, source: "restart" });
    return {
      mood: "ya",
      be: "restart",
      ob: { name: mcpName },
      from: { name: "mcp" }
    };
  }
  throwErrorSentence({
    name: "restart target unknown",
    message: "restart target unknown",
    from: { name: "restart" },
    raw: { targetName }
  });
}

export default restart;

export const signatures = [
  { signatureWords: ["be", "restart", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "ob", "name", "map"], handler: restart },
  { signatureWords: ["be", "restart", "as", "name", "num", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "name", "num", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "as", "name", "num", "ob", "name", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "name", "num", "ob", "name", "map"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "ob", "name", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "ob", "name", "map"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "name", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "name", "map"], handler: restart }
];
