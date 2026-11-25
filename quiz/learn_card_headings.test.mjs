import test from "node:test";
import assert from "node:assert/strict";

import {
  CARD_DEPTHS,
  DEFAULT_CARD_DEPTH,
  RADIO_HEADINGS,
  SCHEMA_HEADINGS,
  cardMatchesDepth,
  headingsForDepth,
  headingsFromArgument,
  headingsFromValue,
  headingsInText
} from "../program/library/learn_card_headings.mjs";

const RADIO_CARD = [
  "SEED CONCEPT",
  "The light we carry is the light we give.",
  "",
  "CARDINAL TRAINING SENTENCE",
  "We carry the light we give.",
  "",
  "TEACHING PROGRESSION",
  "- We notice the light",
  "- We share the light",
  "- We become the light",
  "",
  "CAUSATIVE AND CONSEQUENCE",
  "- We give, and we receive",
  "",
  "CARDINAL SCENES AND IDIOMS",
  "- A lamp carried through the dark",
  "",
  "BRIEF MEMORY PHRASES",
  "- We carry the light",
  "- The light we give",
  "- A lamp in the dark",
  "- We share what we are"
].join("\n");

const FULL_CARD = [
  "SEED CONCEPT",
  "The light we carry is the light we give.",
  "",
  "CARDINAL TRAINING SENTENCE",
  "We carry the light we give.",
  "",
  "TEACHING PROGRESSION",
  "- We notice the light",
  "",
  "ORTHOGONAL FEATURES",
  "- The light is sacred",
  "",
  "SURPRISES AND MISUNDERSTANDINGS",
  "- Light is not kept",
  "",
  "AFFAIRS OR ACTIVITIES",
  "- We carry a lamp",
  "",
  "CAUSATIVE AND CONSEQUENCE",
  "- We give, and we receive",
  "",
  "CARDINAL SCENES AND IDIOMS",
  "- A lamp carried through the dark",
  "",
  "BRIEF MEMORY PHRASES",
  "- We carry the light",
  "- The light we give",
  "- A lamp in the dark",
  "- We share what we are",
  "",
  "CONCEPT RELATIONS",
  "- Light answers darkness"
].join("\n");

test("the radio card keeps only the headings a song uses", () => {
  assert.deepEqual(RADIO_HEADINGS, [
    "SEED CONCEPT",
    "CARDINAL TRAINING SENTENCE",
    "TEACHING PROGRESSION",
    "CAUSATIVE AND CONSEQUENCE",
    "CARDINAL SCENES AND IDIOMS",
    "BRIEF MEMORY PHRASES"
  ]);
  for (const heading of RADIO_HEADINGS) {
    assert.ok(SCHEMA_HEADINGS.includes(heading), `${heading} is a heading of the full card`);
  }
  assert.ok(RADIO_HEADINGS.length < SCHEMA_HEADINGS.length, "the radio card is the lean one");
});

test("a depth names its headings and an unknown depth is the full card", () => {
  assert.deepEqual(headingsForDepth("radio"), RADIO_HEADINGS);
  assert.deepEqual(headingsForDepth("RADIO"), RADIO_HEADINGS);
  assert.deepEqual(headingsForDepth("full"), SCHEMA_HEADINGS);
  assert.deepEqual(headingsForDepth(""), SCHEMA_HEADINGS);
  assert.deepEqual(headingsForDepth("nonsense"), SCHEMA_HEADINGS, "an unknown depth is the safe card");
  assert.equal(DEFAULT_CARD_DEPTH, "full");
  assert.ok(CARD_DEPTHS.has("radio"));
});

test("the headings argument takes a depth or the headings themselves", () => {
  assert.deepEqual(headingsFromValue("radio"), RADIO_HEADINGS);
  assert.deepEqual(headingsFromValue("full"), SCHEMA_HEADINGS);
  assert.deepEqual(headingsFromValue(""), SCHEMA_HEADINGS);
  assert.deepEqual(headingsFromValue("seed concept, brief memory phrases"), [
    "SEED CONCEPT",
    "BRIEF MEMORY PHRASES"
  ]);
  assert.deepEqual(headingsFromValue("nonsense"), SCHEMA_HEADINGS, "a value that names no headings is the full card");
});

test("the headings argument reads the command line", () => {
  assert.deepEqual(headingsFromArgument(["--headings", "radio"]), RADIO_HEADINGS);
  assert.deepEqual(headingsFromArgument(["--headings", "radio", "--other"]), RADIO_HEADINGS);
  assert.deepEqual(headingsFromArgument([]), SCHEMA_HEADINGS);
  assert.deepEqual(headingsFromArgument(["--headings"]), SCHEMA_HEADINGS, "a missing value is the full card");
});

test("the headings of a card are the headings it carries", () => {
  assert.deepEqual(headingsInText(RADIO_CARD), RADIO_HEADINGS);
  assert.deepEqual(headingsInText(FULL_CARD), SCHEMA_HEADINGS);
  assert.deepEqual(headingsInText("SEED CONCEPT\nnothing else\n"), ["SEED CONCEPT"]);
  assert.deepEqual(headingsInText(""), []);
});

test("a card is the card of a depth only when it carries that depth's headings", () => {
  assert.equal(cardMatchesDepth(RADIO_CARD, "radio"), true);
  assert.equal(cardMatchesDepth(RADIO_CARD, "full"), false, "the radio card is not the full card");
  assert.equal(cardMatchesDepth(FULL_CARD, "full"), true);
  assert.equal(cardMatchesDepth(FULL_CARD, "radio"), false, "the full card is not the radio card");
  assert.equal(cardMatchesDepth("", "radio"), false);
});
