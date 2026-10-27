import assert from "node:assert/strict";
import test from "node:test";

import {
  groundedCrisisServiceLanguage,
  verifyArticleClaims,
} from "../program/library/reporter_shared/quality-verifiers.mjs";

test("article claim verification accepts grounded crisis-service terminology", () => {
  const source = "The application would convert the vacant building into a crisis residence.";

  assert.equal(
    groundedCrisisServiceLanguage(
      "Council considered converting the vacant building into a crisis residence.",
      source,
    ),
    true,
  );
  assert.equal(
    groundedCrisisServiceLanguage(
      "The funding shortfall created a crisis for the municipality.",
      source,
    ),
    false,
  );
});

test("video-only article claims can use verified chapter summaries for outcome grounding", () => {
  const body = [
    "## Whole Stream Summary",
    "The board reviewed a range of operational matters. The city rejected requests for a water filling station due to cost concerns.",
  ].join("\n");
  const withoutChapters = verifyArticleClaims({
    bodyMarkdown: body,
    meetingSummaryMd: body,
  });
  assert.equal(withoutChapters.blocked, true);

  const withChapters = verifyArticleClaims({
    bodyMarkdown: body,
    meetingSummaryMd: body,
    chapterSummaryMd: "## Police Station Maintenance and Water Filling Station\n\nParticipants note that requests for a water filling station have been rejected by the city due to cost concerns.",
  });
  assert.equal(withChapters.blocked, false);
});
