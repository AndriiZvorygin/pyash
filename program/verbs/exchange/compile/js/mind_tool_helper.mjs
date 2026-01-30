function mindToolHelperSource() {
  return `const mindDebugCounters = new Map();
function nextMindDebugCount(targetName) {
  const key = targetName || "mind";
  const count = (mindDebugCounters.get(key) || 0) + 1;
  mindDebugCounters.set(key, count);
  return count;
}
function stripMindContext(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  if ("context" in clone) delete clone.context;
  return clone;
}
function recordMindJson(targetName, label, payload) {
  if (!pyaNewspaperEnabled()) return;
  const count = nextMindDebugCount(targetName);
  const name = targetName || "mind";
  const mapName = name + " " + label + " " + count;
  const pyashText = jsonToPyashTextRuntime(payload ?? {}, mapName);
  const lines = pyashText.split("\\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    pyaEmitNewspaper(line);
  }
}
function toolTypeWordsFromValue(value, caseKey) {
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
function deriveSignatureWordsFromCall(sentence) {
  const words = ["be", sentence?.be];
  for (const key of CASE_ORDER) {
    if (key === "su") continue;
    if (!sentence || sentence[key] === undefined) continue;
    const typeWords = toolTypeWordsFromValue(sentence[key], key);
    words.push(key, ...typeWords);
  }
  return words.filter(Boolean);
}
function buildToolSchemas(toolEntries = {}) {
  const caps = [];
  for (const entry of Object.values(toolEntries)) {
    if (entry?.mood !== "can" || !entry?.be) continue;
    const canonical = formatSentence(entry);
    caps.push({ sentence: entry, canonical });
  }
  if (!caps.length) return { tools: [], toolMap: new Map(), toolBlock: "" };
  caps.sort((a, b) => compareUtf8(a.canonical, b.canonical));
  const toolMap = new Map();
  const tools = [];
  for (const cap of caps) {
    const signatureWords = deriveSignatureWordsFromCall(cap.sentence);
    const signatureName = signatureWords.join(" ");
    const toolName = toolFunctionNameFromSignature(signatureWords);
    const properties = {};
    const required = [];
    for (const key of CASE_ORDER) {
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
  const toolBlock = "TOOLS:\\n" + caps.map(c => c.canonical).join("\\n");
  return { tools, toolMap, toolBlock };
}
function buildToolSentence({ capability, args }) {
  const sentence = JSON.parse(JSON.stringify(capability || {}));
  let parsed = args;
  if (typeof args === "string") {
    try { parsed = JSON.parse(args); } catch { parsed = {}; }
  }
  const values = parsed && typeof parsed === "object" ? parsed : {};
  for (const [key, val] of Object.entries(values)) {
    const typeWords = toolTypeWordsFromValue(capability?.[key], key);
    if (typeWords.includes("name")) sentence[key] = { name: String(val ?? "") };
    else if (typeWords.includes("num")) sentence[key] = { num: Number(val ?? 0) };
    else if (typeWords.includes("bool")) sentence[key] = { boolean: Boolean(val) };
    else if (typeWords.includes("filename")) sentence[key] = { filename: String(val ?? "") };
    else if (typeWords.includes("text")) sentence[key] = { text: String(val ?? "") };
    else sentence[key] = { text: String(val ?? "") };
  }
  sentence.mood = "do";
  return sentence;
}
`;
}

export { mindToolHelperSource };
