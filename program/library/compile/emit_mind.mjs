import { handleMindSentenceC } from "./emit_mind/c_runtime.mjs";
import { handleMindSentenceJs } from "./emit_mind/js_runtime.mjs";

export function handleMindSentence(context, helpers) {
  const { baseBe, lang } = context;

  if (baseBe !== "mind") return null;

  if (lang === "c") return handleMindSentenceC(context, helpers);
  return handleMindSentenceJs(context, helpers);
}
