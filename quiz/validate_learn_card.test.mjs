import test from "node:test";
import assert from "node:assert/strict";

import { validateLearnCard } from "../command/validate_learn_card.mjs";

test("validateLearnCard accepts a full learn card", () => {
  const card = [
    "SEED CONCEPT",
    "seed",
    "",
    "CARDINAL TRAINING SENTENCE",
    "sentence",
    "",
    "TEACHING PROGRESSION",
    "- first understand",
    "",
    "ORTHOGONAL FEATURES",
    "- feature",
    "",
    "SURPRISES AND MISUNDERSTANDINGS",
    "- surprise",
    "",
    "AFFAIRS OR ACTIVITIES",
    "- activity",
    "",
    "CAUSATIVE AND CONSEQUENCE",
    "- cause",
    "",
    "CARDINAL SCENES AND IDIOMS",
    "- scene",
    "",
    "BRIEF MEMORY PHRASES",
    "- phrase",
    "",
    "CONCEPT RELATIONS",
    "- relation"
  ].join("\n");

  assert.equal(validateLearnCard(card), "");
});

test("validateLearnCard rejects missing headings", () => {
  const card = [
    "SEED CONCEPT",
    "seed",
    "",
    "CARDINAL TRAINING SENTENCE",
    "sentence"
  ].join("\n");

  assert.match(validateLearnCard(card), /missing heading TEACHING PROGRESSION/u);
});

test("validateLearnCard rejects empty sections", () => {
  const card = [
    "SEED CONCEPT",
    "seed",
    "",
    "CARDINAL TRAINING SENTENCE",
    "sentence",
    "",
    "TEACHING PROGRESSION",
    "- first understand",
    "",
    "ORTHOGONAL FEATURES",
    "- feature",
    "",
    "SURPRISES AND MISUNDERSTANDINGS",
    "- surprise",
    "",
    "AFFAIRS OR ACTIVITIES",
    "- activity",
    "",
    "CAUSATIVE AND CONSEQUENCE",
    "-",
    "",
    "CARDINAL SCENES AND IDIOMS",
    "- scene",
    "",
    "BRIEF MEMORY PHRASES",
    "- phrase",
    "",
    "CONCEPT RELATIONS",
    "- relation"
  ].join("\n");

  assert.match(validateLearnCard(card), /empty section CAUSATIVE AND CONSEQUENCE/u);
});
