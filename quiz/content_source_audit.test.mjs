import assert from "node:assert/strict";
import test from "node:test";

import { auditRenderedContent } from "../program/library/reporter_shared/content-source-audit.mjs";

test("content audit accepts a supported decision in a composite meeting source", () => {
  const result = auditRenderedContent({
    renderedText: "The committee reviewed the water treatment project and approved the materials stewardship agreement.",
    sourceTexts: [
      "The committee reviewed the water treatment project.",
      "The committee approved the materials stewardship agreement.",
    ],
  });

  assert.deepEqual(result.unsupportedOutcomeVerbs, []);
  assert.equal(result.roleUpgradeDetected, false);
});

test("content audit blocks an outcome absent from the source", () => {
  const result = auditRenderedContent({
    renderedText: "Council approved a public forum request.",
    sourceTexts: ["Public Forum participants requested changes; no disposition was recorded."],
  });

  assert.deepEqual(result.unsupportedOutcomeVerbs, ["approved"]);
  assert.equal(result.roleUpgradeDetected, true);
});

test("content audit blocks an agenda role absent from authoritative source text", () => {
  const result = auditRenderedContent({
    renderedText: "The committee heard a deputation about the staff report.",
    sourceTexts: ["The committee reviewed the staff report."],
  });

  assert.deepEqual(result.unsupportedRoles, ["deputation"]);
  assert.equal(result.roleUpgradeDetected, true);
});
