import assert from "node:assert/strict";
import test from "node:test";

import { groundedCrisisServiceLanguage } from "../program/library/reporter_shared/quality-verifiers.mjs";

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
