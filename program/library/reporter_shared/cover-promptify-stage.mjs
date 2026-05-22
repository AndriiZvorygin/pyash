import { writePyaReport } from "./cover-overlay-stage.mjs";

const TEXT_INDUCING_TERMS = ["news", "poster", "headline", "title", "sign", "signage", "label", "banner", "infographic", "article", "caption", "typography", "letters", "wordmark", "logo", "watermark"];
const NEGATIVE_PHRASING = [/\bno\b/iu, /\bwithout\b/iu, /\bdo\s+not\b/iu, /\bdon'?t\b/iu, /\bexclude\b/iu, /\bavoid\b/iu];

function normalizeHost(v = "") {
  const raw = String(v || "").trim();
  if (!raw) return "http://mriczo:11434";
  return raw.replace(/\/$/u, "");
}

function cleanLine(text = "") {
  return String(text || "")
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function abridge(text = "", maxChars = 700) {
  const s = cleanLine(text);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function inferVisualSubject({ hookText = "", topNews = "", oneSentenceSummary = "" } = {}) {
  const hay = `${hookText} ${topNews} ${oneSentenceSummary}`.toLowerCase();
  if (/\b(wheelchair|accessibility|hospital|taxi|mobility)\b/u.test(hay)) return "accessible transit network";
  if (/\b(food|food box|hunger|housing|land trust|affordable)\b/u.test(hay)) return "food and housing system";
  if (/\b(garbage|recycling|waste|landlord|river district)\b/u.test(hay)) return "urban waste management system";
  if (/\b(transit|funding|bylaw|budget|funder)\b/u.test(hay)) return "municipal transit funding system";
  return "municipal civic systems";
}

function buildDeterministicTeachingPrompt({ visualSubject = "", jurisdiction = "", meetingType = "", style = "" } = {}) {
  const subject = cleanLine(visualSubject) || "municipal civic systems";
  const location = cleanLine(jurisdiction) || "Canadian municipality";
  const mtype = cleanLine(meetingType) || "council meeting";
  const styleHint = cleanLine(style);
  return cleanLine([
    "Editorial educational illustration",
    `about ${subject}`,
    `for ${location} ${mtype}`,
    "clear conceptual scene with balanced composition and strong focal hierarchy",
    "vector-like geometric forms, flat-shaded matte texture, high contrast, clean negative space",
    "abstract informative composition, minimal clutter",
    "stylized illustration and geometric clarity, no people required",
    styleHint ? `style cue: ${styleHint}` : "",
  ].filter(Boolean).join(", "));
}

function dropVerbatimOverlay(prompt = "", overlayText = "") {
  const overlay = cleanLine(overlayText);
  if (!overlay) return prompt;
  const esc = overlay.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return String(prompt || "").replace(new RegExp(esc, "giu"), " ").replace(/\s+/gu, " ").trim();
}

function positivePromptPasses(prompt = "", overlayText = "") {
  const p = cleanLine(prompt);
  const low = p.toLowerCase();
  const overlayLow = cleanLine(overlayText).toLowerCase();
  if (!p) return { pass: false, warnings: ["empty_positive_prompt"] };
  const warnings = [];
  if (overlayLow && low.includes(overlayLow)) warnings.push("positive_prompt_contains_overlay_text");
  const badTerms = TEXT_INDUCING_TERMS.filter((t) => low.includes(t));
  if (badTerms.length) warnings.push(`positive_prompt_text_inducing_terms_${badTerms.length}`);
  if (NEGATIVE_PHRASING.some((re) => re.test(p))) warnings.push("positive_prompt_contains_negative_phrasing");
  return { pass: warnings.length === 0, warnings };
}

async function callPromptifyLlm({ host, model, prompt }) {
  const endpoint = `${normalizeHost(host)}/api/chat`;
  const body = {
    model,
    stream: false,
    messages: [
      {
        role: "system",
        content: "You write one concise positive image-generation prompt. Return only one line of prompt text.",
      },
      { role: "user", content: prompt },
    ],
  };
  const timeoutMs = Math.max(5_000, Number(process.env.COVER_PROMPTIFY_TIMEOUT_MS || 30_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`promptify ollama status ${res.status}`);
  const data = await res.json();
  return cleanLine(String(data?.message?.content || ""));
}

function buildPromptRequest({ hookText = "", oneSentenceSummary = "", topNews = "", jurisdiction = "", meetingType = "" }) {
  const profile = String(process.env.COVER_PROMPT_PROFILE || "default").trim().toLowerCase();
  if (profile === "teaching_video_scene") {
    return [
      "Given this spoken-topic context, write one concise image-generation prompt for a single instructional teaching-video scene.",
      "Goal: help a viewer understand what is being discussed.",
      "Prefer clear scene-based explanatory visuals grounded in concrete topic elements.",
      "Use process and relationship cues only when naturally relevant, without forcing diagram structure.",
      "Use non-photorealistic educational illustration style with geometric clarity and matte texture.",
      "Describe only visible scene content, composition, visual hierarchy, palette, and depth.",
      "No visible text, letters, numbers, logos, signs, banners, or watermarks.",
      "Return one line only.",
      `Topic hook: ${abridge(hookText, 220)}`,
      `Spoken summary: ${abridge(oneSentenceSummary, 420)}`,
      `Detailed topic notes: ${abridge(topNews, 900)}`,
      `Jurisdiction context: ${jurisdiction}`,
      `Meeting context: ${meetingType}`,
    ].join("\n");
  }
  return [
    "Given this Canadian local news article metadata, write one concise positive image prompt for a background-only cover image.",
    "Use symbolic illustration style similar to a teaching explainer video thumbnail, with clean vector-like forms and strong contrast.",
    "Use scene-first composition tied directly to the topic and human consequences.",
    "Use relationship cues only where helpful, but avoid forced infographic/diagram structure.",
    "Use environmental cues from Canadian local context where appropriate.",
    "Keep it stylized and educational: geometric clarity, matte texture, abstract informative visuals.",
    "Describe only visible scene content, lighting, composition, palette, and depth.",
    "The visible headline is added separately; do not include headline words verbatim.",
    "Do not include text, letters, numbers, logos, signage, banners, or watermarks in the scene.",
    "Return one line only.",
    `Title/hook: ${abridge(hookText, 220)}`,
    `Summary: ${abridge(oneSentenceSummary, 420)}`,
    `Top news: ${abridge(topNews, 900)}`,
    `Jurisdiction: ${jurisdiction}`,
    `Meeting type: ${meetingType}`,
  ].join("\n");
}

export async function runCoverPromptifyStage({
  hookText = "",
  oneSentenceSummary = "",
  topNews = "",
  jurisdiction = "",
  meetingType = "",
  style = "",
  overlayText = "",
  reportPath = "",
} = {}) {
  const host = process.env.OLLAMA_HOST || "http://mriczo:11434";
  const model = String(process.env.COVER_PROMPTIFY_MODEL || process.env.PYA_MIND_MODEL || "qwen3.5:9b").trim();
  const req = buildPromptRequest({ hookText, oneSentenceSummary, topNews, jurisdiction, meetingType });

  let positivePrompt = "";
  let llmError = "";
  try {
    positivePrompt = await callPromptifyLlm({ host, model, prompt: req });
  } catch (err) {
    llmError = String(err?.message || err);
  }

  const visualSubject = inferVisualSubject({ hookText, topNews, oneSentenceSummary });
  if (!positivePrompt) {
    positivePrompt = buildDeterministicTeachingPrompt({
      visualSubject,
      jurisdiction,
      meetingType,
      style,
    });
  }

  positivePrompt = dropVerbatimOverlay(positivePrompt, overlayText);
  const check = positivePromptPasses(positivePrompt, overlayText);

  const out = {
    hook: String(hookText || ""),
    selectedVisualSubject: visualSubject || "llm_inferred_scene",
    positivePrompt,
    topicFamily: "llm_inferred",
    promptVariant: "llm_positive_only",
    promptContainsOverlayText: check.warnings.includes("positive_prompt_contains_overlay_text"),
    positivePromptTextInducingTermsDetected: check.warnings.filter((x) => x.startsWith("positive_prompt_text_inducing_terms_")),
    positivePromptNegativePhrasingDetected: check.warnings.includes("positive_prompt_contains_negative_phrasing"),
    sourceFieldsUsed: ["hook", "oneSentenceSummary", "topNews", "jurisdiction", "meetingType"],
    warnings: llmError ? [...check.warnings, `llm_error:${llmError}`] : check.warnings,
    pass: check.pass,
    promptSourceFields: {
      jurisdiction: String(jurisdiction || ""),
      meetingType: String(meetingType || ""),
      oneSentenceSummary: String(oneSentenceSummary || ""),
      topNews: String(topNews || ""),
    },
    compositionPlan: "background_scene_only",
    model,
    ollamaHost: normalizeHost(host),
  };

  if (reportPath) writePyaReport(reportPath, out);
  return out;
}

export function buildRetryPromptForBackgroundRisk({ visualSubject = "", positivePrompt = "" } = {}) {
  const base = cleanLine(String(positivePrompt || ""));
  return base
    ? `${base}, simplify composition, preserve topic-grounded scene elements, flat-shaded illustration look, cleaner visual hierarchy`
    : "Symbolic editorial illustration with topic-grounded scene composition, flat-shaded matte finish, high contrast.";
}
