const DEFAULT_STYLE_FALLBACK = "editorial symbolic illustration background, clear visual hierarchy, balanced contrast";
const POSITIVE_BANNED_TERMS = ["news", "poster", "headline", "title", "sign", "signage", "label", "banner", "infographic", "article"];

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
  const context = [hookContext, contextSanitized].filter(Boolean).join(" ").slice(0, 180);

  const roadworkLike = /\b(avenue|road|street|traffic|one-way|construction|barrier|barricade|lane|pavement|infrastructure|deferred)\b/iu
    .test(String(visualSubject || "") + " " + String(hookText || "") + " " + String(topNewsworthy || ""));

  let positivePrompt = roadworkLike
    ? [
        "Editorial symbolic background about transportation decisions",
        "lane arrows, route lines, wayfinding symbols, and asphalt-texture motifs",
        "policy-planning visual language with clean geometric composition",
        "balanced contrast with clear focal hierarchy",
        "open foreground area for headline overlay",
        "square composition",
      ].join(", ")
    : [
        "Editorial symbolic background tailored to the article topic",
        style || DEFAULT_STYLE_FALLBACK,
        visualSubject || "policy-relevant objects and planning context",
        "concrete objects and icon-like cues that explain the topic",
        "balanced contrast and uncluttered composition",
        "open foreground area for headline overlay",
        "square composition",
      ].join(", ");

  if (context) positivePrompt = `${positivePrompt}, ${context}`;
  for (const term of POSITIVE_BANNED_TERMS) {
    positivePrompt = positivePrompt.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "giu"), " ");
  }
  positivePrompt = positivePrompt.replace(/\s+/gu, " ").replace(/\s,\s/gu, ", ").trim();

  return {
    imageTextMode,
    positivePrompt,
    negativePrompt: "",
    modelOverlayText: imageTextMode === "model" ? String(overlayText || "").trim() : "",
  };
}
