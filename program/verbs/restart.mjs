import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { ensureMcpServer, closeMcpServer } from "../motor/mcp.mjs";
import path from "node:path";
import { resolveWorldRoot } from "../library/world.mjs";
import { schedulerRestart, schedulerServiceRestart } from "../agent/scheduler_control.mjs";
import { restartAgent } from "../agent/admin.mjs";
import { restartDrawBackend } from "../motor/draw_admin.mjs";

function resolveTargetName(sentence, { rememberFn }) {
  if (typeof sentence?.su?.name === "string" && sentence.su.name.trim()) return sentence.su.name.trim();
  const ob = sentence?.ob ?? {};
  if (typeof ob.name === "string" && ob.name.trim()) return ob.name.trim();
  if (typeof ob.text === "string" && ob.text.trim()) return ob.text.trim();
  const raw = renderSayValue(ob, { rememberFn });
  const text = String(raw ?? "").trim();
  return text || null;
}

function isCalendarScope(sentence) {
  const raw = sentence?.from?.wo ?? sentence?.from?.text ?? sentence?.from?.name ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "calendar";
}

function isHouseScope(sentence) {
  const raw = sentence?.from?.wo ?? sentence?.from?.text ?? sentence?.from?.name ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "house";
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
  if (fact?.be === "mcp") return trimmed;
  if (fact?.su?.name && String(fact.su.name).startsWith("mcp ")) {
    return String(fact.su.name).slice(4).trim();
  }
  return null;
}

function isSchedulerTarget(targetName, restartType) {
  if (restartType === "scheduler") return true;
  const text = String(targetName ?? "").trim().toLowerCase();
  return text === "scheduler" || text === "scheduler daemon";
}

export async function restart(sentence, { remember: rememberFn = remember } = {}) {
  const restartType = resolveRestartType(sentence);
  if (restartType === "draw") {
    await restartDrawBackend({ rememberFn });
    return {
      mood: "ya",
      be: "restart",
      from: { name: "draw" },
      ob: { boolean: true },
      by: { num: 3 }
    };
  }
  const targetName = resolveTargetName(sentence, { rememberFn });
  const calendarScope = isCalendarScope(sentence);
  const houseScope = isHouseScope(sentence);
  if (!targetName && restartType !== "scheduler") {
    if (!calendarScope) {
      throwErrorSentence({
        name: "restart target missing",
        message: "restart target missing",
        from: { name: "restart" },
        raw: { sentence }
      });
    }
  }
  if (restartType && restartType !== "mcp") {
    if (restartType !== "scheduler") {
      throwErrorSentence({
        name: "restart target defective",
        message: `restart target defective: ${restartType}`,
        from: { name: "restart" },
        raw: { sentence }
      });
    }
  }
  if (houseScope) {
    if (!targetName) {
      throwErrorSentence({
        name: "restart target missing",
        message: "restart target missing",
        from: { name: "restart" },
        raw: { sentence }
      });
    }
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
    const result = await restartAgent({ worldRoot, agentName: targetName, startScheduler: false });
    return {
      mood: "ya",
      be: "restart",
      from: { name: String(targetName ?? "") },
      ob: { boolean: Array.isArray(result?.enabledServices) }
    };
  }
  if (calendarScope && targetName && !isSchedulerTarget(targetName, restartType)) {
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
    const result = await schedulerServiceRestart({ worldRoot, serviceName: targetName });
    return {
      mood: "ya",
      be: "restart",
      from: { name: String(targetName ?? "") },
      ob: { boolean: result?.enabled === true }
    };
  }
  if (calendarScope || isSchedulerTarget(targetName, restartType)) {
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
    const result = await schedulerRestart({ worldRoot });
    return {
      mood: "ya",
      be: "restart",
      from: { name: "scheduler" },
      ob: { boolean: result?.running === true }
    };
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
  { signatureWords: ["be", "restart", "as", "wo", "scheduler"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "draw"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "scheduler", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "scheduler", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "scheduler", "ob", "name", "map"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "calendar"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "house"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "calendar", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "calendar", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "calendar", "ob", "name", "map"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "house", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "house", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "from", "wo", "house", "ob", "name", "map"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "name", "num"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "name", "text"], handler: restart },
  { signatureWords: ["be", "restart", "as", "wo", "mcp", "ob", "name", "map"], handler: restart }
];
