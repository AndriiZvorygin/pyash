const FINANCIAL_TERMS = [
  "saving", "savings", "saved", "revenue", "income", "cost", "costs",
  "cost avoidance", "cost avoided", "efficien", "benefit", "benefits",
  "budget", "levy", "fee", "fees", "tax", "taxes", "financial",
  "expenditure", "spending", "funding", "surplus", "deficit",
];

const FINANCIAL_AMOUNT_RE = /(?:\$|\b\d[\d,]*(?:\.\d+)?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b)/iu;

function normalize(text = "") {
  return String(text || "").replace(/\s+/gu, " ").trim();
}

function boundSource(text = "", maxChars = 48000) {
  const value = normalize(text);
  if (value.length <= maxChars) return value;
  const side = Math.floor((maxChars - 80) / 2);
  return `${value.slice(0, side)} ... [source middle omitted for context] ... ${value.slice(-side)}`;
}

export function containsFinancialClaimText(text = "") {
  const value = normalize(text).toLowerCase();
  if (!value) return false;
  const hasTerm = FINANCIAL_TERMS.some((term) => value.includes(term));
  if (!hasTerm) return false;
  // A bare budget/revenue topic is still worth checking, while generic
  // words such as "benefits" should invoke the audit only with an amount.
  const hasStrongTerm = [
    "saving", "savings", "saved", "revenue", "income", "cost avoidance",
    "cost avoided", "spending", "expenditure", "surplus", "deficit",
  ].some((term) => value.includes(term));
  return hasStrongTerm || FINANCIAL_AMOUNT_RE.test(value);
}

export function buildFinancialClaimAuditPrompt({ sourceText = "", candidateText = "", context = "" } = {}) {
  return [
    "Audit the financial meaning of a civic headline or summary against the supplied source.",
    "Return strict JSON only; do not include markdown or explanation outside the JSON object.",
    "",
    "Classify the candidate's financial claim as exactly one of:",
    "direct_savings, aggregate_benefits, revenue, efficiency, cost_avoidance, forecast_or_target, disputed_or_uncertain, none.",
    "",
    "Rules:",
    "- A direct saving is an explicit reduction in a budget line, spending, fee, or tax burden.",
    "- Use aggregate_benefits when the source combines savings with revenue, staff-time efficiencies, soft savings, or future cost avoidance.",
    "- Use forecast_or_target for projected, expected, estimated, annualized, compounded, or original-target amounts.",
    "- Use disputed_or_uncertain when the source itself qualifies the amount, lacks a net calculation, or presents conflicting interpretations.",
    "- An unqualified headline saying savings or saved is misleading for aggregate_benefits, forecast_or_target, or disputed_or_uncertain.",
    "- Those claims require attribution (for example report cites or staff reported) and, when applicable, a category qualifier such as combined benefits, revenue and cost avoidance.",
    "- Do not treat Council receiving a report for information as approval of the reported financial result.",
    "- PASS only when the candidate's wording preserves the source's category, certainty, attribution, and decision status.",
    "- REVISE when the candidate presents an aggregate, projected, disputed, or merely reported figure as direct or approved savings.",
    "",
    "Return exactly this shape:",
    '{"verdict":"PASS|REVISE","claim_type":"direct_savings|aggregate_benefits|revenue|efficiency|cost_avoidance|forecast_or_target|disputed_or_uncertain|none","source_support":"direct|qualified|unsupported","needs_attribution":true,"needs_category_qualifier":true,"feedback":"one short evidence-based sentence"}',
    "",
    context ? `CONTEXT:\n${boundSource(context, 8000)}` : "",
    "SOURCE:",
    boundSource(sourceText),
    "",
    "CANDIDATE:",
    normalize(candidateText),
  ].filter(Boolean).join("\n");
}

function parseJsonObject(text = "") {
  const value = String(text || "")
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

const CLAIM_TYPES = new Set([
  "direct_savings", "aggregate_benefits", "revenue", "efficiency",
  "cost_avoidance", "forecast_or_target", "disputed_or_uncertain", "none",
]);

export function parseFinancialClaimAudit(raw = "") {
  const parsed = parseJsonObject(raw);
  const verdict = String(parsed?.verdict || "").toUpperCase();
  const claimType = String(parsed?.claim_type || "");
  const sourceSupport = String(parsed?.source_support || "");
  const shapeValid = Boolean(parsed)
    && ["PASS", "REVISE"].includes(verdict)
    && CLAIM_TYPES.has(claimType)
    && ["direct", "qualified", "unsupported"].includes(sourceSupport)
    && typeof parsed.needs_attribution === "boolean"
    && typeof parsed.needs_category_qualifier === "boolean";
  if (!shapeValid) {
    return {
      valid: false,
      verdict: "REVISE",
      claim_type: "disputed_or_uncertain",
      source_support: "unsupported",
      needs_attribution: true,
      needs_category_qualifier: true,
      feedback: "Financial claim audit did not return a valid structured result.",
      raw: String(raw || ""),
    };
  }
  const needsAttribution = parsed.needs_attribution === true;
  const needsCategoryQualifier = parsed.needs_category_qualifier === true;
  const feedback = normalize(parsed.feedback || "Financial claim requires source-faithful qualification.");
  const effectiveVerdict = verdict === "PASS" && sourceSupport === "unsupported" ? "REVISE" : verdict;
  return {
    valid: true,
    verdict: effectiveVerdict,
    claim_type: claimType,
    source_support: sourceSupport,
    needs_attribution: needsAttribution,
    needs_category_qualifier: needsCategoryQualifier,
    feedback: effectiveVerdict === "REVISE" && verdict === "PASS" && sourceSupport === "unsupported"
      ? "The audit marked the candidate unsupported; it must be rewritten or attributed to the source."
      : feedback,
    raw: String(raw || ""),
  };
}

export async function auditFinancialClaim({ ask, sourceText = "", candidateText = "", context = "", numPredict = 260 } = {}) {
  if (typeof ask !== "function") throw new TypeError("auditFinancialClaim requires an ask function");
  if (!containsFinancialClaimText(candidateText)) {
    return {
      required: false,
      valid: true,
      verdict: "PASS",
      claim_type: "none",
      source_support: "direct",
      needs_attribution: false,
      needs_category_qualifier: false,
      feedback: "",
      raw: "",
    };
  }
  const raw = await ask(
    [
      { role: "system", content: "You are a strict financial-claim verifier for civic reporting." },
      { role: "user", content: buildFinancialClaimAuditPrompt({ sourceText, candidateText, context }) },
    ],
    { numPredict },
  );
  const parsed = parseFinancialClaimAudit(raw);
  return { required: true, ...parsed };
}
