// pyash/verbs/mind.mjs
import ollama from "../motor/ollama.mjs";
import { getMemory } from "../memory.mjs";

export default async function mind({ sentence, obj = {}, to, inputs = [] }) {
  const targetName = sentence?.to?.name ?? to?.name;
  const config = targetName ? getMemory(targetName) : null;

  // Model resolution: explicit on call or from config via state (keyword "as")
  const explicitModel = sentence?.obj?.model ?? obj?.model ?? null;
  const configModel = config?.as?.name ?? null;
  const model = explicitModel ?? configModel;
  if (!model) throw new Error("mind: obj.model is required");

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
