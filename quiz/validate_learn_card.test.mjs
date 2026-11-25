import test from "node:test";
import assert from "node:assert/strict";

import { validateLearnCard } from "../command/validate_learn_card.mjs";
import { RADIO_HEADINGS, SCHEMA_HEADINGS } from "../program/library/learn_card_headings.mjs";

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

test("validateLearnCard accepts a radio card with the radio headings", () => {
  const card = [
    "SEED CONCEPT",
    "seed",
    "",
    "CARDINAL TRAINING SENTENCE",
    "sentence",
    "",
    "TEACHING PROGRESSION",
    "- first understand",
    "- then share",
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
    "- Fourth phrase"
  ].join("\n");
  assert.equal(validateLearnCard(card, RADIO_HEADINGS), "");
});

test("validateLearnCard names the heading a radio card is missing", () => {
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
    "CAUSATIVE AND CONSEQUENCE",
    "- cause",
    "",
    "CARDINAL SCENES AND IDIOMS",
    "- scene"
  ].join("\n");
  assert.match(validateLearnCard(card, RADIO_HEADINGS), /missing heading BRIEF MEMORY PHRASES/u);
});

test("validateLearnCard reads the sections of a full card even when the radio headings are asked for", () => {
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
  assert.equal(validateLearnCard(card, RADIO_HEADINGS), "",
    "the sections of a full card end at the schema's headings, not at the radio's");
});

test("validateLearnCard lets a radio hook run to eight words", () => {
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
    "CAUSATIVE AND CONSEQUENCE",
    "- cause",
    "",
    "CARDINAL SCENES AND IDIOMS",
    "- scene",
    "",
    "BRIEF MEMORY PHRASES",
    "- Give with an open and generous heart",
    "- Nothing is lost when you share the light",
    "- Serve others as if they are yourself",
    "- Your spirit is never depleted by love"
  ].join("\n");
  assert.equal(validateLearnCard(card, RADIO_HEADINGS), "", "a song hook may run to eight words");

  const fullCard = [
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
    "- Give with an open and generous heart",
    "- Nothing is lost when you share the light",
    "- Serve others as if they are yourself",
    "- Your spirit is never depleted by love",
    "",
    "CONCEPT RELATIONS",
    "- relation"
  ].join("\n");
  assert.match(validateLearnCard(fullCard, SCHEMA_HEADINGS), /2-6 words/u, "the teaching card keeps its phrases short");
});
