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
    imageAction: "",
    pdfAction: "",
    audioAction: "",
    textAction: "",
    noCaptionImageAction: "",
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
    ["default do", "defaultAction"],
    ["default", "defaultAction"],
    ["file do", "fileAction"],
    ["file", "fileAction"],
    ["attachment do", "fileAction"],
    ["image do", "imageAction"],
    ["image", "imageAction"],
    ["photograph do", "imageAction"],
    ["photograph", "imageAction"],
    ["pdf do", "pdfAction"],
    ["pdf", "pdfAction"],
    ["document do", "pdfAction"],
    ["document", "pdfAction"],
    ["documentation do", "pdfAction"],
    ["documentation", "pdfAction"],
    ["audio do", "audioAction"],
    ["audio", "audioAction"],
    ["text do", "textAction"],
    ["text", "textAction"],
    ["no caption image do", "noCaptionImageAction"],
    ["image no caption do", "noCaptionImageAction"],
    ["no caption image", "noCaptionImageAction"],
    ["no legend photograph do", "noCaptionImageAction"],
    ["photograph no legend do", "noCaptionImageAction"],
    ["no legend photograph", "noCaptionImageAction"],
    ["read tool do", "readToolGuidance"],
    ["tool read do", "readToolGuidance"],
    ["see tool do", "seeToolGuidance"],
    ["tool see do", "seeToolGuidance"],
    ["command tool do", "commandToolGuidance"],
    ["tool command do", "commandToolGuidance"],
    ["repair tool do", "repairToolGuidance"],
    ["tool repair do", "repairToolGuidance"]
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
    imageAction: normalizeAction(override.imageAction) || normalizeAction(base.imageAction),
    pdfAction: normalizeAction(override.pdfAction) || normalizeAction(base.pdfAction),
    audioAction: normalizeAction(override.audioAction) || normalizeAction(base.audioAction),
    textAction: normalizeAction(override.textAction) || normalizeAction(base.textAction),
    noCaptionImageAction: normalizeAction(override.noCaptionImageAction) || normalizeAction(base.noCaptionImageAction),
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
