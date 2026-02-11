import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { sentenceToPyash } from "../beautiful.mjs";

function nowIso() {
  return new Date().toISOString();
}

function dayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function resolveWorldRoot({ rememberFn } = {}) {
  const fromFact = rememberFn?.("world root")?.ob?.filename;
  if (fromFact) return path.resolve(String(fromFact));
  return path.resolve("world");
}

function resolveAgentName({ rememberFn, generatorName } = {}) {
  const worldAgent = rememberFn?.("world agent")?.ob?.text;
  if (worldAgent) return String(worldAgent).trim();
  const agentName = rememberFn?.("agent name")?.ob?.text;
  if (agentName) return String(agentName).trim();
  return "varied";
}

function sanitizeSegment(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const cleaned = text
    .replace(/[\/\\]/gu, "_")
    .replace(/\.+/gu, ".")
    .replace(/^\.+$/u, "")
    .trim();
  return cleaned || fallback;
}

function resolvePlatformName(generatorName) {
  return sanitizeSegment(generatorName, "unknown");
}

function stableText(value) {
  return String(value ?? "");
}

function buildGoldKey({ label, task, draft, review, guarantee, generatorName }) {
  const payload = JSON.stringify({
    label: stableText(label),
    task: stableText(task),
    draft: stableText(draft),
    review: stableText(review),
    guarantee: stableText(guarantee),
    generatorName: stableText(generatorName)
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function buildGoldLines({ label, task, draft, review, guarantee, key, generatorName }) {
  const ts = nowIso();
  const lines = [];
  lines.push(sentenceToPyash({
    mood: "def",
    su: { name: `gold ${key.slice(0, 12)}` },
    be: "series",
    since: { date: ts }
  }));
  lines.push(sentenceToPyash({ mood: "ya", su: { name: "gold key" }, ob: { text: key }, during: { date: ts } }));
  lines.push(sentenceToPyash({ mood: "ya", su: { name: "gold label" }, ob: { text: stableText(label) }, during: { date: ts } }));
  lines.push(sentenceToPyash({ mood: "ya", su: { name: "gold generator" }, ob: { text: stableText(generatorName) }, during: { date: ts } }));
  lines.push(sentenceToPyash({ mood: "ya", su: { name: "gold task" }, ob: { text: stableText(task) }, during: { date: ts } }));
  lines.push(sentenceToPyash({ mood: "ya", su: { name: "gold draft" }, ob: { text: stableText(draft) }, during: { date: ts } }));
  lines.push(sentenceToPyash({ mood: "ya", su: { name: "gold review" }, ob: { text: stableText(review) }, during: { date: ts } }));
  lines.push(sentenceToPyash({ mood: "ya", su: { name: "gold guarantee" }, ob: { text: stableText(guarantee) }, during: { date: ts } }));
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export async function emitSessionGold({
  rememberFn,
  generatorName,
  label,
  task,
  draft,
  review,
  guarantee
} = {}) {
  const worldRoot = resolveWorldRoot({ rememberFn });
  const agent = resolveAgentName({ rememberFn, generatorName });
  const platform = resolvePlatformName(generatorName);
  const bucket = label === "gold_positive" ? "accepted" : "rejected";
  const key = buildGoldKey({ label, task, draft, review, guarantee, generatorName: platform });
  const dir = path.join(worldRoot, "house", sanitizeSegment(agent, "varied"), "gold", bucket, platform);
  const file = path.join(dir, `${dayCompact()}-${key.slice(0, 12)}.pya`);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(file);
    return { key, file, existed: true };
  } catch {}
  const text = buildGoldLines({ label, task, draft, review, guarantee, key, generatorName: platform });
  await fs.writeFile(file, text, "utf8");
  return { key, file, existed: false };
}
