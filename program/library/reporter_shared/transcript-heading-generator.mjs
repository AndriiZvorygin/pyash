function normalizeSpaces(text = "") {
  return String(text || "").replace(/\s+/gu, " ").trim();
}

function sanitizeHeading(text = "", maxWords = 8) {
  let t = normalizeSpaces(text)
    .replace(/\*+/gu, "")
    .replace(/^["'`]+|["'`]+$/gu, "")
    .replace(/^(first|second|third|fourth|fifth)[,:\s]+/iu, "")
    .replace(/^(the meeting (also )?featured|the meeting opened with|simultaneously|in addition|during the meeting|council discussed)\b[:,]?\s*/iu, "")
    .replace(/^(the most consequential (item|moment|action)( of the night| on the agenda)? was)\s+/iu, "")
    .replace(/[^\p{L}\p{N}&'\/\-\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!t) return "";
  const words = t.split(" ").filter(Boolean);
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ");
  t = t.replace(/\b(and|or|to|of|for|with|from|in|on|at|by|during|while|where|that|which)\s*$/iu, "").trim();
  t = t.replace(/[,:;.\-–—]\s*$/u, "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

function isValidHeading(text = "") {
  const t = normalizeSpaces(text);
  if (!t) return false;
  if (/\.\.\./u.test(t)) return false;
  if (/\*\*/u.test(t)) return false;
  if (/^(the meeting|simultaneously|in addition|during the meeting|council discussed)\b/iu.test(t)) return false;
  const words = t.split(" ").filter(Boolean);
  if (words.length < 3 || words.length > 8) return false;
  if (/\b(and|or|to|of|for|with|from|in|on|at|by|during|while|where|that|which)$/iu.test(t)) return false;
  return true;
}

export async function generateTranscriptHeadingFromEvidence({
  transcriptEvidence = "",
  candidateSummary = "",
  sectionHeading = "",
  meetingContext = "",
  maxWords = 8,
  mode = "post_lead",
} = {}) {
  const base = [candidateSummary, sectionHeading, transcriptEvidence].filter(Boolean).join(" ");
  let heading = sanitizeHeading(base, maxWords);
  if (isValidHeading(heading)) return { heading, method: "deterministic_clean" };
  const fallback = sanitizeHeading(sectionHeading || candidateSummary || "Council Meeting Highlights", maxWords);
  if (isValidHeading(fallback)) return { heading: fallback, method: "deterministic_fallback" };
  return { heading: "Council Meeting Highlights", method: "emergency_fallback" };
}

export function buildOneSentenceFromHeading({ dateLong = "", jurisdiction = "", heading = "", sectionHeading = "" } = {}) {
  const date = normalizeSpaces(dateLong) || "April 27, 2026";
  const city = normalizeSpaces(jurisdiction) || "Owen Sound";
  let topic = sanitizeHeading(heading || sectionHeading || "local issues", 12).toLowerCase();
  if (!topic) topic = "local issues";
  if (/\b(public forum|resident|deputation|delegation)\b/iu.test(String(sectionHeading || ""))) {
    return `On ${date}, ${city} council heard resident concerns about ${topic}.`;
  }
  return `On ${date}, ${city} council discussed ${topic}.`;
}
