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

const TOOL_ARGUMENT_SCHEMA_ADAPTERS = {
  "command session start": {
    toolName: "command_session_start",
    description: "Start a long-running interactive command session only when the user needs to keep a process open and interact with it. This is not for web search, API calls, URL retrieval, or ordinary one-shot commands; use web_search, web_search_source, download, or command for those. The working directory defaults to the agent's active project root. Pass request with command, args (array), and optional cwd, columns, rows.",
    fields: { ob: { name: "request", type: "object", description: "Command, argument array, and optional in-project working directory and dimensions." } }
  },
  "command session start program agent": {
    toolName: "command_session_start_program_agent",
    description: "Start an independent coding saddle only when the user explicitly asks to delegate work to a child coding session. Do not use it for web search, API calls, URL retrieval, or routine commands. Pass request with mind (configured Pyash mind name), optional model, cwd, and instruction. The parent mind's backend and model delegation allowlists are enforced. Use the returned id with command_session_read and command_session_write to communicate with the child.",
    fields: { ob: { name: "request", type: "object", description: "Child mind, optional in-project working directory and model, and initial instruction." } }
  },
  "command session read": {
    toolName: "command_session_read",
    description: "Read output from an already-started command session. Use the exact id returned by command_session_start. Pass request with id and optional after cursor and maxBytes.",
    fields: { ob: { name: "request", type: "object", description: "Command session id and output cursor." } }
  },
  "command session write": {
    toolName: "command_session_write",
    description: "Send input to an already-started command session. Use the exact id returned by command_session_start. Encode Tab as \\t and Enter as \\r; input is forwarded unchanged.",
    fields: { ob: { name: "request", type: "object", description: "Command session id and input string." } }
  },
  "command session size": {
    toolName: "command_session_size",
    description: "Resize an already-started command session. Pass request with its id, columns, and rows.",
    fields: { ob: { name: "request", type: "object", description: "Command session id, columns, and rows." } }
  },
  "command session status": {
    toolName: "command_session_status",
    description: "Get the current state of an already-started command session. Pass request with its id.",
    fields: { ob: { name: "request", type: "object", description: "Command session id." } }
  },
  "command session list": {
    toolName: "command_session_list",
    description: "List command sessions owned by this Pyash runtime. Use only when the user asks about active command sessions or after starting one; this is not a search or health-check tool.",
    fields: { ob: { name: "request", type: "object", description: "Empty object." } }
  },
  "command session finish": {
    toolName: "command_session_finish",
    description: "Close an already-started command session when the user asks or its task is complete. Pass request with its id and optional signal.",
    fields: { ob: { name: "request", type: "object", description: "Command session id and optional signal." } }
  },
  "search": {
    toolName: "search_zim_library",
    description: "Search the configured Kiwix ZIM service for archives and entries. The tool resolves the host-configured endpoint, which may be remote; no local ZIM mount or server address is needed. Results include a usable full page URL from that service. Pass that returned URL unchanged to a retrieval tool. Search uses archived content and does not contact source websites.",
    fields: {
      ob: {
        name: "query",
        description: "Terms to find in the ZIM collection served by the configured Kiwix endpoint."
      }
    }
  },
  "web search": {
    toolName: "web_search",
    description: "Search the configured live web search motor for current information or news. It can also find pages such as technology RSS feed listings. Use this for ordinary live internet searches; it uses the configured search service and needs no shell or API endpoint. Returns up to five results with full source URLs and descriptions. For offline documentation use search_zim_library; use web_search_source only when the user names a specific search service.",
    fields: { ob: { name: "query", description: "Terms to search on the live web." } }
  },
  "web search source": {
    toolName: "web_search_source",
    description: "Search a specific live search service API and return up to five source URLs and descriptions. For Yago, pass its POST /search endpoint; Pyash reads the bearer key from yago api key in configure/secret.pya or YAGO_API_KEY. For YaCy, pass its JSON endpoint ending in /yacysearch.json. Use this when the user names a search service; do not download the search homepage and infer its query syntax.",
    fields: {
      ob: { name: "query", description: "Terms to search." },
      from: { name: "search_url", description: "Search API endpoint URL. For Yago, use /search; for YaCy, use /yacysearch.json." }
    }
  },
  "search archive": {
    toolName: "search_archive",
    description: "Search one ZIM archive through the configured Kiwix service when its archive file is mounted in the configured local library. archive_path is a local archive path or library directory, not a URL. Search results include usable page URLs; pass returned locators unchanged. For remote-only archives, use search_zim_library. Searching archived content does not contact source websites.",
    fields: {
      in: {
        name: "archive_path",
        description: "A .zim file path or the configured archive directory for a local indexed search."
      },
      ob: {
        name: "query",
        description: "Terms to find in the local ZIM index."
      }
    }
  },
  "read archive focus": {
    toolName: "read_archive_focus",
    description: "Read a bounded passage from one ZIM entry when its archive file is mounted in the configured local library. Copy entry_path exactly from search results; focus is the symbol or phrase to find within that entry. For remote-only archives, retrieve the full page URL returned by search instead.",
    fields: {
      from: {
        name: "archive_path",
        description: "Path to the .zim archive in the shared archive library."
      },
      ob: {
        name: "entry_path",
        description: "Exact entry path copied from a search result, for example OpenCL_API.html."
      },
      by: {
        name: "focus",
        description: "Symbol or phrase to locate within the entry, for example clCreateBuffer."
      }
    }
  }
};

function toolCapabilityName(capability) {
  const subjectName = String(capability?.su?.name ?? "").trim();
  const namespaceMarker = " internal ";
  const namespaceIndex = subjectName.lastIndexOf(namespaceMarker);
  return namespaceIndex >= 0
    ? subjectName.slice(namespaceIndex + namespaceMarker.length).trim()
    : subjectName;
}

function toolArgumentSchemaAdapter(capability) {
  return TOOL_ARGUMENT_SCHEMA_ADAPTERS[toolCapabilityName(capability)] ?? null;
}

function isInputMarker(value) {
  if (!value || typeof value !== "object") return false;
  return value.text === "input" || value.name === "input" || value.wo === "input" || value.filename === "input";
}

function isOpenCase(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value.nameTypeWords) && value.nameTypeWords.length > 0) return true;
  const openNames = new Set(["num", "text", "bool", "filename", "vec", "ve", "wo", "mind", "date"]);
  if (typeof value.name === "string" && openNames.has(value.name)) return true;
  if (value.ve) {
    if (Array.isArray(value.ve.values) && value.ve.values.length === 0) return true;
    if (value.ve.values == null && value.ve.type) return true;
  }
  return false;
}

function toolTypeWordsFromValue(value, caseKey) {
  if (value == null) return [];
  if (value.la) return ["la"];
  if (caseKey === "become" || caseKey === "fromstate" || caseKey === "tostate") {
  if (value.wo !== undefined) return ["wo"];
  if (value.name) return ["name"];
  return ["name"];
  }
  if (caseKey === "to") {
    if (value.filename !== undefined) return ["filename"];
    if (value.nameTypeWords?.includes("text")) return ["name", "text"];
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

function scalarArgValue(argValue) {
  if (argValue == null) return "";
  if (typeof argValue === "string" || typeof argValue === "number" || typeof argValue === "boolean") {
    return String(argValue);
  }
  if (typeof argValue === "object") {
    const filename = typeof argValue.filename === "string" ? argValue.filename : "";
    if (filename) return filename;
    const text = typeof argValue.text === "string" ? argValue.text : "";
    if (text) return text;
    const name = typeof argValue.name === "string" ? argValue.name : "";
    if (name) return name;
    const wo = typeof argValue.wo === "string" ? argValue.wo : "";
    if (wo) return wo;
  }
  return String(argValue);
}

function toolFunctionNameFromSignature(signatureWords) {
  return signatureWords
    .map(word => String(word ?? ""))
    .join("_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizedWords(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function buildReadableToolName({ sentence, caseKeys = [] } = {}) {
  const verbWords = normalizedWords(sentence?.be);
  const subjectWords = normalizedWords(sentence?.su?.name);
  if (!verbWords.length || !subjectWords.length) return "";
  if (subjectWords[0] !== verbWords[0]) return "";
  const extraWords = subjectWords.slice(1);
  if (!extraWords.length) return "";

  const words = ["be", ...subjectWords];
  for (const caseKey of caseKeys) {
    words.push(caseKey, ...toolTypeWordsFromValue(sentence?.[caseKey], caseKey));
  }
  return toolFunctionNameFromSignature(words);
}

export function buildToolSchemas(toolMapName) {
  if (!toolMapName) return { tools: [], toolMap: new Map(), toolBlock: "" };
  const fact = remember(toolMapName);
  if (!fact || fact.be !== "map") return { tools: [], toolMap: new Map(), toolBlock: "" };
  const entries = fact.ob?.map ?? {};
  const caps = [];
  for (const entry of Object.values(entries)) {
    if ((entry?.mood !== "can" && entry?.mood !== "propose") || !entry?.be) continue;
    const canonical = sentenceToPyash(entry);
    caps.push({ sentence: entry, canonical });
  }
  if (!caps.length) return { tools: [], toolMap: new Map(), toolBlock: "" };
  caps.sort((a, b) => compareUtf8(a.canonical, b.canonical));

  const toolMap = new Map();
  const tools = [];
  for (const cap of caps) {
    const argumentSchemaAdapter = toolArgumentSchemaAdapter(cap.sentence);
    const signatureWords = deriveSignatureFromCall(cap.sentence, { remember });
    const signatureName = joinSignatureWords(signatureWords);
    const toolName = toolFunctionNameFromSignature(signatureWords);
    const properties = {};
    const required = [];
    const rawCaseKeys = Object.keys(cap.sentence).filter(k => !TOOL_NON_CASE_FIELDS.has(k));
    const hasInputMarkers = rawCaseKeys.some((key) => isInputMarker(cap.sentence[key]));
    let caseKeys;
    if (hasInputMarkers) {
      caseKeys = rawCaseKeys.filter((key) => isInputMarker(cap.sentence[key]));
    } else {
      const openKeys = rawCaseKeys.filter((key) => isOpenCase(cap.sentence[key]));
      caseKeys = openKeys;
    }
    caseKeys.sort(compareUtf8);
    const schemaCaseKeys = argumentSchemaAdapter
      ? [...caseKeys].sort((left, right) => compareUtf8(
        argumentSchemaAdapter.fields[left]?.name ?? left,
        argumentSchemaAdapter.fields[right]?.name ?? right
      ))
      : caseKeys;
    for (const caseKey of schemaCaseKeys) {
      const value = cap.sentence[caseKey];
      const typeWords = toolTypeWordsFromValue(value, caseKey);
      const field = argumentSchemaAdapter?.fields[caseKey];
      const argumentName = field?.name ?? caseKey;
      properties[argumentName] = {
        type: field?.type ?? toolSchemaType(typeWords),
        ...(field?.description ? { description: field.description } : {})
      };
      required.push(argumentName);
    }
    const readableToolName = buildReadableToolName({ sentence: cap.sentence, caseKeys });
    const finalToolName = argumentSchemaAdapter?.toolName
      ?? (toolName.length > 48 && readableToolName ? readableToolName : toolName);
    const isSaddlePlanTool = cap.sentence?.be === "write"
      && cap.sentence?.fromstate?.text === "coding saddle plan";
    const description = isSaddlePlanTool
      ? `${cap.canonical}. Set ob to a JSON-encoded object string. Create or replace example: {"action":"create","objective":"...","steps":[{"title":"..."}]}. Update example: {"action":"update_step","id":"step-001","status":"done","evidence":"..."}. Step statuses are pending, in_progress, done, or blocked. If an update is rejected, correct the payload and retry.`
      : argumentSchemaAdapter?.description ?? cap.canonical;
    tools.push({
      type: "function",
      function: {
        name: finalToolName,
        description,
        signature: signatureName,
        parameters: {
          type: "object",
          properties,
          required
        }
      }
    });
    toolMap.set(finalToolName, cap.sentence);
    toolMap.set(signatureName, cap.sentence);
  }
  const toolBlock = `TOOLS:\n${caps.map((cap) => {
    const argumentSchemaAdapter = toolArgumentSchemaAdapter(cap.sentence);
    if (!argumentSchemaAdapter) return cap.canonical;
    const argumentNames = Object.values(argumentSchemaAdapter.fields)
      .map((field) => field.name)
      .sort(compareUtf8);
    return `${argumentSchemaAdapter.toolName}: ${argumentSchemaAdapter.description} Arguments: ${argumentNames.join(", ")}.`;
  }).join("\n")}`;
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
  if (call.be === "read" && !call.become && call.as?.wo !== "cluster-compress") {
    call.become = { wo: "text" };
  }

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

  const capabilityCaseKeys = new Set(
    Object.keys(capability ?? {}).filter((key) => !TOOL_NON_CASE_FIELDS.has(key))
  );
  const argumentSchemaAdapter = toolArgumentSchemaAdapter(capability);
  const aliasedCaseKeys = new Map(
    Object.entries(argumentSchemaAdapter?.fields ?? {}).map(([caseKey, field]) => [field.name, caseKey])
  );

  for (const [argumentName, argValue] of Object.entries(argObject)) {
    const caseKey = aliasedCaseKeys.get(argumentName) ?? argumentName;
    if (!capabilityCaseKeys.has(caseKey)) continue;
    const field = argumentSchemaAdapter?.fields[caseKey];
    if (field?.type === "object" && argValue && typeof argValue === "object" && !Array.isArray(argValue)) {
      call[caseKey] = { text: JSON.stringify(argValue) };
      continue;
    }
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
      call[caseKey] = {
        name: scalarArgValue(argValue),
        ...(caseKey === "to" && typeWords.length > 1 ? { nameTypeWords: typeWords.slice(1) } : {})
      };
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
      call[caseKey] = { filename: scalarArgValue(argValue) };
      continue;
    }
    if (isText) {
      call[caseKey] = { text: scalarArgValue(argValue) };
      continue;
    }
    if (isWo) {
      call[caseKey] = { wo: scalarArgValue(argValue) };
      continue;
    }
    call[caseKey] = argValue;
  }

  // `be see` needs a prompt; accept explicit `ob` even when capability sentences
  // only expose `from filename`, otherwise use a deterministic default so we do
  // not accidentally inherit unrelated conversational text.
  if (call?.be === "see") {
    if (!call?.ob && Object.prototype.hasOwnProperty.call(argObject, "ob")) {
      call.ob = { text: scalarArgValue(argObject.ob) };
    }
    if (!call?.ob) {
      call.ob = { text: "Describe the image." };
    }
  }

  return call;
}

export function formatWebSearchToolResult(surfacedTool) {
  const entries = surfacedTool?.ob?.map && typeof surfacedTool.ob.map === "object"
    ? surfacedTool.ob.map
    : {};
  const metadata = entries.metadata ?? {};
  const results = Object.entries(entries)
    .filter(([key, value]) => key !== "metadata" && value?.from?.filename)
    .sort(([, left], [, right]) => Number(left?.atindex?.num ?? 0) - Number(right?.atindex?.num ?? 0));
  const status = String(metadata.searchStatus?.text ?? "response received").toUpperCase();
  const lines = [
    `Web search status: ${status}.`,
    `Result records returned: ${results.length}.`
  ];
  if (!results.length) {
    lines.push("No result records were returned; this response contains no titles or source URLs.");
  }
  if (metadata.searchTotalResults?.text) lines.push(`Reported total: ${metadata.searchTotalResults.text}.`);
  if (metadata.searchIssues?.text) lines.push(`Search issues: ${metadata.searchIssues.text}.`);
  for (const [index, [, entry]] of results.entries()) {
    lines.push(`${index + 1}. ${entry?.ob?.text ?? "Untitled result"}`);
    lines.push(`URL: ${entry.from.filename}`);
    const description = String(entry?.as?.text ?? "").trim();
    if (description) {
      const clipped = description.length > 600 ? `${description.slice(0, 597)}...` : description;
      lines.push(`Description: ${clipped}`);
    }
  }
  return lines.join("\n");
}
