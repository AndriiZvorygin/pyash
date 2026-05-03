const DEFAULT_STYLE_FALLBACK = "bold civic poster background, high contrast, simple geometry, strong readability";
export const TEXT_EXCLUSION_NEGATIVE = "words, letters, numbers, signs, labels, captions, headline text, typography, watermark, logo, poster, banner, duplicated text, gibberish text";

function sanitizePromptContext(text) {
  return String(text || "")
    .replace(/\b(do\s+not|don'?t|without|exclude|avoid|no)\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function removeVerbatimOverlay(text, overlayText) {
  const base = String(text || "");
  const overlay = String(overlayText || "").trim();
  if (!overlay) return base;
  const escaped = overlay.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return base.replace(new RegExp(escaped, "giu"), " ").replace(/\s+/gu, " ").trim();
}

export function buildBackgroundPromptSpec({
  style,
  hookText,
  topNewsworthy,
  visualSubject,
  meetingContext,
  overlayText,
  imageTextMode = "deterministic",
} = {}) {
  const rawContext = [meetingContext, topNewsworthy].filter(Boolean).join(" ");
  const contextSanitized = removeVerbatimOverlay(sanitizePromptContext(rawContext), overlayText);
  const hookContext = imageTextMode === "deterministic"
    ? removeVerbatimOverlay(sanitizePromptContext(hookText), overlayText)
    : sanitizePromptContext(hookText);
  const context = [hookContext, contextSanitized].filter(Boolean).join(" ").slice(0, 360);

  const positivePrompt = [
    "Editorial civic-news background scene for a municipal meeting recap",
    style || DEFAULT_STYLE_FALLBACK,
    visualSubject || "municipal civic environment with local infrastructure and public-service context",
    "documentary atmosphere with clean composition and simple geometric structure",
    "open lower-third space for headline placement",
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
