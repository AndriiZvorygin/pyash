import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

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

test("programmatic boundary finds markdown speaker heading for qa style", () => {
  const source = [
    "Topics: balancing love and wisdom.",
    "",
    "#### Q'uo",
    "Opening answer text that runs long enough to push the next speaker marker later into the chip for selection.",
    "",
    "#### M",
    "How can we consciously balance love and wisdom?",
    "",
    "#### Q'uo",
    "We would suggest patience."
  ].join("\n");
  const style = "Create wise chips where each chip contains one full question and its full corresponding answer.";
  assert.equal(findProgrammaticBoundary(source, style), "#### M\nHow can we consciously balance love and wisdom?");
});

test("programmatic boundary handles escaped newlines in qa style chips", () => {
  const source = "Topics\\n\\n#### Q'uo\\n\\nOpening words.\\n\\n#### M\\n\\nHow can we serve?\\n\\n#### Q'uo\\n\\nServe with love.";
  const style = "Create wise chips where each chip contains one full question and its full corresponding answer.";
  assert.equal(findProgrammaticBoundary(source, style), "#### M\n\nHow can we serve?");
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

test("programmatic boundary command accepts raw stdin split payload", () => {
  const source = [
    "Intro line.",
    "",
    "Long opening to push the marker deeper into the chip.",
    "",
    "#### M",
    "How can we serve?",
    "",
    "#### Q'uo",
    "Serve with love."
  ].join("\n");
  const style = "Create wise chips where each chip contains one full question and its full corresponding answer.";
  const proc = spawnSync("node", ["command/chip_programmatic_boundary.mjs"], {
    cwd: process.cwd(),
    input: `${source}\n<<<PYA_CHIP_STYLE>>>\n${style}`,
    encoding: "utf8"
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(proc.stdout.trim(), "#### M\nHow can we serve?");
});
