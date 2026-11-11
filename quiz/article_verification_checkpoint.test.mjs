import test from "node:test";
import assert from "node:assert/strict";

import {
  articleClaimsVerificationNeedsRetry,
  buildArticleVerificationRetryFeedback,
} from "../program/library/reporter_shared/article-verification-checkpoint.mjs";

const cleanSummary = {
  "has error": false,
  "rewritten count": 0,
  "removed count": 0,
  "unresolved high severity count": 0,
};

test("a missing verification summary needs a retry", () => {
  assert.equal(articleClaimsVerificationNeedsRetry(null), true);
  assert.equal(articleClaimsVerificationNeedsRetry(undefined), true);
});

test("a summary that is not a map needs a retry", () => {
  assert.equal(articleClaimsVerificationNeedsRetry("ok"), true);
  assert.equal(articleClaimsVerificationNeedsRetry([cleanSummary]), true);
});

test("a clean summary does not need a retry", () => {
  assert.equal(articleClaimsVerificationNeedsRetry(cleanSummary), false);
});

test("a blocked verification needs a retry", () => {
  assert.equal(articleClaimsVerificationNeedsRetry({ ...cleanSummary, "has error": true }), true);
});

test("a removed, rewritten or unresolved claim needs a retry", () => {
  assert.equal(articleClaimsVerificationNeedsRetry({ ...cleanSummary, "removed count": 1 }), true);
  assert.equal(articleClaimsVerificationNeedsRetry({ ...cleanSummary, "rewritten count": 2 }), true);
  assert.equal(
    articleClaimsVerificationNeedsRetry({ ...cleanSummary, "unresolved high severity count": 1 }),
    true
  );
});

test("a clean report produces no retry feedback", () => {
  const feedback = buildArticleVerificationRetryFeedback({ summary: cleanSummary, findings: [] });
  assert.equal(feedback, "");
});

test("a missing report produces retry feedback", () => {
  const feedback = buildArticleVerificationRetryFeedback(null);
  assert.match(feedback, /ARTICLE_VERIFICATION_RETRY/u);
  assert.match(feedback, /malformed or incomplete/u);
});

test("retry feedback quotes the rejected claim, its reason and its source anchor", () => {
  const feedback = buildArticleVerificationRetryFeedback({
    summary: { ...cleanSummary, "removed count": 1 },
    findings: [
      {
        "final action": "removed",
        "original sentence": "The council approved the whole budget.",
        "issue type": "unsupported_claim",
        "source support snippet": "The council deferred the budget.",
      },
    ],
  });
  assert.match(feedback, /ARTICLE_VERIFICATION_RETRY/u);
  assert.match(feedback, /Rejected claim: The council approved the whole budget\./u);
  assert.match(feedback, /Reason: unsupported_claim/u);
  assert.match(feedback, /Source anchor: The council deferred the budget\./u);
});

test("retry feedback skips findings that were kept", () => {
  const feedback = buildArticleVerificationRetryFeedback({
    summary: { ...cleanSummary, "removed count": 1 },
    findings: [
      {
        "final action": "kept",
        "original sentence": "The council met on Tuesday.",
        "issue type": "none",
        "source support snippet": "matched",
      },
    ],
  });
  assert.doesNotMatch(feedback, /The council met on Tuesday\./u);
});
