// pyash/verbs/mind.mjs
import ollama from "../motor/ollama.mjs";

// Accepts either (sentence, inputs, context) or an options object from dispatcher.
export default async function mind(sentenceOrOpts, maybeInputs = [], context = {}) {
  const sentence = sentenceOrOpts?.sentence ?? sentenceOrOpts;
  const inputs = sentenceOrOpts?.inputs ?? maybeInputs;

  const model = sentence?.obj?.model ?? sentenceOrOpts?.obj?.model;
  if (!model) throw new Error("mind: obj.model is required");

  const prompt = sentence?.with?.text ?? sentenceOrOpts?.with?.text ?? "";

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

  const fullPrompt = prompt + (inputText ? "\n\n" + inputText : "");

  const responseText = await ollama.generate(model, fullPrompt);

  // Normalized output as obj for dispatcher compatibility
  return { obj: { text: responseText } };
}
