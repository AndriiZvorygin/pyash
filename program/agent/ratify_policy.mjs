import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";

export const HEADQUARTERS_ACTIONS = Object.freeze([
  "send",
  "delete",
  "purchase",
  "publish",
  "calendar-mutation"
]);

const HEADQUARTERS_ACTION_SET = new Set(HEADQUARTERS_ACTIONS);

function normalizeDecision(value) {
  if (typeof value === "boolean") return value ? "truth" : "lie";
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "truth" || text === "true" || text === "yes" || text === "allow") return "truth";
  if (text === "lie" || text === "false" || text === "no" || text === "deny") return "lie";
  if (text === "ask" || text === "pending") return "ask";
  return null;
}

function modeForDecision(decision) {
  if (decision === "truth") return "allow";
  if (decision === "lie") return "deny";
  if (decision === "ask") return "ask";
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
  return {
    key,
    decision,
    mode: modeForDecision(decision),
    raw: String(raw ?? decision)
  };
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

function normalizeAction(value) {
  const action = String(value ?? "").trim().toLowerCase();
  return HEADQUARTERS_ACTION_SET.has(action) ? action : "";
}

function isHeadquartersRequest(options = {}) {
  return options.headquarters === true
    || options.headquartersWork === true
    || options.isHeadquarters === true
    || String(options.caller ?? options.workKind ?? "").trim().toLowerCase() === "headquarters";
}

function resolvedEntry(hit, { policyPath, matchedKey } = {}) {
  return {
    decision: hit.decision,
    mode: hit.mode,
    raw: hit.raw,
    matchedKey,
    policyPath
  };
}

export function normalizeRatifyAction(value) {
  return normalizeAction(value);
}

export async function resolveRatifyDecision({
  mindName,
  toolName,
  toolSignature,
  subjectName,
  action,
  actionName,
  headquarters = false,
  headquartersWork = false,
  isHeadquarters = false,
  caller = "",
  workKind = "",
  rememberFn
} = {}) {
  if (!mindName || typeof rememberFn !== "function") return null;
  const worldRoot = resolveWorldRoot(rememberFn);
  const policyPath = path.join(worldRoot, "house", String(mindName), "conduct", "ratify.pya");
  const entries = await readPolicyEntries(policyPath);
  const index = new Map(entries.map(entry => [entry.key, entry]));
  const canonicalAction = normalizeAction(action ?? actionName);
  if ((action !== undefined || actionName !== undefined)
    && String(action ?? actionName ?? "").trim()
    && !canonicalAction) {
    throw new Error(`ratify action defective: unsupported action ${String(action ?? actionName).trim()}`);
  }
  const actionKey = canonicalAction ? `action ${canonicalAction}` : "";
  const keys = [
    actionKey,
    normalizeKey(subjectName),
    normalizeKey(toolName),
    normalizeKey(toolSignature),
    "default"
  ].filter(Boolean);
  for (const key of keys) {
    const hit = index.get(key);
    if (!hit) continue;
    return resolvedEntry(hit, { policyPath, matchedKey: key });
  }
  if (canonicalAction && isHeadquartersRequest({
    headquarters,
    headquartersWork,
    isHeadquarters,
    caller,
    workKind
  })) {
    return {
      decision: "ask",
      mode: "ask",
      raw: "unanswered",
      matchedKey: null,
      policyPath
    };
  }
  return null;
}
