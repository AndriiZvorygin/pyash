import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";

function normalizeKey(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cloneValue(value) {
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function actionFromOb(ob) {
  if (!ob || typeof ob !== "object") return null;
  if (ob.la && typeof ob.la === "object") {
    return { kind: "sentence", sentence: cloneValue(ob.la) };
  }
  const name = String(ob.name ?? "").trim();
  if (name) return { kind: "name", name };
  const text = String(ob.text ?? ob.wo ?? ob.filename ?? "").trim();
  if (text) return { kind: "text", text };
  return null;
}

function normalizeAction(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { kind: "text", text } : null;
  }
  if (typeof value !== "object") return null;
  if (value.kind === "text") {
    const text = String(value.text ?? "").trim();
    return text ? { kind: "text", text } : null;
  }
  if (value.kind === "name") {
    const name = String(value.name ?? "").trim();
    return name ? { kind: "name", name } : null;
  }
  if (value.kind === "sentence" && value.sentence && typeof value.sentence === "object") {
    return { kind: "sentence", sentence: cloneValue(value.sentence) };
  }
  return null;
}

function emptyPolicy() {
  return {
    defaultAction: null,
    fileAction: null,
    photographAction: null,
    documentationAction: null,
    audioAction: null,
    textAction: null,
    readToolGuidance: null,
    seeToolGuidance: null,
    commandToolGuidance: null,
    repairToolGuidance: null
  };
}

function keyToField(rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) return null;
  const map = new Map([
    ["default", "defaultAction"],
    ["file", "fileAction"],
    ["photograph", "photographAction"],
    ["documentation", "documentationAction"],
    ["audio", "audioAction"],
    ["text", "textAction"],
    ["read tool", "readToolGuidance"],
    ["see tool", "seeToolGuidance"],
    ["command tool", "commandToolGuidance"],
    ["repair tool", "repairToolGuidance"]
  ]);
  return map.get(key) ?? null;
}

function applyEntry(policy, rawKey, rawValue) {
  const field = keyToField(rawKey);
  if (!field) return;
  const action = normalizeAction(rawValue);
  if (!action) return;
  policy[field] = action;
}

export function parseImportPolicyText(text) {
  const policy = emptyPolicy();
  let inImportMap = false;
  let pendingMapKey = "";
  let pendingImportKey = "";
  for (const line of splitSentences(String(text ?? ""))) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    if (!inImportMap && /^su\s+name\s+import\s+be\s+map\s+def$/i.test(trimmed)) {
      inImportMap = true;
      pendingMapKey = "";
      continue;
    }
    if (inImportMap) {
      if (/^prah$/i.test(trimmed)) {
        inImportMap = false;
        pendingMapKey = "";
        continue;
      }
      let inlineSentence = null;
      try {
        inlineSentence = parse(trimmed);
      } catch {
        inlineSentence = null;
      }
      if (inlineSentence?.mood === "ya" && String(inlineSentence?.su?.name ?? "").trim()) {
        applyEntry(policy, inlineSentence.su.name, actionFromOb(inlineSentence.ob));
        pendingMapKey = "";
        continue;
      }
      if (/^su\s+name\s+/i.test(trimmed)) {
        pendingMapKey = trimmed.replace(/^su\s+name\s+/i, "").trim();
      }
      if (pendingMapKey && /^ob\s+/i.test(trimmed)) {
        let sentence = null;
        try {
          sentence = parse(trimmed);
        } catch {
          sentence = null;
        }
        if (sentence?.mood === "ya") {
          applyEntry(policy, pendingMapKey, actionFromOb(sentence.ob));
          pendingMapKey = "";
        }
      }
      continue;
    }
    if (/^su\s+name\s+import\s+/i.test(trimmed)) {
      const rest = trimmed.replace(/^su\s+name\s+import\s+/i, "").trim();
      pendingImportKey = rest;
      let sentence = null;
      try {
        sentence = parse(trimmed);
      } catch {
        sentence = null;
      }
      if (sentence?.mood === "ya") {
        const subject = normalizeKey(sentence?.su?.name);
        const key = subject.startsWith("import ") ? subject.slice("import ".length).trim() : rest;
        applyEntry(policy, key, actionFromOb(sentence.ob));
        pendingImportKey = "";
      }
      continue;
    }
    if (pendingImportKey && /^ob\s+/i.test(trimmed)) {
      let sentence = null;
      try {
        sentence = parse(trimmed);
      } catch {
        sentence = null;
      }
      if (sentence?.mood === "ya") {
        applyEntry(policy, pendingImportKey, actionFromOb(sentence.ob));
        pendingImportKey = "";
      }
      continue;
    }

    let sentence = null;
    try {
      sentence = parse(trimmed);
    } catch {
      continue;
    }
    if (!sentence) continue;
    if (sentence.mood !== "ya") continue;
    const subject = normalizeKey(sentence?.su?.name);
    if (!subject.startsWith("import ")) continue;
    const key = subject.slice("import ".length).trim();
    applyEntry(policy, key, actionFromOb(sentence.ob));
  }
  return policy;
}

export function mergeImportPolicies(base = {}, override = {}) {
  const mergedAction = (baseValue, overrideValue) => normalizeAction(overrideValue) || normalizeAction(baseValue);
  return {
    defaultAction: mergedAction(base.defaultAction, override.defaultAction),
    fileAction: mergedAction(base.fileAction, override.fileAction),
    photographAction: mergedAction(base.photographAction, override.photographAction),
    documentationAction: mergedAction(base.documentationAction, override.documentationAction),
    audioAction: mergedAction(base.audioAction, override.audioAction),
    textAction: mergedAction(base.textAction, override.textAction),
    readToolGuidance: mergedAction(base.readToolGuidance, override.readToolGuidance),
    seeToolGuidance: mergedAction(base.seeToolGuidance, override.seeToolGuidance),
    commandToolGuidance: mergedAction(base.commandToolGuidance, override.commandToolGuidance),
    repairToolGuidance: mergedAction(base.repairToolGuidance, override.repairToolGuidance)
  };
}

export async function loadImportPolicyFromPath(filePath) {
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return emptyPolicy();
    throw err;
  }
  return parseImportPolicyText(text);
}

export async function loadImportPolicyWithGlobal({
  worldRoot,
  agentHouse
} = {}) {
  const globalPath = worldRoot ? path.join(worldRoot, "conduct", "import.pya") : null;
  const agentPath = agentHouse ? path.join(agentHouse, "conduct", "import.pya") : null;
  const [globalPolicy, agentPolicy] = await Promise.all([
    globalPath ? loadImportPolicyFromPath(globalPath) : Promise.resolve(emptyPolicy()),
    agentPath ? loadImportPolicyFromPath(agentPath) : Promise.resolve(emptyPolicy())
  ]);
  return mergeImportPolicies(globalPolicy, agentPolicy);
}
