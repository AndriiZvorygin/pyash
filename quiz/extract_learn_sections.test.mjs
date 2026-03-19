import test from "node:test";
import assert from "node:assert/strict";

import { extractLearnSections } from "../command/extract_learn_sections.mjs";

test("extract learn sections returns only requested headings in schema order", () => {
  const source = `
SEED CONCEPT
seed line

CARDINAL TRAINING SENTENCE
train line

TEACHING PROGRESSION
- first stage

ORTHOGONAL FEATURES
- feature

SURPRISES AND MISUNDERSTANDINGS
- surprise

AFFAIRS OR ACTIVITIES
- activity

CONCEPT RELATIONS
- relation
`.trim();

  assert.equal(
    extractLearnSections(source, ["SURPRISES AND MISUNDERSTANDINGS", "ORTHOGONAL FEATURES"]),
    [
      "ORTHOGONAL FEATURES",
      "- feature",
      "",
      "SURPRISES AND MISUNDERSTANDINGS",
      "- surprise"
    ].join("\n")
  );
});
