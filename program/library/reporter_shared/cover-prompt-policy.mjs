const DEFAULT_STYLE_FALLBACK = "bold civic poster background, high contrast, simple geometry, strong readability";
export const TEXT_EXCLUSION_NEGATIVE = "words, letters, numbers, signs, labels, captions, headline text, typography, watermark, logo, poster, banner, duplicated text, gibberish text";

function sanitizePromptContext(text) {
  return String(text || "")
    .replace(/\b(do\s+not|don'?t|without|exclude|avoid|no)\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function buildBackgroundPromptSpec({ style, hookText, topNewsworthy, overlayText, imageTextMode = "deterministic" } = {}) {
  const context = sanitizePromptContext([hookText, topNewsworthy].filter(Boolean).join(" ")).slice(0, 360);
  const positivePrompt = [
    "Editorial civic-news background scene for a municipal meeting recap",
    style || DEFAULT_STYLE_FALLBACK,
    "documentary atmosphere with clean composition and simple geometric structure",
    "open lower-third space reserved for a local headline card",
    context ? ("meeting context " + context) : "municipal policy and services context",
    "background art only",
  ].join(", ");

  const negativePrompt = TEXT_EXCLUSION_NEGATIVE;
  const modelOverlayText = imageTextMode === "model" ? String(overlayText || "").trim() : "";

  return {
    imageTextMode,
    positivePrompt: positivePrompt.replace(/\s+/gu, " ").trim(),
    negativePrompt,
    modelOverlayText,
  };
}
