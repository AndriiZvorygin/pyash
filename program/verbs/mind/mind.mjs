// pyash/verbs/mind.mjs
import ollama from "../../motor/ollama.mjs";
import { remember, doRemember } from "../../remember/index.mjs";
import { sentenceToPyash } from "../../beautiful.mjs";

// Per-mind discourse logs keyed by dialogue name
const mindLogs = new Map();
const mindAnswerCounters = new Map();

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

export async function mind_to_name_text({ sentence, ob = {}, to, inputs = [] }) {
  const targetName = sentence?.to?.name ?? to?.name;
  const config = targetName ? remember(targetName) : null;
  const configSentence = config?.be === "mind" ? config : null;
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

  const promptParts = [];
  if (configPrompt) promptParts.push(configPrompt);
  const toolMapName = sentence?.with?.name ?? null;
  const toolList = toolListFromMap(toolMapName);
  if (toolList) promptParts.push(toolList);
  const historyMessages = buildHistoryMessages(dialogue, { window: historyWindow });
  if (historyMessages.length) {
    const histText = historyMessages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");
    promptParts.push(histText);
  }
  if (callPrompt) promptParts.push(callPrompt);

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

  const fullPrompt = promptParts.filter(Boolean).join("\n\n") + (inputText ? "\n\n" + inputText : "");

  const responseText = await ollama.generate(model, fullPrompt.trim());

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
    mood: "ya",
    su: { name: `${targetName} ${dialogue} answer ${count}` },
    be: "answer",
    from: { name: targetName },
    ob: { text: responseText }
  });
  appendLog(dialogue, { role: "assistant", content: responseText });

  return answerSentence;
}

export default mind_to_name_text;

export { buildHistoryMessages };
export function resetMindLogs() {
  mindLogs.clear();
  mindAnswerCounters.clear();
}

export const signatures = [
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
