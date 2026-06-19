import test from "node:test";
import assert from "node:assert/strict";

import { extractVerifierScore } from "../command/extract_verifier_score.mjs";

test("extractVerifierScore reads clean final score lines", () => {
  assert.equal(extractVerifierScore("reason\n0.9"), "0.9");
  assert.equal(extractVerifierScore("reason\nPASS"), "1");
  assert.equal(extractVerifierScore("reason\nFAIL"), "0");
});

test("extractVerifierScore reads trailing score at end of rationale paragraph", () => {
  assert.equal(extractVerifierScore("The teaching remains faithful and source grounded. 1.0"), "1.0");
});
