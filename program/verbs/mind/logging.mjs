import { emitExchangeSentence } from "../../bridge/exchange.mjs";
import { jsonToMapSentences } from "../exchange/json_map.mjs";

const mindDebugCounters = new Map();

function nextDebugCount(targetName) {
  const key = targetName || "mind";
  const count = (mindDebugCounters.get(key) || 0) + 1;
  mindDebugCounters.set(key, count);
  return count;
}

function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

function mapSentenceToDefChain(sentence) {
  const name = sentence?.su?.name ?? "map";
  const entries = sentence?.ob?.map ?? {};
  const keys = Object.keys(entries).sort(compareUtf8);
  const lines = [{ mood: "def", su: { name }, be: "json map" }];
  for (const key of keys) {
    lines.push({ mood: "ya", su: { name: key }, ob: entries[key] ?? {} });
  }
  lines.push({ mood: "prah", su: { name } });
  return lines;
}

export function stripContext(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  if ("context" in clone) delete clone.context;
  return clone;
}

export function recordMindJson({ targetName, label, payload }) {
  const count = nextDebugCount(targetName);
  const baseName = `${targetName || "mind"} ${label} ${count}`;
  const jsonValue = payload ?? {};
  const { sentences } = jsonToMapSentences(jsonValue, baseName);
  for (const sentence of sentences) {
    const chain = mapSentenceToDefChain(sentence);
    for (const entry of chain) emitExchangeSentence(entry);
  }
}

export function resetMindDebugCounters() {
  mindDebugCounters.clear();
}
