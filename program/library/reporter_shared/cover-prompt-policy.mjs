const DEFAULT_STYLE_FALLBACK = "editorial documentary background, natural lighting, realistic textures, strong readability";
const POSITIVE_BANNED_TERMS = ["civic-news", "poster", "headline", "title", "sign", "signage", "label"];
export const TEXT_EXCLUSION_NEGATIVE = "words, letters, numbers, signs, labels, captions, headline text, typography, watermark, logo, poster, banner, billboard, placard, storefront signs, road signs, license plates, duplicated text, gibberish text";

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

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
  const context = [hookContext, contextSanitized].filter(Boolean).join(" ").slice(0, 240);

  const roadworkLike = /\b(avenue|road|street|traffic|one-way|construction|barrier|barricade|lane|pavement|infrastructure|deferred)\b/iu
    .test(String(visualSubject || "") + " " + String(hookText || "") + " " + String(topNewsworthy || ""));

  let positivePrompt = roadworkLike
    ? [
        "Documentary photograph style municipal street under roadwork",
        "orange traffic barrels and temporary barricades",
        "lane markings, curb, sidewalk, and realistic pavement texture",
        "downtown buildings softly out of focus",
        "evening natural light with balanced contrast",
        "open pavement foreground for overlay placement",
        "square composition with street-level perspective",
      ].join(", ")
    : [
        "Editorial municipal background scene",
        style || DEFAULT_STYLE_FALLBACK,
        visualSubject || "municipal public-service environment",
        "documentary atmosphere with realistic street-level detail",
        "open pavement foreground for overlay placement",
        "square composition",
      ].join(", ");

  if (context) positivePrompt = `${positivePrompt}, ${context}`;
  for (const term of POSITIVE_BANNED_TERMS) {
    positivePrompt = positivePrompt.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "giu"), " ");
  }
  positivePrompt = positivePrompt.replace(/\s+/gu, " ").replace(/\s,\s/gu, ", ").trim();

  const negativePrompt = TEXT_EXCLUSION_NEGATIVE;
  const modelOverlayText = imageTextMode === "model" ? String(overlayText || "").trim() : "";

  return {
    imageTextMode,
    positivePrompt,
    negativePrompt,
    modelOverlayText,
  };
}
