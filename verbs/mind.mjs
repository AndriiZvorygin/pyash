// pyash/verbs/mind.mjs
import ollama from "../motor/ollama.mjs";

// sentence: full sentence object from workflow
// inputs:   array of upstream outputs (in the same order as "from")
// context:  full name → value map (optional, if you need it)
export default async function mind(sentence, inputs, context) {
  const model = sentence.obj?.model;
  if (!model) throw new Error("mind: obj.model is required");

  const prompt = sentence.with?.text || "";

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

  // Normalized output; your “mind” returns a text object
  return { text: responseText };
}
