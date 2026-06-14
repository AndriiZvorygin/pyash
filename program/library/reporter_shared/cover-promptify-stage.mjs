import { writePyaReport } from "./cover-overlay-stage.mjs";

const TEXT_INDUCING_TERMS = ["news", "poster", "headline", "title", "sign", "signage", "label", "banner", "infographic", "article", "caption", "typography", "letters", "wordmark", "logo", "watermark"];
const NEGATIVE_PHRASING = [/\bno\b/iu, /\bwithout\b/iu, /\bdo\s+not\b/iu, /\bdon'?t\b/iu, /\bexclude\b/iu, /\bavoid\b/iu];
const TEXT_TERM_REPLACEMENTS = new Map([
  ["news", "civic scene"],
  ["poster", "composition"],
  ["headline", ""],
  ["title", ""],
  ["sign", ""],
  ["signage", ""],
  ["label", ""],
  ["banner", ""],
  ["infographic", "explainer scene"],
  ["article", "civic scene"],
  ["caption", ""],
  ["typography", ""],
  ["letters", ""],
  ["wordmark", ""],
  ["logo", ""],
  ["watermark", ""],
]);

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

function extractVisualSubjectFromPrompt(prompt = "") {
  const s = cleanLine(prompt);
  if (!s) return "";
  const first = s.split(/[.,;:]/u)[0] || s;
  return cleanLine(first).slice(0, 120);
}

function wordTermRegex(term = "") {
  const esc = String(term || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${esc}\\b`, "giu");
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
  const badTerms = TEXT_INDUCING_TERMS.filter((t) => wordTermRegex(t).test(low));
  if (badTerms.length) warnings.push(`positive_prompt_text_inducing_terms_${badTerms.length}`);
  if (NEGATIVE_PHRASING.some((re) => re.test(p))) warnings.push("positive_prompt_contains_negative_phrasing");
  return { pass: warnings.length === 0, warnings };
}

function sanitizePositivePrompt(prompt = "", overlayText = "") {
  let out = dropVerbatimOverlay(cleanLine(prompt), overlayText);
  for (const term of TEXT_INDUCING_TERMS) {
    out = out.replace(wordTermRegex(term), TEXT_TERM_REPLACEMENTS.get(term) || "");
  }
  out = out
    .replace(/\bdo\s+not\s+include\b/giu, "")
    .replace(/\bdon'?t\s+include\b/giu, "")
    .replace(/\bwithout\b/giu, "")
    .replace(/\bavoid\b/giu, "")
    .replace(/\bexclude\b/giu, "")
    .replace(/\bno\b/giu, "")
    .replace(/\s*,\s*,+/gu, ",")
    .replace(/\s+/gu, " ")
    .trim();
  return cleanLine(out);
}

function fallbackPositivePrompt({ jurisdiction = "", meetingType = "" } = {}) {
  const context = [jurisdiction, meetingType].map(cleanLine).filter(Boolean).join(" ");
  return cleanLine([
    "Symbolic Canadian county council scene showing stormwater runoff channels, rural roads, meeting chamber silhouettes, layered watershed landscape, geometric matte illustration, strong contrast, clear depth, background composition",
    context ? `local civic context ${context}` : "",
  ].join(", "));
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
  const timeoutMs = Math.max(5_000, Number(process.env.COVER_PROMPTIFY_TIMEOUT_MS || 120_000));
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

async function callPromptifyLlmWithRetry({ host, model, prompt }) {
  const attempts = Math.max(1, Number(process.env.COVER_PROMPTIFY_RETRIES || 3));
  let lastErr = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await callPromptifyLlm({ host, model, prompt });
    } catch (err) {
      lastErr = err;
      if (i >= attempts) break;
      const sleepMs = Math.min(10_000, 1500 * i);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }
  throw lastErr || new Error("promptify request failed");
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

function buildPromptRepairRequest({ invalidPrompt = "", warnings = [] }) {
  return [
    "Rewrite this image-generation prompt into a single compliant positive line.",
    "Keep topic specificity, composition cues, and style quality.",
    "Do not use negative phrasing like no/without/do not/avoid/exclude.",
    "Do not include visible text terms (headline, poster, signage, labels, letters, numbers, logo, watermark).",
    "Return one line only.",
    `Warnings: ${warnings.join(", ") || "none"}`,
    `Invalid prompt: ${abridge(invalidPrompt, 1100)}`,
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
    positivePrompt = await callPromptifyLlmWithRetry({ host, model, prompt: req });
  } catch (err) {
    llmError = String(err?.message || err);
  }

  if (!positivePrompt) {
    const reason = llmError || "empty_llm_prompt";
    throw new Error(`cover promptify failed: ${reason}`);
  }

  positivePrompt = dropVerbatimOverlay(positivePrompt, overlayText);
  let check = positivePromptPasses(positivePrompt, overlayText);
  if (!check.pass) {
    const repairReq = buildPromptRepairRequest({ invalidPrompt: positivePrompt, warnings: check.warnings });
    const repaired = await callPromptifyLlmWithRetry({ host, model, prompt: repairReq });
    positivePrompt = sanitizePositivePrompt(repaired, overlayText);
    check = positivePromptPasses(positivePrompt, overlayText);
  }
  if (!check.pass) {
    positivePrompt = fallbackPositivePrompt({ jurisdiction, meetingType });
    check = positivePromptPasses(positivePrompt, overlayText);
  }
  if (!check.pass) {
    throw new Error(`cover promptify rejected fallback prompt: ${check.warnings.join(",") || "unknown_reason"}`);
  }
  const visualSubject = extractVisualSubjectFromPrompt(positivePrompt);

  const out = {
    hook: String(hookText || ""),
    selectedVisualSubject: visualSubject || "llm_generated_scene",
    positivePrompt,
    topicFamily: "llm_inferred",
    promptVariant: "llm_positive_only",
    promptContainsOverlayText: check.warnings.includes("positive_prompt_contains_overlay_text"),
    positivePromptTextInducingTermsDetected: check.warnings.filter((x) => x.startsWith("positive_prompt_text_inducing_terms_")),
    positivePromptNegativePhrasingDetected: check.warnings.includes("positive_prompt_contains_negative_phrasing"),
    sourceFieldsUsed: ["hook", "oneSentenceSummary", "topNews", "jurisdiction", "meetingType"],
    warnings: llmError ? [...check.warnings, `llm_error:${llmError}`] : check.warnings,
    pass: true,
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
