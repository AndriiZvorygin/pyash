import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";

function textValue(sentence) {
  const value =
    sentence?.ob?.name ??
    sentence?.ob?.text ??
    sentence?.ob?.wo ??
    sentence?.ob?.filename ??
    "";
  return String(value ?? "").trim();
}

function normalizeKey(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAction(value) {
  return String(value ?? "").trim();
}

function emptyPolicy() {
  return {
    defaultAction: "",
    fileAction: "",
    photographAction: "",
    documentationAction: "",
    audioAction: "",
    textAction: "",
    readToolGuidance: "",
    seeToolGuidance: "",
    commandToolGuidance: "",
    repairToolGuidance: ""
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
        applyEntry(policy, inlineSentence.su.name, textValue(inlineSentence));
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
          applyEntry(policy, pendingMapKey, textValue(sentence));
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
        applyEntry(policy, key, textValue(sentence));
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
        applyEntry(policy, pendingImportKey, textValue(sentence));
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
    applyEntry(policy, key, textValue(sentence));
  }
  return policy;
}

export function mergeImportPolicies(base = {}, override = {}) {
  return {
    defaultAction: normalizeAction(override.defaultAction) || normalizeAction(base.defaultAction),
    fileAction: normalizeAction(override.fileAction) || normalizeAction(base.fileAction),
    photographAction: normalizeAction(override.photographAction) || normalizeAction(base.photographAction),
    documentationAction: normalizeAction(override.documentationAction) || normalizeAction(base.documentationAction),
    audioAction: normalizeAction(override.audioAction) || normalizeAction(base.audioAction),
    textAction: normalizeAction(override.textAction) || normalizeAction(base.textAction),
    readToolGuidance: normalizeAction(override.readToolGuidance) || normalizeAction(base.readToolGuidance),
    seeToolGuidance: normalizeAction(override.seeToolGuidance) || normalizeAction(base.seeToolGuidance),
    commandToolGuidance: normalizeAction(override.commandToolGuidance) || normalizeAction(base.commandToolGuidance),
    repairToolGuidance: normalizeAction(override.repairToolGuidance) || normalizeAction(base.repairToolGuidance)
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
