import path from "node:path";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { schedulerStop, schedulerServiceStop } from "../agent/scheduler_control.mjs";
import { stopAgent } from "../agent/admin.mjs";

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

function resolveStopType(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.name ?? sentence?.as?.text ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text || null;
}

function isSchedulerTarget(targetName, stopType) {
  if (stopType === "scheduler") return true;
  const text = String(targetName ?? "").trim().toLowerCase();
  return text === "scheduler" || text === "scheduler daemon";
}

export async function stop(sentence, { remember: rememberFn = remember } = {}) {
  const stopType = resolveStopType(sentence);
  const targetName = resolveTargetName(sentence, { rememberFn });
  const calendarScope = isCalendarScope(sentence);
  const houseScope = isHouseScope(sentence);
  if (!(calendarScope || houseScope || isSchedulerTarget(targetName, stopType))) {
    throwErrorSentence({
      name: "stop target unknown",
      message: "stop target unknown",
      from: { name: "stop" },
      raw: { targetName, stopType }
    });
  }
  if (houseScope) {
    if (!targetName) {
      throwErrorSentence({
        name: "stop target missing",
        message: "stop target missing",
        from: { name: "stop" },
        raw: { sentence }
      });
    }
    const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
    const result = await stopAgent({ worldRoot, agentName: targetName });
    return {
      mood: "ya",
      be: "stop",
      from: { name: String(targetName ?? "") },
      ob: { boolean: Array.isArray(result?.disabledServices) }
    };
  }
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
  if (calendarScope && targetName && !isSchedulerTarget(targetName, stopType)) {
    const result = await schedulerServiceStop({ worldRoot, serviceName: targetName });
    return {
      mood: "ya",
      be: "stop",
      from: { name: String(targetName ?? "") },
      ob: { boolean: result?.enabled !== true }
    };
  }
  const result = await schedulerStop({ worldRoot });
  return {
    mood: "ya",
    be: "stop",
    from: { name: "scheduler" },
    ob: { boolean: result?.running !== true }
  };
}

export default stop;

export const signatures = [
  { signatureWords: ["be", "stop", "ob", "text"], handler: stop },
  { signatureWords: ["be", "stop", "ob", "name", "num"], handler: stop },
  { signatureWords: ["be", "stop", "ob", "name", "map"], handler: stop },
  { signatureWords: ["be", "stop", "as", "wo", "scheduler"], handler: stop },
  { signatureWords: ["be", "stop", "as", "wo", "ob", "text"], handler: stop },
  { signatureWords: ["be", "stop", "as", "wo", "ob", "name", "num"], handler: stop },
  { signatureWords: ["be", "stop", "as", "wo", "ob", "name", "map"], handler: stop },
  { signatureWords: ["be", "stop", "as", "wo", "scheduler", "ob", "text"], handler: stop },
  { signatureWords: ["be", "stop", "as", "wo", "scheduler", "ob", "name", "num"], handler: stop },
  { signatureWords: ["be", "stop", "as", "wo", "scheduler", "ob", "name", "map"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "calendar"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "house"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "calendar", "ob", "text"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "calendar", "ob", "name", "num"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "calendar", "ob", "name", "map"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "house", "ob", "text"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "house", "ob", "name", "num"], handler: stop },
  { signatureWords: ["be", "stop", "from", "wo", "house", "ob", "name", "map"], handler: stop }
];
