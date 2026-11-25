import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLearnCard } from "../command/normalize_learn_card.mjs";
import { RADIO_HEADINGS, SCHEMA_HEADINGS } from "../program/library/learn_card_headings.mjs";

test("normalizeLearnCard canonicalizes known heading near-misses", () => {
  const source = [
    "SEED CONCEPT",
    "Power is inward.",
    "",
    "CARDINAL TRAINING SENTENCE",
    "Power moves through consciousness.",
    "",
    "ORTHOGENAL FEATURES",
    "- Quiet strength matters."
  ].join("\n");
  const normalized = normalizeLearnCard(source);
  assert.match(normalized, /\nORTHOGONAL FEATURES\n/u);
  assert.doesNotMatch(normalized, /\nORTHOGENAL FEATURES\n/u);
});

test("normalizeLearnCard canonicalizes broader orthogonal heading variants", () => {
  const source = [
    "SEED CONCEPT",
    "Power is inward.",
    "",
    "CARDINAL TRAINING SENTENCE",
    "Power moves through consciousness.",
    "",
    "ORTHOGRANAL FEATURES",
    "- Quiet strength matters."
  ].join("\n");
  const normalized = normalizeLearnCard(source);
  assert.match(normalized, /\nORTHOGONAL FEATURES\n/u);
  assert.doesNotMatch(normalized, /\nORTHOGRANAL FEATURES\n/u);
});


test("normalizeLearnCard repairs prose brief memory phrases into dash items", () => {
  const source = [
    "SEED CONCEPT",
    "Joy is inward.",
    "",
    "BRIEF MEMORY PHRASES",
    "Joy comes uninvited sometimes and stays always still. Let go and let light flow in clearly now. Beauty flows even when hidden away from view. Praise turns loss into service again for all.",
    "",
    "CONCEPT RELATIONS",
    "- Joy relates to service."
  ].join("\n");

  const normalized = normalizeLearnCard(source);

  assert.ok(normalized.includes([
    "BRIEF MEMORY PHRASES",
    "- Joy comes uninvited sometimes and stays",
    "- Let go and let light flow",
    "- Beauty flows even when hidden away",
    "- Praise turns loss into service again"
  ].join("\n")));
});

test("normalizeLearnCard keeps a whole radio hook that runs to eight words", async () => {
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

  const radio = normalizeLearnCard(card, RADIO_HEADINGS);
  assert.match(radio, /- Give with an open and generous heart/u, "a song hook is not cut in half");
  assert.match(radio, /- Nothing is lost when you share the light/u);
  assert.match(radio, /- Serve others as if they are yourself/u);

  const full = normalizeLearnCard(card, SCHEMA_HEADINGS);
  assert.match(full, /- Give with an open and generous$/mu, "the teaching card keeps its phrases short");
});

test("normalizeLearnCard splits a long phrase into whole clauses", () => {
  const card = [
    "BRIEF MEMORY PHRASES",
    "Fear closes the door; love opens it wide.",
    "Nothing is lost when you share the light.",
    "True abundance grows from giving away.",
    "Your spirit is never depleted by love."
  ].join("\n");

  const radio = normalizeLearnCard(card, RADIO_HEADINGS);
  assert.match(radio, /- Fear closes the door/u);
  assert.match(radio, /- love opens it wide/u);
  assert.match(radio, /- Nothing is lost when you share the light/u);
});
