// pyash/verbs/mind.mjs
import ollama from "../../motor/ollama.mjs";
import { remember, dumpHistory, doRemember } from "../../remember/index.mjs";

function buildHistoryMessages(mindName, { window = 8 } = {}) {
  if (!mindName) return [];
  const hist = dumpHistory();
  const messages = [];

  for (const fact of hist) {
    // User -> mind (say do)
    if (fact.mood === "do" && fact.be === "say" && fact.to?.name === mindName) {
      const content = fact.obj?.text ?? fact.obj?.name;
      if (content) messages.push({ role: "user", content: String(content) });
      continue;
    }

    // Mind reply (primary)
    if (fact.mood === "ya" && fact.be === "mind" && fact.subj?.name === mindName) {
      const content = fact.obj?.text ?? fact.obj?.name;
      if (content) messages.push({ role: "assistant", content: String(content) });
      continue;
    }

    // Secondary result fact
    if (fact.mood === "ya" && fact.be === "say" && fact.subj?.name === "result") {
      const content = fact.obj?.text ?? fact.obj?.name;
      if (content) messages.push({ role: "assistant", content: String(content) });
    }
  }

  // Take the last N*2 entries (user/assistant pairs) to bound context
  const max = window * 2;
  return messages.slice(-max);
}

export async function mind_to_name_text({ sentence, obj = {}, to, inputs = [] }) {
  const targetName = sentence?.to?.name ?? to?.name;
  const config = targetName ? remember(targetName) : null;
  const historyWindow =
    config?.obj?.window?.num ??
    config?.obj?.historyWindow?.num ??
    config?.historyWindow ??
    obj?.window?.num ??
    8;

  // Model resolution: explicit on call or from config via state (keyword "as")
  const explicitModel = sentence?.obj?.model ?? obj?.model ?? null;
  const configModel = config?.as?.name ?? null;
  const model = explicitModel ?? configModel ?? "qwen3-vl:8b-instruct";

  // Prompt resolution: config accordingto (discourse) + call prompt/text
  const configPrompt = config?.accordingto?.name ?? null;

  const callPrompt =
    sentence?.with?.text ??
    sentence?.obj?.text ??
    (sentence?.obj?.name && !sentence?.obj?.model ? sentence?.obj?.name : null) ??
    obj?.text ??
    (obj?.name && !obj?.model ? obj?.name : null);

  const promptParts = [];
  if (configPrompt) promptParts.push(configPrompt);
  if (callPrompt) promptParts.push(callPrompt);
  const historyMessages = buildHistoryMessages(targetName, { window: historyWindow });
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
      be: "say",
      to: { name: targetName },
      obj: { text: callPrompt }
    });
  }
  const baseConfig = config || {};
  doRemember({
    mood: "ya",
    subj: { name: targetName },
    be: "mind",
    from: baseConfig.from,
    as: baseConfig.as,
    accordingto: baseConfig.accordingto,
    obj: { text: responseText, model, historyWindow }
  });

  return { obj: { text: responseText, model } };
}

export default mind_to_name_text;

export { buildHistoryMessages };

export const signatures = [
  { signatureWords: ["be", "mind", "obj", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "obj", "name", "num", "to", "name", "num"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "obj", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "obj", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "mind", "obj", "name", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "say", "obj", "text", "to", "name", "text"], handler: mind_to_name_text },
  { signatureWords: ["be", "say", "obj", "name", "text", "to", "name", "text"], handler: mind_to_name_text },
  // Type-style target: say ... to name mind
  { signatureWords: ["be", "say", "obj", "text", "to", "name", "mind"], handler: mind_to_name_text },
  { signatureWords: ["be", "say", "obj", "name", "text", "to", "name", "mind"], handler: mind_to_name_text }
];
