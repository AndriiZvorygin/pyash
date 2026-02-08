import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";

function normalizeDecision(value) {
  if (typeof value === "boolean") return value ? "truth" : "lie";
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "truth" || text === "true" || text === "yes" || text === "allow") return "truth";
  if (text === "lie" || text === "false" || text === "no" || text === "deny") return "lie";
  return null;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function decisionFromSentence(sentence) {
  if (!sentence || sentence.mood !== "ya") return null;
  if (!sentence?.su?.name) return null;
  const key = normalizeKey(sentence.su.name);
  if (!key) return null;
  const decision = normalizeDecision(
    sentence?.ob?.boolean ??
    sentence?.ob?.text ??
    sentence?.ob?.name
  );
  if (!decision) return null;
  const raw = sentence?.ob?.text ?? sentence?.ob?.name ?? decision;
  return { key, decision, raw: String(raw ?? decision) };
}

async function readPolicyEntries(policyPath) {
  let text = "";
  try {
    text = await fs.readFile(policyPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const lines = splitSentences(text, { includeThen: true });
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let sentence = null;
    try {
      sentence = parse(trimmed);
    } catch {
      continue;
    }
    const decision = decisionFromSentence(sentence);
    if (decision) out.push(decision);
  }
  return out;
}

function resolveWorldRoot(rememberFn) {
  const worldRoot = rememberFn?.("world root")?.ob?.filename ?? "world";
  return path.isAbsolute(worldRoot) ? worldRoot : path.resolve(worldRoot);
}

export async function resolveRatifyDecision({
  mindName,
  toolName,
  toolSignature,
  subjectName,
  rememberFn
} = {}) {
  if (!mindName || typeof rememberFn !== "function") return null;
  const worldRoot = resolveWorldRoot(rememberFn);
  const policyPath = path.join(worldRoot, "house", String(mindName), "conduct", "ratify.pya");
  const entries = await readPolicyEntries(policyPath);
  if (!entries.length) return null;
  const index = new Map(entries.map(entry => [entry.key, entry]));
  const keys = [
    normalizeKey(subjectName),
    normalizeKey(toolName),
    normalizeKey(toolSignature),
    "default"
  ].filter(Boolean);
  for (const key of keys) {
    const hit = index.get(key);
    if (!hit) continue;
    return {
      decision: hit.decision,
      raw: hit.raw,
      matchedKey: key,
      policyPath
    };
  }
  return null;
}

