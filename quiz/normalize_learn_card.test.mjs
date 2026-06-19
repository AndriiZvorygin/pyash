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
