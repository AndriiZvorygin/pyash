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
    "- First phrase",
    "- Second phrase",
    "- Third phrase",
    "- Fourth phrase",
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
    "- First phrase",
    "- Second phrase",
    "- Third phrase",
    "- Fourth phrase",
    "",
    "CONCEPT RELATIONS",
    "- relation"
  ].join("\n");

  assert.match(validateLearnCard(card), /empty section CAUSATIVE AND CONSEQUENCE/u);
});


test("validateLearnCard rejects brief memory phrases as a paragraph block", () => {
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
    "Joy grows through shared service, gratitude, and inner turning rather than control.",
    "",
    "CONCEPT RELATIONS",
    "- relation"
  ].join("\n");

  assert.match(validateLearnCard(card), /BRIEF MEMORY PHRASES must contain 4-8 dash list items/u);
});

test("validateLearnCard rejects verbose brief memory phrase items", () => {
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
    "- Joy grows through shared service with gratitude",
    "- Second phrase",
    "- Third phrase",
    "- Fourth phrase",
    "",
    "CONCEPT RELATIONS",
    "- relation"
  ].join("\n");

  assert.match(validateLearnCard(card), /BRIEF MEMORY PHRASES item must be 2-6 words/u);
});


test("validateLearnCard rejects brief memory phrases ending with dangling connectors", () => {
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
    "- Joy is a creative force not",
    "- Second phrase",
    "- Third phrase",
    "- Fourth phrase",
    "",
    "CONCEPT RELATIONS",
    "- relation"
  ].join("\n");

  assert.match(validateLearnCard(card), /BRIEF MEMORY PHRASES item ends with dangling connector/u);
});
