// pyash/verbs/mind.mjs
import ollama from "../../motor/ollama.mjs";
import { remember, doRemember } from "../../remember/index.mjs";

// Per-mind discourse logs keyed by bucket name
const mindLogs = new Map();

function historyBucketName({ callSentence, configSentence, targetName }) {
  if (typeof callSentence?.from?.text === "string") return callSentence.from.text;
  if (callSentence?.fromtext?.name) return String(callSentence.fromtext.name);
  if (typeof callSentence?.fromtext?.text === "string") return callSentence.fromtext.text;
  if (typeof configSentence?.from?.text === "string") return configSentence.from.text;
  if (configSentence?.fromtext?.name) return String(configSentence.fromtext.name);
  if (typeof configSentence?.fromtext?.text === "string") return configSentence.fromtext.text;
  if (targetName) return `${targetName} story`;
  return "mind story";
}

function appendLog(bucket, entry) {
  if (!bucket) return;
  const arr = mindLogs.get(bucket) || [];
  arr.push(entry);
  mindLogs.set(bucket, arr);
}

function buildHistoryMessages(bucket, { window = 8 } = {}) {
  if (!bucket) return [];
  const log = mindLogs.get(bucket) || [];
  const max = window * 2;
  return log.slice(-max);
}

export async function mind_to_name_text({ sentence, ob = {}, to, inputs = [] }) {
  const targetName = sentence?.to?.name ?? to?.name;
  const config = targetName ? remember(targetName) : null;
  const configSentence = config?.be === "mind" ? config : null;
  const bucket = typeof sentence?.from?.text === "string"
    ? sentence.from.text
    : historyBucketName({ callSentence: sentence, configSentence, targetName });
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
  if (callPrompt) promptParts.push(callPrompt);
  const historyMessages = buildHistoryMessages(bucket, { window: historyWindow });
  if (historyMessages.length) {
    const histText = historyMessages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");
    promptParts.push(histText);
  }

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
  if (callPrompt) {
    doRemember({
      mood: "do",
      be: "write",
      to: { name: targetName },
      ob: { text: callPrompt }
    });
    appendLog(bucket, { role: "user", content: callPrompt });
  }
  const baseConfig = configSentence || {};
  doRemember({
    mood: "ya",
    su: { name: targetName },
    be: "mind",
    from: baseConfig.from,
    as: baseConfig.as,
    accordingto: baseConfig.accordingto,
    exists: baseConfig.exists,
    ob: { text: responseText, model, historyWindow }
  });
  appendLog(bucket, { role: "assistant", content: responseText });

  return { ob: { text: responseText, model } };
}

export default mind_to_name_text;

export { buildHistoryMessages };
export function resetMindLogs() {
  mindLogs.clear();
}

export const signatures = [
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "num", "to", "name", "num"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "fromtext", "text", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "from", "text", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  // Type-style target: write ... to name mind
  { signatureWords: ["be", "write", "ob", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "write", "ob", "name", "text", "to", "name", "mind"], handler: mind_to_name_text }
];
