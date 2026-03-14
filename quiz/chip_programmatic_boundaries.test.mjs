import test from "node:test";
import assert from "node:assert/strict";

import { findProgrammaticBoundaries } from "../command/chip_programmatic_boundary.mjs";

test("chip programmatic boundaries returns all qa markers from full source", () => {
  const source = [
    "#### Q’uo",
    "Opening invocation",
    "",
    "#### J",
    "Question one?",
    "",
    "#### Q’uo",
    "Answer one",
    "",
    "#### N",
    "Question two?",
    "",
    "#### Q’uo",
    "Answer two",
    "",
    "#### G",
    "Question three?"
  ].join("\n");
  const style = "Create wise chips where each chip contains one full question and its full corresponding answer.";
  const markers = findProgrammaticBoundaries(source, style);
  assert.equal(markers.length, 3);
  assert.match(markers[0], /^#### J\nQuestion one\?/u);
  assert.match(markers[1], /^#### N\nQuestion two\?/u);
  assert.match(markers[2], /^#### G\nQuestion three\?/u);
});

test("chip programmatic boundaries preserves repeated speaker markers in order", () => {
  const source = [
    "#### J",
    "Question one?",
    "",
    "#### Q’uo",
    "Answer one",
    "",
    "#### J",
    "Question two?",
    "",
    "#### Q’uo",
    "Answer two",
    "",
    "#### J",
    "No, thank you.",
    "",
    "#### N",
    "Question three?"
  ].join("\n");
  const style = "Create wise chips where each chip contains one full question and its full corresponding answer.";
  const markers = findProgrammaticBoundaries(source, style);
  assert.equal(markers.length, 3);
  assert.match(markers[0], /^#### J\nQuestion one\?/u);
  assert.match(markers[1], /^#### J\nQuestion two\?/u);
  assert.match(markers[2], /^#### N\nQuestion three\?/u);
});
