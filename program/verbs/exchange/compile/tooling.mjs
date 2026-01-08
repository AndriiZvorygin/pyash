import { sentenceToPyash } from "../../../beautiful.mjs";
import { compareUtf8 } from "./util.mjs";

const TOOL_CASE_ORDER = [
  "su",
  "ob",
  "vyah",
  "fromindex",
  "atindex",
  "toindex",
  "fromtext",
  "from",
  "to",
  "by",
  "with",
  "as",
  "accordingto",
  "become",
  "at",
  "during",
  "via",
  "of"
];

function toolTypeWordsFromValue(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.nameTypeWords) && value.nameTypeWords.length) return ["name", ...value.nameTypeWords];
  if (value.name !== undefined) return ["name"];
  if (value.num !== undefined) return ["num"];
  if (value.text !== undefined) return ["text"];
  if (value.boolean !== undefined) return ["bool"];
  if (value.filename !== undefined) return ["filename"];
  if (value.ve) return ["vec"];
  if (value.la) return ["la"];
  return [];
}

function toolSchemaType(typeWords) {
  if (!typeWords?.length) return "string";
  if (typeWords.includes("name")) return "string";
  if (typeWords.includes("bool")) return "boolean";
  if (typeWords.includes("num")) return "number";
  if (typeWords.includes("text")) return "string";
  if (typeWords.includes("filename")) return "string";
  if (typeWords.includes("vec")) return "array";
  if (typeWords.includes("la")) return "object";
  return "string";
}

function toolFunctionNameFromSignature(signatureWords) {
  return signatureWords
    .map(word => String(word ?? ""))
    .join("_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function deriveSignatureWordsForTool(sentence) {
  const words = ["be", sentence?.be];
  for (const key of TOOL_CASE_ORDER) {
    if (key === "su") continue;
    if (!sentence || sentence[key] === undefined) continue;
    const typeWords = toolTypeWordsFromValue(sentence[key], key);
    words.push(key, ...typeWords);
  }
  return words.filter(Boolean);
}

function buildToolSchemasForCompile(toolEntries = {}) {
  const caps = [];
  for (const entry of Object.values(toolEntries)) {
    if (entry?.mood !== "can" || !entry?.be) continue;
    const canonical = sentenceToPyash(entry).trim();
    caps.push({ sentence: entry, canonical });
  }
  if (!caps.length) return { tools: [], toolMap: new Map(), toolBlock: "" };
  caps.sort((a, b) => compareUtf8(a.canonical, b.canonical));
  const toolMap = new Map();
  const tools = [];
  for (const cap of caps) {
    const signatureWords = deriveSignatureWordsForTool(cap.sentence);
    const signatureName = signatureWords.join(" ");
    const toolName = toolFunctionNameFromSignature(signatureWords);
    const properties = {};
    const required = [];
    for (const key of TOOL_CASE_ORDER) {
      if (key === "su") continue;
      if (cap.sentence?.[key] === undefined) continue;
      const typeWords = toolTypeWordsFromValue(cap.sentence[key], key);
      properties[key] = { type: toolSchemaType(typeWords) };
      required.push(key);
    }
    tools.push({
      type: "function",
      function: {
        name: toolName,
        description: cap.canonical,
        signature: signatureName,
        parameters: { type: "object", properties, required }
      }
    });
    toolMap.set(toolName, cap.sentence);
    toolMap.set(signatureName, cap.sentence);
  }
  const toolBlock = "TOOLS:\n" + caps.map(c => c.canonical).join("\n");
  return { tools, toolMap, toolBlock };
}

export {
  TOOL_CASE_ORDER,
  buildToolSchemasForCompile,
  deriveSignatureWordsForTool,
  toolFunctionNameFromSignature,
  toolSchemaType,
  toolTypeWordsFromValue
};
