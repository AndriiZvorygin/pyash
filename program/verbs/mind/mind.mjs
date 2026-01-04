// pyash/verbs/mind.mjs
import ollama from "../../motor/ollama.mjs";
import { remember, doRemember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../../bridge/signature.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { emitExchangeSentence } from "../../bridge/exchange.mjs";
import { getEffectiveVyahAspect } from "../../library/grammar/vyah.mjs";
import { makeStream } from "../../library/runtimePrimitives.mjs";

// Per-mind discourse logs keyed by dialogue name
const mindLogs = new Map();
const mindAnswerCounters = new Map();
const mindDebugCounters = new Map();

function historyDialogueName({ callSentence, configSentence, targetName }) {
  if (typeof callSentence?.from?.text === "string") return callSentence.from.text;
  if (callSentence?.fromtext?.name) return String(callSentence.fromtext.name);
  if (typeof callSentence?.fromtext?.text === "string") return callSentence.fromtext.text;
  if (typeof configSentence?.from?.text === "string") return configSentence.from.text;
  if (configSentence?.fromtext?.name) return String(configSentence.fromtext.name);
  if (typeof configSentence?.fromtext?.text === "string") return configSentence.fromtext.text;
  if (targetName) return `${targetName} story`;
  return "mind story";
}

function appendLog(dialogue, entry) {
  if (!dialogue) return;
  const arr = mindLogs.get(dialogue) || [];
  arr.push(entry);
  mindLogs.set(dialogue, arr);
}

function buildHistoryMessages(dialogue, { window = 8 } = {}) {
  if (!dialogue) return [];
  const log = mindLogs.get(dialogue) || [];
  const max = window * 2;
  return log.slice(-max);
}

function nextAnswerName(targetName, dialogue) {
  const key = dialogue || targetName || "mind";
  const count = (mindAnswerCounters.get(key) || 0) + 1;
  mindAnswerCounters.set(key, count);
  return { count, name: targetName ? `${targetName} answer ${count}` : `mind answer ${count}` };
}

function nextDebugCount(targetName) {
  const key = targetName || "mind";
  const count = (mindDebugCounters.get(key) || 0) + 1;
  mindDebugCounters.set(key, count);
  return count;
}

function toQuotedJson(text) {
  return `quoted.json.${text}.json.quoted`;
}

function stripContext(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  if ("context" in clone) delete clone.context;
  return clone;
}

function recordMindJson({ targetName, label, payload }) {
  const count = nextDebugCount(targetName);
  const jsonText = JSON.stringify(payload ?? null, null, 2);
  emitExchangeSentence({
    mood: "ya",
    su: { name: `${targetName || "mind"} ${label} ${count}` },
    be: "write",
    from: { name: "mind" },
    ob: { text: toQuotedJson(jsonText) }
  });
}

function compareUtf8(a, b) {
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

function toolListFromMap(name) {
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
  if (caseKey === "become" || caseKey === "fromstate" || caseKey === "tostate") return ["name"];
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
  if (value.text !== undefined) return ["text"];
  if (value.boolean !== undefined) return ["bool"];
  if (value.filename !== undefined) return ["filename"];
  if (value.wo !== undefined) return ["wo"];
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

function buildToolSchemas(toolMapName) {
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

function buildToolSentence({ capability, args }) {
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
    call[caseKey] = argValue;
  }

  return call;
}

async function resolveInterpret() {
  const mod = await import("../../bridge/index.mjs");
  return mod.interpret;
}

export async function mind_to_name_text(sentence, { inputs = [] } = {}) {
  const ob = sentence?.ob ?? {};
  const targetName = sentence?.to?.name;
  const config = targetName ? remember(targetName) : null;
  const configSentence = config?.be === "mind" ? config : null;
  const vyahValues = Array.isArray(sentence?.vyah?.ve?.values)
    ? sentence.vyah.ve.values
    : (Array.isArray(configSentence?.vyah?.ve?.values) ? configSentence.vyah.ve.values : []);
  const aspect = getEffectiveVyahAspect(vyahValues, { verb: "mind", caseKey: "vyah" });
  let streamChunks = null;
  const dialogue = typeof sentence?.from?.text === "string"
    ? sentence.from.text
    : historyDialogueName({ callSentence: sentence, configSentence, targetName });
  const historyWindow =
    sentence?.by?.num ??
    sentence?.by?.quantity?.num ??
    configSentence?.ob?.window?.num ??
    configSentence?.ob?.historyWindow?.num ??
    configSentence?.window ??
    configSentence?.historyWindow ??
    ob?.window?.num ??
    8;

  // Model resolution: explicit on call or from config via state (keyword "as")
  const explicitModel = sentence?.ob?.model ?? ob?.model ?? null;
  const configModel = configSentence?.as?.name ?? null;
  const model = explicitModel ?? configModel ?? "qwen3-vl:8b-instruct";

  // Prompt resolution: config accordingto (discourse) + call prompt/text
  const configPrompt = configSentence?.accordingto?.name ?? null;

  const callPrompt =
    sentence?.with?.text ??
    sentence?.ob?.text ??
    (sentence?.ob?.name && !sentence?.ob?.model ? sentence?.ob?.name : null) ??
    ob?.text ??
    (ob?.name && !ob?.model ? ob?.name : null);

  const toolMapName = sentence?.with?.name ?? null;
  const { tools, toolMap, toolBlock } = buildToolSchemas(toolMapName);

  const historyMessages = buildHistoryMessages(dialogue, { window: historyWindow });

  // Combine upstream inputs into a context string
  let inputText = "";
  for (const inp of inputs) {
    if (typeof inp === "string") {
      inputText += inp + "\n";
    } else if (inp?.text) {
      inputText += inp.text + "\n";
    } else if (inp != null) {
      inputText += JSON.stringify(inp) + "\n";
    }
  }

  let responseText = "";
  if (toolMapName) {
    if (aspect === "stream") {
      throwErrorSentence({
        name: "mind aspect invalid",
        message: "mind stream is not supported with tools",
        from: { name: "mind" },
        raw: { aspect }
      });
    }
    const messages = [];
    if (configPrompt) messages.push({ role: "system", content: configPrompt });
    if (toolBlock) messages.push({ role: "system", content: toolBlock });
    if (historyMessages.length) messages.push(...historyMessages);
    const userContent = [callPrompt, inputText.trim()].filter(Boolean).join("\n\n");
    messages.push({ role: "user", content: userContent });

    const interpret = await resolveInterpret();
    const maxToolTurns = 6;
    let turns = 0;
    let lastResponse = null;

    while (turns < maxToolTurns) {
      turns += 1;
      const mockResponse = typeof process !== "undefined" ? process?.env?.PYA_MIND_RESPONSE : undefined;
      if (mockResponse) {
        try {
          lastResponse = JSON.parse(mockResponse);
        } catch {
          lastResponse = { message: { content: mockResponse } };
        }
      } else {
        const requestPayload = { model, messages, tools, stream: false };
        recordMindJson({ targetName, label: "request", payload: requestPayload });
        lastResponse = await ollama.chat(requestPayload);
      }
      recordMindJson({ targetName, label: "response", payload: stripContext(lastResponse) });

      const toolCalls = lastResponse?.message?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        responseText = lastResponse?.message?.content ?? "";
        break;
      }

      const assistantMessage = {
        role: "assistant",
        content: lastResponse?.message?.content ?? "",
        tool_calls: toolCalls
      };
      messages.push(assistantMessage);
      appendLog(dialogue, { role: "assistant", content: assistantMessage.content });

      for (const call of toolCalls) {
        const toolName = call?.function?.name ?? call?.name;
        if (!toolName || !toolMap.has(toolName)) {
          throwErrorSentence({
            name: "tool defective",
            message: `unknown tool: ${toolName}`,
            from: { name: "mind" },
            raw: call
          });
        }
        const capability = toolMap.get(toolName);
        const toolSentence = buildToolSentence({
          capability,
          args: call?.function?.arguments ?? call?.arguments
        });
        const toolResult = await interpret(toolSentence);
        const toolText = toolResult && typeof toolResult === "object" ? sentenceToPyash(toolResult) : String(toolResult ?? "");
        messages.push({ role: "tool", tool_name: toolName, content: toolText });
        appendLog(dialogue, { role: "tool", content: toolText });
      }
    }

    if (!responseText) {
      responseText = lastResponse?.message?.content ?? "";
    }
  } else {
    const promptParts = [];
    if (configPrompt) promptParts.push(configPrompt);
    const toolList = toolListFromMap(toolMapName);
    if (toolList) promptParts.push(toolList);
    if (historyMessages.length) {
      const histText = historyMessages
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
      promptParts.push(histText);
    }
    if (callPrompt) promptParts.push(callPrompt);
    const fullPrompt = promptParts.filter(Boolean).join("\n\n") + (inputText ? "\n\n" + inputText : "");
    const mockResponse = typeof process !== "undefined" ? process?.env?.PYA_MIND_RESPONSE : undefined;
    if (mockResponse) {
      responseText = mockResponse;
    } else if (aspect === "stream") {
      recordMindJson({ targetName, label: "request", payload: { model, prompt: fullPrompt.trim(), stream: true } });
      const streamed = await ollama.generateStream({
        model,
        prompt: fullPrompt.trim(),
        onChunk: process?.env?.PYA_STREAM_STDOUT === "1"
          ? (chunk) => { if (chunk) process.stdout.write(String(chunk)); }
          : undefined
      });
      streamChunks = Array.isArray(streamed?.chunks) ? streamed.chunks : null;
      recordMindJson({ targetName, label: "response", payload: stripContext({ response: streamed.text, chunks: streamChunks }) });
      responseText = streamed.text;
    } else {
      recordMindJson({ targetName, label: "request", payload: { model, prompt: fullPrompt.trim(), stream: true } });
      const raw = await ollama.generate(model, fullPrompt.trim());
      recordMindJson({ targetName, label: "response", payload: stripContext({ response: raw }) });
      responseText = raw;
    }
  }

  // Record turn so future calls have context
  const { count, name: answerName } = nextAnswerName(targetName, dialogue);
  if (callPrompt) {
    doRemember({
      mood: "ya",
      su: { name: `${targetName} ${dialogue} question ${count}` },
      be: "write",
      from: { name: "user" },
      ob: { text: callPrompt }
    });
    appendLog(dialogue, { role: "user", content: callPrompt });
  }
  const answerSentence = {
    mood: "ya",
    su: { name: answerName },
    be: "answer",
    from: { name: targetName },
    ob: { text: responseText }
  };
  doRemember(answerSentence);
  doRemember({
    ...answerSentence,
    su: { name: "result" }
  });
  doRemember({
    mood: "ya",
    su: { name: `${targetName} ${dialogue} answer ${count}` },
    be: "answer",
    from: { name: targetName },
    ob: { text: responseText }
  });
  appendLog(dialogue, { role: "assistant", content: responseText });

  if (aspect === "stream") {
    const streamName = sentence?.su?.name ?? `${targetName ?? "mind"} stream`;
    const chunks = (Array.isArray(streamChunks) && streamChunks.length > 0)
      ? streamChunks
      : String(responseText ?? "")
        .split(/\s+/)
        .filter(Boolean);
    return makeStream({
      name: streamName,
      state: "open",
      ob: { ve: { values: chunks }, index: 0 }
    });
  }

  return answerSentence;
}

export default mind_to_name_text;

export { buildHistoryMessages };
export function resetMindLogs() {
  mindLogs.clear();
  mindAnswerCounters.clear();
  mindDebugCounters.clear();
}

export const signatures = [
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "text", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map", "vyah", "stream"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "num", "to", "name", "num"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "name", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "name", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  // Type-style target: write ... to name mind
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text }
  ,
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind", "with", "name", "map"], handler: mind_to_name_text }
];
