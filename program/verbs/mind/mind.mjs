// pyash/verbs/mind.mjs
import ollama from "../../motor/ollama.mjs";
import { remember } from "../../remember/index.mjs";

export async function mind_to_name_text({ sentence, obj = {}, to, inputs = [] }) {
  const targetName = sentence?.to?.name ?? to?.name;
  const config = targetName ? remember(targetName) : null;

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

  return { obj: { text: responseText, model } };
}

export default mind_to_name_text;

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
