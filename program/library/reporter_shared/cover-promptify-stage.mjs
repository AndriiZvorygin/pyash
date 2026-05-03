import { buildBackgroundPromptSpec } from "./cover-prompt-policy.mjs";
import { writePyaReport } from "./cover-overlay-stage.mjs";

const BANNED_NEGATIVE_PHRASING = [
  /\bno\b/iu,
  /\bwithout\b/iu,
  /\bdo\s+not\b/iu,
  /\bdon'?t\b/iu,
  /\bexclude\b/iu,
  /\bavoid\b/iu,
];

function inferVisualSubject({ hookText = "", oneSentenceSummary = "", topNews = "" } = {}) {
  const src = `${hookText} ${oneSentenceSummary} ${topNews}`.toLowerCase();
  if (src.includes("business") || src.includes("permit") || src.includes("patio")) {
    return "downtown storefronts near municipal roadwork context";
  }
  if (src.includes("road") || src.includes("traffic") || src.includes("avenue")) {
    return "municipal roadway corridor with civic infrastructure context";
  }
  if (src.includes("budget") || src.includes("fees") || src.includes("fund")) {
    return "city committee setting with civic finance context";
  }
  return "municipal civic environment with local infrastructure and public-service context";
}

export function runCoverPromptifyStage({
  hookText = "",
  oneSentenceSummary = "",
  topNews = "",
  jurisdiction = "",
  meetingType = "",
  style = "",
  overlayText = "",
  reportPath = "",
} = {}) {
  const visualSubject = inferVisualSubject({ hookText, oneSentenceSummary, topNews });
  const context = [jurisdiction, meetingType, oneSentenceSummary, topNews].filter(Boolean).join(". ");
  const spec = buildBackgroundPromptSpec({
    style,
    hookText,
    topNewsworthy: topNews,
    visualSubject,
    meetingContext: context,
    overlayText,
    imageTextMode: "deterministic",
  });

  const positiveLower = spec.positivePrompt.toLowerCase();
  const overlayLower = String(overlayText || "").toLowerCase().trim();
  const negativeLower = spec.negativePrompt.toLowerCase();

  const negativePhrasingDetected = BANNED_NEGATIVE_PHRASING.some((re) => re.test(spec.positivePrompt));
  const promptContainsOverlayText = Boolean(overlayLower && positiveLower.includes(overlayLower));

  const requiredNegativeTerms = [
    "words", "letters", "numbers", "signs", "labels", "captions", "headline text", "typography",
    "watermark", "logo", "poster", "banner", "duplicated text", "gibberish text",
  ];
  const missingNegativeTerms = requiredNegativeTerms.filter((x) => !negativeLower.includes(x));

  const warnings = [];
  if (negativePhrasingDetected) warnings.push("positive_prompt_contains_negative_phrasing");
  if (promptContainsOverlayText) warnings.push("positive_prompt_contains_overlay_text");
  if (missingNegativeTerms.length) warnings.push(`negative_prompt_missing_terms_${missingNegativeTerms.length}`);

  const out = {
    hook: String(hookText || ""),
    selectedVisualSubject: visualSubject,
    positivePrompt: spec.positivePrompt,
    negativePrompt: spec.negativePrompt,
    promptContainsOverlayText,
    positivePromptNegativePhrasingDetected: negativePhrasingDetected,
    sourceFieldsUsed: ["hook", "oneSentenceSummary", "topNews", "jurisdiction", "meetingType"],
    warnings,
    pass: !negativePhrasingDetected && !promptContainsOverlayText && missingNegativeTerms.length === 0,
    promptSourceFields: {
      jurisdiction: String(jurisdiction || ""),
      meetingType: String(meetingType || ""),
      oneSentenceSummary: String(oneSentenceSummary || ""),
      topNews: String(topNews || ""),
    },
    compositionPlan: "editorial_background_with_open_lower_third",
  };

  if (reportPath) writePyaReport(reportPath, out);
  return out;
}
