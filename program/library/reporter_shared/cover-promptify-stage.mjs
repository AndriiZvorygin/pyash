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

const TEXT_INDUCING_TERMS = ["news", "poster", "headline", "title", "sign", "signage", "label", "banner", "infographic", "article"];

function inferVisualSubject({ hookText = "", oneSentenceSummary = "", topNews = "" } = {}) {
  const src = `${hookText} ${oneSentenceSummary} ${topNews}`.toLowerCase();
  if (src.includes("road") || src.includes("traffic") || src.includes("avenue") || src.includes("fourth") || src.includes("construction")) {
    return "municipal roadway corridor with civic infrastructure context";
  }
  if (src.includes("business") || src.includes("permit") || src.includes("patio")) {
    return "downtown sidewalk commerce and patio context";
  }
  if (src.includes("budget") || src.includes("fees") || src.includes("fund")) {
    return "municipal administrative setting with documents and public-service context";
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
  const negativePhrasingDetected = BANNED_NEGATIVE_PHRASING.some((re) => re.test(spec.positivePrompt));
  const promptContainsOverlayText = Boolean(overlayLower && positiveLower.includes(overlayLower));
  const textInducingTermsDetected = TEXT_INDUCING_TERMS.filter((x) => positiveLower.includes(x));

  const warnings = [];
  if (negativePhrasingDetected) warnings.push("positive_prompt_contains_negative_phrasing");
  if (promptContainsOverlayText) warnings.push("positive_prompt_contains_overlay_text");
  if (textInducingTermsDetected.length) warnings.push(`positive_prompt_text_inducing_terms_${textInducingTermsDetected.length}`);

  const out = {
    hook: String(hookText || ""),
    selectedVisualSubject: visualSubject,
    positivePrompt: spec.positivePrompt,
    topicFamily: String(visualSubject || "default_civic"),
    promptContainsOverlayText,
    positivePromptTextInducingTermsDetected: textInducingTermsDetected,
    positivePromptNegativePhrasingDetected: negativePhrasingDetected,
    sourceFieldsUsed: ["hook", "oneSentenceSummary", "topNews", "jurisdiction", "meetingType"],
    warnings,
    pass: !negativePhrasingDetected && !promptContainsOverlayText && textInducingTermsDetected.length === 0,
    promptSourceFields: {
      jurisdiction: String(jurisdiction || ""),
      meetingType: String(meetingType || ""),
      oneSentenceSummary: String(oneSentenceSummary || ""),
      topNews: String(topNews || ""),
    },
    compositionPlan: "background_scene_only",
  };

  if (reportPath) writePyaReport(reportPath, out);
  return out;
}

export function buildRetryPromptForBackgroundRisk({ visualSubject = "", positivePrompt = "" } = {}) {
  const src = String(visualSubject || "").toLowerCase() + " " + String(positivePrompt || "").toLowerCase();
  const roadworkLike = /\b(avenue|road|street|traffic|one-way|construction|barrier|barricade|lane|pavement|infrastructure|deferred|roadwork)\b/iu.test(src);
  if (roadworkLike) {
    return "Documentary close-up of municipal roadwork scene, orange traffic barrels and temporary barricades, lane markings and pavement texture in sharp foreground, curb and sidewalk edges, background buildings softly blurred, natural evening light, balanced contrast, open pavement foreground, square composition";
  }
  return String(positivePrompt || "");
}
