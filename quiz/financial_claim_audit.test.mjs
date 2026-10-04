import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFinancialClaimAuditPrompt,
  containsFinancialClaimText,
  parseFinancialClaimAudit,
} from "../program/library/reporter_shared/financial-claim-audit.mjs";

test("financial claim detection is generic and recognizes aggregate monetary wording", () => {
  assert.equal(containsFinancialClaimText("X Million Savings From Modernization"), true);
  assert.equal(containsFinancialClaimText("Report Cites Combined Benefits From X Million"), true);
  assert.equal(containsFinancialClaimText("Cloud Permit Review"), false);
});

test("financial audit parser accepts a qualified aggregate-benefits result", () => {
  const parsed = parseFinancialClaimAudit(JSON.stringify({
    verdict: "PASS",
    claim_type: "aggregate_benefits",
    source_support: "qualified",
    needs_attribution: true,
    needs_category_qualifier: true,
    feedback: "The report attribution and combined-benefits wording preserve the source.",
  }));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.verdict, "PASS");
  assert.equal(parsed.claim_type, "aggregate_benefits");
  assert.equal(parsed.needs_attribution, true);
});

test("malformed financial audit output fails closed", () => {
  const parsed = parseFinancialClaimAudit("not json");
  assert.equal(parsed.valid, false);
  assert.equal(parsed.verdict, "REVISE");
  assert.equal(parsed.source_support, "unsupported");
});

test("a purported pass with unsupported source support is revised", () => {
  const parsed = parseFinancialClaimAudit(JSON.stringify({
    verdict: "PASS",
    claim_type: "aggregate_benefits",
    source_support: "unsupported",
    needs_attribution: true,
    needs_category_qualifier: true,
    feedback: "The amount is not supported.",
  }));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.verdict, "REVISE");
});

test("financial audit prompt requires attribution for aggregate or projected claims", () => {
  const prompt = buildFinancialClaimAuditPrompt({
    sourceText: "The report combines savings, new revenue, efficiencies, and future cost avoidance.",
    candidateText: "X Million Savings From Modernization",
  });
  assert.match(prompt, /aggregate_benefits/u);
  assert.match(prompt, /forecast_or_target/u);
  assert.match(prompt, /require attribution/iu);
  assert.match(prompt, /presents an aggregate, projected, disputed, or merely reported figure as direct or approved savings/iu);
});
