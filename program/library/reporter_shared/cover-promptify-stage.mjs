import { writePyaReport } from "./cover-overlay-stage.mjs";

const TEXT_INDUCING_TERMS = ["news", "poster", "headline", "title", "sign", "signage", "label", "banner", "infographic", "article"];
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
  return [
    "Given this Canadian local news article metadata, write one concise positive image prompt for a background-only cover image.",
    "Use symbolic illustration style similar to an editorial teaching thumbnail, with clean vector-like forms and strong contrast.",
    "Use object-first composition: one dominant symbolic anchor plus two supporting objects tied to the topic.",
    "Use environmental cues from Canadian local context where appropriate.",
    "Keep it non-photoreal and non-cinematic: stylized illustration, geometric clarity, matte texture.",
    "Describe only visible scene content, lighting, composition, palette, and depth.",
    "The visible headline is added separately; do not include headline words verbatim.",
    "Return one line only.",
    `Title/hook: ${hookText}`,
    `Summary: ${oneSentenceSummary}`,
    `Top news: ${topNews}`,
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

  if (!positivePrompt) {
    positivePrompt = "Editorial symbolic Canadian civic background with one dominant metaphor anchor, geometric structure, layered depth, balanced contrast, and open foreground for overlay.";
  }

  positivePrompt = dropVerbatimOverlay(positivePrompt, overlayText);
  const check = positivePromptPasses(positivePrompt, overlayText);

  const out = {
    hook: String(hookText || ""),
    selectedVisualSubject: "llm_inferred_scene",
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
    ? `${base}, simplified symbolic composition, single dominant anchor object, flat-shaded illustration look, cleaner geometric hierarchy`
    : "Symbolic editorial illustration with one dominant civic anchor object, clean geometric layout, flat-shaded matte finish, high contrast.";
}
