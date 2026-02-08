import path from "node:path";

import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";
import { resolveWorldRoot } from "../library/world.mjs";
import { schedulerHealth, schedulerServiceHealth } from "../agent/scheduler_control.mjs";

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

function resolveHealthType(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.name ?? sentence?.as?.text ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text || null;
}

function targetsScheduler(targetName, healthType) {
  if (!targetName) return true;
  if (healthType === "scheduler") return true;
  const text = String(targetName ?? "").trim().toLowerCase();
  return text === "scheduler" || text === "scheduler daemon";
}

export async function health(sentence, { remember: rememberFn = remember } = {}) {
  const healthType = resolveHealthType(sentence);
  const targetName = resolveTargetName(sentence, { rememberFn });
  const calendarScope = isCalendarScope(sentence);
  if (!(calendarScope || targetsScheduler(targetName, healthType))) {
    return {
      mood: "ya",
      be: "health",
      ob: { boolean: false },
      from: { name: String(targetName ?? "unknown") }
    };
  }
  const worldRoot = resolveWorldRoot({ rememberFn }) ?? path.resolve(process.cwd(), "world");
  if (calendarScope && targetName && !targetsScheduler(targetName, healthType)) {
    const result = await schedulerServiceHealth({ worldRoot, serviceName: targetName });
    return {
      mood: "ya",
      be: "health",
      from: { name: String(targetName ?? "") },
      ob: { boolean: result?.running === true }
    };
  }
  const result = await schedulerHealth({ worldRoot });
  return {
    mood: "ya",
    be: "health",
    from: { name: "scheduler" },
    ob: { boolean: result?.running === true },
    as: { name: result?.pid ? Number(result.pid) : 0 }
  };
}

export default health;

export const signatures = [
  { signatureWords: ["be", "health"], handler: health },
  { signatureWords: ["be", "health", "from", "wo", "calendar"], handler: health },
  { signatureWords: ["be", "health", "probe", "from", "wo", "calendar"], handler: health },
  { signatureWords: ["be", "health", "as", "wo", "scheduler"], handler: health },
  { signatureWords: ["be", "health", "as", "wo", "scheduler", "ob", "text"], handler: health },
  { signatureWords: ["be", "health", "as", "wo", "scheduler", "ob", "name", "num"], handler: health },
  { signatureWords: ["be", "health", "as", "wo", "scheduler", "ob", "name", "map"], handler: health },
  { signatureWords: ["be", "health", "from", "wo", "calendar", "ob", "text"], handler: health },
  { signatureWords: ["be", "health", "from", "wo", "calendar", "ob", "name", "num"], handler: health },
  { signatureWords: ["be", "health", "from", "wo", "calendar", "ob", "name", "map"], handler: health },
  { signatureWords: ["be", "health", "probe", "from", "wo", "calendar", "ob", "text"], handler: health },
  { signatureWords: ["be", "health", "probe", "from", "wo", "calendar", "ob", "name", "num"], handler: health },
  { signatureWords: ["be", "health", "probe", "from", "wo", "calendar", "ob", "name", "map"], handler: health },
  { signatureWords: ["be", "health", "ob", "text"], handler: health },
  { signatureWords: ["be", "health", "ob", "name", "num"], handler: health },
  { signatureWords: ["be", "health", "ob", "name", "map"], handler: health },
  { signatureWords: ["be", "health", "as", "wo", "ob", "text"], handler: health },
  { signatureWords: ["be", "health", "as", "wo", "ob", "name", "num"], handler: health },
  { signatureWords: ["be", "health", "as", "wo", "ob", "name", "map"], handler: health }
];
