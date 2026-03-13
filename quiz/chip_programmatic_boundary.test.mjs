import test from "node:test";
import assert from "node:assert/strict";

import { findProgrammaticBoundary } from "../command/chip_programmatic_boundary.mjs";

test("programmatic boundary finds questioner marker for qa style", () => {
  const source = [
    "Intro line.",
    "",
    "This is some preface text that runs long enough to push the marker later in the chip for selection.",
    "",
    "Questioner: How should we understand catalyst?",
    "Q'uo: We would suggest patience."
  ].join("\n");
  const style = "Create wise chips where each chip contains one full question and its full corresponding answer.";
  assert.equal(findProgrammaticBoundary(source, style), "Questioner: How should we understand catalyst?");
});

test("programmatic boundary finds markdown heading for heading style", () => {
  const source = [
    "Opening remarks that fill the lead.",
    "",
    "More setup text to move the useful marker deeper into the chip for a realistic selection case.",
    "",
    "## Agenda Item Two",
    "Discussion follows."
  ].join("\n");
  const style = "Create wise chips that each correspond to one agenda item with its discussion.";
  assert.equal(findProgrammaticBoundary(source, style), "## Agenda Item Two");
});

test("programmatic boundary returns empty string when no structural marker exists", () => {
  const source = "Plain prose without headings or explicit question markers.";
  const style = "Create wise chips that each capture one coherent section.";
  assert.equal(findProgrammaticBoundary(source, style), "");
});
