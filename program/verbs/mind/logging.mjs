import { emitExchangeSentence } from "../../bridge/exchange.mjs";

const mindDebugCounters = new Map();

function nextDebugCount(targetName) {
  const key = targetName || "mind";
  const count = (mindDebugCounters.get(key) || 0) + 1;
  mindDebugCounters.set(key, count);
  return count;
}

function toQuotedJson(text) {
  return `quoted.json.${text}.json.quoted`;
}

export function stripContext(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  if ("context" in clone) delete clone.context;
  return clone;
}

export function recordMindJson({ targetName, label, payload }) {
  const count = nextDebugCount(targetName);
  const jsonText = JSON.stringify(payload ?? null, null, 2);
  emitExchangeSentence({
    mood: "ya",
    su: { name: `${targetName || "mind"} ${label} ${count}` },
    be: "write",
    from: { name: "mind" },
    ob: { text: toQuotedJson(jsonText) }
  });
}

export function resetMindDebugCounters() {
  mindDebugCounters.clear();
}
