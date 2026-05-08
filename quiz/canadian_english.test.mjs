import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCanadianEnglish } from "../program/library/reporter_shared/canadian-english.mjs";

test("normalizes common US spellings to Canadian spellings", () => {
  const src = "The City will organize a neighborhood program and summarize the color changes.";
  const out = normalizeCanadianEnglish(src);
  assert.match(out, /organise/u);
  assert.match(out, /neighbourhood/u);
  assert.match(out, /programme/u);
  assert.match(out, /summarise/u);
  assert.match(out, /colour/u);
});

test("preserves capitalization", () => {
  const src = "ORGANIZE Organize organize";
  const out = normalizeCanadianEnglish(src);
  assert.equal(out, "ORGANISE Organise organise");
});
