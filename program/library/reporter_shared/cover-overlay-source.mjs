import fs from "node:fs";

export function stripPostTitleBoilerplate(title) {
  const t = String(title || "").trim();
  if (!t) return "";
  return t
    .replace(/\s+[—-]\s+.+?Transcript\s+[—-]\s+.+$/iu, "")
    .replace(/\s+[—-]\s+Transcript\b.*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function deriveFromOneSentence(summary) {
  const s = String(summary || "").trim();
  if (!s) return "";
  const m = s.match(/deferred\s+(?:the\s+)?(Fourth Avenue(?:\s+road\s+project)?)\s+(?:to|until)\s+(\d{4})/iu);
  if (m) return `Fourth Avenue Deferred To ${m[2]}`;
  return "";
}

function readJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function selectCoverOverlaySource({
  lemmyPostJsonPath = "",
  meetingSummaryMd = "",
  meetingHookText = "",
} = {}) {
  const candidates = [];
  const rejected = [];
  const payload = readJson(lemmyPostJsonPath) || {};
  const payloadTitle = String(payload?.title || payload?.name || "").trim();
  const payloadOneSentence = String(payload?.one_sentence_summary || "").trim();

  if (payloadTitle) {
    const cleaned = stripPostTitleBoilerplate(payloadTitle);
    candidates.push({ source: "lemmy_payload_title", path: lemmyPostJsonPath + ":title", text: cleaned || payloadTitle, freshness: "final_payload" });
  }
  if (payloadOneSentence) {
    const d = deriveFromOneSentence(payloadOneSentence) || payloadOneSentence;
    candidates.push({ source: "lemmy_payload_one_sentence", path: lemmyPostJsonPath + ":one_sentence_summary", text: d, freshness: "final_payload" });
  }

  const md = String(meetingSummaryMd || "");
  if (md) {
    const m = md.match(/^##\s+One-Sentence Summary\s*\n+(.+)$/imu);
    if (m?.[1]) {
      const line = m[1].split(/\r?\n/u).find((x) => x.trim())?.trim() || "";
      if (line) {
        const d = deriveFromOneSentence(line) || line;
        candidates.push({ source: "meeting_summary_one_sentence", path: "meeting-summary.md:One-Sentence Summary", text: d, freshness: "article_metadata" });
      }
    }
  }

  if (meetingHookText) {
    candidates.push({ source: "meeting_hook_txt", path: "meeting-hook.txt", text: String(meetingHookText).trim(), freshness: "fallback" });
  }

  let selected = candidates[0] || { source: "default", path: "", text: "City Meeting Update", freshness: "fallback" };
  const titleLike = candidates.find((c) => c.source === "lemmy_payload_title" && c.text);
  const oneSentenceLike = candidates.find((c) => /one_sentence|one_sentence_summary/u.test(c.source) && c.text);

  if (titleLike) selected = titleLike;
  else if (oneSentenceLike) selected = oneSentenceLike;

  for (const c of candidates) {
    if (c !== selected) rejected.push(c);
  }

  const norms = new Set(candidates.map((c) => String(c.text || "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim()).filter(Boolean));
  const sourceDisagreementDetected = norms.size > 1;

  return {
    selectedOverlayText: String(selected.text || "").trim(),
    overlaySource: selected.source,
    overlaySourcePath: selected.path,
    overlaySourceFreshness: selected.freshness,
    candidateOverlayTexts: candidates,
    rejectedOverlayTexts: rejected,
    sourceDisagreementDetected,
  };
}
