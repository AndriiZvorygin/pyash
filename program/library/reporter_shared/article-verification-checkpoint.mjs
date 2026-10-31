export function articleClaimsVerificationNeedsRetry(summary = null) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return true;
  return summary["has error"] === true
    || Number(summary["removed count"] || 0) > 0
    || Number(summary["rewritten count"] || 0) > 0
    || Number(summary["unresolved high severity count"] || 0) > 0;
}

export function buildArticleVerificationRetryFeedback(report = null) {
  const summary = report?.summary;
  if (!articleClaimsVerificationNeedsRetry(summary)) return "";
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const rejected = findings
    .filter((finding) => String(finding?.["final action"] || "").toLowerCase() === "removed"
      || String(finding?.severity || "").toLowerCase().startsWith("unsupported"))
    .map((finding) => [
      `Rejected claim: ${String(finding?.["original sentence"] || "").trim()}`,
      `Reason: ${String(finding?.["issue type"] || "unsupported claim").trim()}`,
      `Source anchor: ${String(finding?.["source support snippet"] || "").trim()}`,
    ].join("\n"))
    .filter((finding) => finding.includes("Rejected claim: "))
    .slice(0, 6);
  return [
    "ARTICLE_VERIFICATION_RETRY: The previous whole-meeting draft was rejected by the independent article verifier.",
    "Regenerate the complete summary from the supplied chunk sources. Do not repeat the rejected claim or a stronger paraphrase; use only conservative wording directly supported by the source anchor, or omit that claim while preserving the rest of the meeting coverage.",
    rejected.join("\n\n") || "The prior verifier report was malformed or incomplete; re-check every included claim against the supplied chunk sources.",
  ].join("\n\n");
}
