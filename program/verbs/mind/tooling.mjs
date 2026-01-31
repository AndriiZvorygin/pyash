import { remember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../../bridge/signature.mjs";

export function compareUtf8(a, b) {
  if (a === b) return 0;
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const bufA = encoder ? encoder.encode(String(a)) : Array.from(String(a), ch => ch.charCodeAt(0));
  const bufB = encoder ? encoder.encode(String(b)) : Array.from(String(b), ch => ch.charCodeAt(0));
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

export function toolListFromMap(name) {
  if (!name) return "";
  const fact = remember(name);
  if (!fact || fact.be !== "map") return "";
  const entries = fact.ob?.map ?? {};
  const keys = Object.keys(entries).sort(compareUtf8);
  const lines = [];
  for (const key of keys) {
    const entry = entries[key];
    if (entry?.mood && entry?.be) {
      lines.push(sentenceToPyash(entry));
    }
  }
  if (!lines.length) return "";
  return `TOOLS:\n${lines.join("\n")}`;
}

function cloneSentence(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

const TOOL_NON_CASE_FIELDS = new Set([
  "mood",
  "be",
  "su",
  "subj",
  "vyah",
  "exists",
  "signature",
  "signatureWords",
  "ret",
  "this",
  "consequence"
]);

function toolTypeWordsFromValue(value, caseKey) {
  if (value == null) return [];
  if (value.la) return ["la"];
  if (caseKey === "become" || caseKey === "fromstate" || caseKey === "tostate") {
    if (value.wo !== undefined) return ["wo"];
    if (value.name) return ["name"];
    return ["name"];
  }
  if (value.ve) {
    const inner = typeof value.ve.type === "string" ? value.ve.type : "";
    return ["vec", ...(inner ? [inner] : [])].filter(Boolean);
  }
  if (value.nameTypeWords?.length) return ["name", ...value.nameTypeWords];
  if (value.name) {
    const tail = String(value.name).trim();
    if (["num", "text", "bool", "filename", "vec", "ve", "wo", "mind"].includes(tail)) {
      return ["name", tail];
    }
    return ["name"];
  }
  if (value.num !== undefined) return ["num"];
  if (value.wo !== undefined) return ["wo"];
  if (value.text !== undefined) return ["text"];
  if (value.boolean !== undefined) return ["bool"];
  if (value.filename !== undefined) return ["filename"];
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

export function buildToolSchemas(toolMapName) {
  if (!toolMapName) return { tools: [], toolMap: new Map(), toolBlock: "" };
  const fact = remember(toolMapName);
  if (!fact || fact.be !== "map") return { tools: [], toolMap: new Map(), toolBlock: "" };
  const entries = fact.ob?.map ?? {};
  const caps = [];
  for (const entry of Object.values(entries)) {
    if (entry?.mood !== "can" || !entry?.be) continue;
    const canonical = sentenceToPyash(entry);
    caps.push({ sentence: entry, canonical });
  }
  if (!caps.length) return { tools: [], toolMap: new Map(), toolBlock: "" };
  caps.sort((a, b) => compareUtf8(a.canonical, b.canonical));

  const toolMap = new Map();
  const tools = [];
  for (const cap of caps) {
    const signatureWords = deriveSignatureFromCall(cap.sentence, { remember });
    const signatureName = joinSignatureWords(signatureWords);
    const toolName = toolFunctionNameFromSignature(signatureWords);
    const properties = {};
    const required = [];
    const caseKeys = Object.keys(cap.sentence).filter(k => !TOOL_NON_CASE_FIELDS.has(k));
    caseKeys.sort(compareUtf8);
    for (const caseKey of caseKeys) {
      const value = cap.sentence[caseKey];
      const typeWords = toolTypeWordsFromValue(value, caseKey);
      properties[caseKey] = { type: toolSchemaType(typeWords) };
      required.push(caseKey);
    }
    tools.push({
      type: "function",
      function: {
        name: toolName,
        description: cap.canonical,
        signature: signatureName,
        parameters: {
          type: "object",
          properties,
          required
        }
      }
    });
    toolMap.set(toolName, cap.sentence);
    toolMap.set(signatureName, cap.sentence);
  }
  const toolBlock = `TOOLS:\n${caps.map(c => c.canonical).join("\n")}`;
  return { tools, toolMap, toolBlock };
}

export function buildToolSentence({ capability, args }) {
  const call = cloneSentence(capability);
  delete call.su;
  delete call.subj;
  delete call.signature;
  delete call.signatureWords;
  delete call.exists;
  delete call.ret;
  delete call.this;
  delete call.consequence;
  call.mood = "do";

  const argObject = (() => {
    if (!args) return {};
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
    if (typeof args === "object") return args;
    return {};
  })();

  for (const [caseKey, argValue] of Object.entries(argObject)) {
    const typeWords = toolTypeWordsFromValue(capability?.[caseKey], caseKey);
    const hasName = typeWords.includes("name");
    const isNum = typeWords.includes("num");
    const isBool = typeWords.includes("bool");
    const isText = typeWords.includes("text");
    const isFilename = typeWords.includes("filename");
    const isVec = typeWords.includes("vec");
    const isWo = typeWords.includes("wo");

    if (isVec && Array.isArray(argValue)) {
      call[caseKey] = { ve: { values: argValue } };
      continue;
    }
    if (hasName) {
      call[caseKey] = { name: String(argValue) };
      continue;
    }
    if (isNum) {
      const numVal = Number(argValue);
      call[caseKey] = { num: Number.isFinite(numVal) ? numVal : 0 };
      continue;
    }
    if (isBool) {
      call[caseKey] = { boolean: argValue === "truth" ? true : argValue === "lie" ? false : Boolean(argValue) };
      continue;
    }
    if (isFilename) {
      call[caseKey] = { filename: String(argValue) };
      continue;
    }
    if (isText) {
      call[caseKey] = { text: String(argValue) };
      continue;
    }
    if (isWo) {
      call[caseKey] = { wo: String(argValue) };
      continue;
    }
    call[caseKey] = argValue;
  }

  return call;
}
