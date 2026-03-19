import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLearnCard } from "../command/normalize_learn_card.mjs";

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
