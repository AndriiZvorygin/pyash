import { qwenSay } from "./qwen_say/qwen_say.mjs";

// The qwen say verb is one concern with many parts: the configuration that
// steers it, the prompts it sends, the text it chunks, the audio it
// produces and the verification that checks the audio. Those parts live in
// `program/verbs/qwen_say/`; this file is the entry the rest of the
// repository imports.
export { qwenSay };
export {
  normalizeQwenSayChunkText,
  sanitizeQwenSayScriptText,
  splitQwenSayTextChunks
} from "./qwen_say/text.mjs";
export { signatures } from "./qwen_say/qwen_say.mjs";

export default qwenSay;
