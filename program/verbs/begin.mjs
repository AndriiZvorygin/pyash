import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { ensureMcpServer } from "../motor/mcp.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { schedulerBegin, schedulerServiceBegin } from "../agent/scheduler_control.mjs";
import path from "node:path";

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

function isSchedulerTarget(targetName, beginType) {
  if (beginType === "scheduler") return true;
  const text = String(targetName ?? "").trim().toLowerCase();
  return text === "scheduler" || text === "scheduler daemon";
}

export async function begin(sentence, { remember: rememberFn = remember } = {}) {
  const beginType = resolveBeginType(sentence);
  const targetName = resolveTargetName(sentence, { rememberFn });
  const calendarScope = isCalendarScope(sentence);
  if (!targetName && beginType !== "scheduler") {
    if (!calendarScope) {
      throwErrorSentence({
        name: "begin target missing",
        message: "begin target missing",
        from: { name: "begin" },
        raw: { sentence }
      });
    }
  }
  if (beginType && beginType !== "mcp") {
    if (beginType !== "scheduler") {
      throwErrorSentence({
        name: "begin target defective",
        message: `begin target defective: ${beginType}`,
        from: { name: "begin" },
        raw: { sentence }
      });
    }
  }
  if (calendarScope && targetName && !isSchedulerTarget(targetName, beginType)) {
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
    const result = await schedulerServiceBegin({ worldRoot, serviceName: targetName });
    return {
      mood: "ya",
      be: "begin",
      from: { name: String(targetName ?? "") },
      ob: { boolean: result?.enabled === true }
    };
  }
  if (calendarScope || isSchedulerTarget(targetName, beginType)) {
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? null;
    const result = await schedulerBegin({ worldRoot: worldRoot ?? path.resolve(process.cwd(), "world") });
    return {
      mood: "ya",
      be: "begin",
      from: { name: "scheduler" },
      ob: { boolean: result?.running === true }
    };
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
  { signatureWords: ["be", "begin", "as", "wo", "scheduler"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "scheduler", "ob", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "scheduler", "ob", "name", "num"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "scheduler", "ob", "name", "map"], handler: begin },
  { signatureWords: ["be", "begin", "from", "wo", "calendar"], handler: begin },
  { signatureWords: ["be", "begin", "from", "wo", "calendar", "ob", "text"], handler: begin },
  { signatureWords: ["be", "begin", "from", "wo", "calendar", "ob", "name", "num"], handler: begin },
  { signatureWords: ["be", "begin", "from", "wo", "calendar", "ob", "name", "map"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "name", "num"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "name", "text"], handler: begin },
  { signatureWords: ["be", "begin", "as", "wo", "mcp", "ob", "name", "map"], handler: begin }
];
