import test from "node:test";
import assert from "node:assert/strict";

import {
  deterministicChapterChecks,
  normalizeChips,
  sanitizeModelTitle,
  fallbackTopicTitle
} from "../command/wise_chip_series_to_chapters.mjs";

test("chapter heading checks fail clipped and speaker-labeled titles", () => {
  const result = deterministicChapterChecks({
    title: "SPEAKER 07 Critical Minerals And",
    previousTitle: "",
    nextTitle: "",
    maxWords: 8
  });
  assert.equal(result.pass, false);
  assert.match(result.issues.join(" "), /speaker|stopword/i);
});

test("chapter heading checks fail near-duplicate neighboring titles", () => {
  const result = deterministicChapterChecks({
    title: "Diesel Prices And Middle East Oil Supply",
    previousTitle: "Diesel Price Surge And Middle East Oil Supply",
    nextTitle: "",
    maxWords: 8
  });
  assert.equal(result.pass, false);
  assert.match(result.issues.join(" "), /previous heading/i);
});

test("normalize chips merges tiny trailing signoff chip", () => {
  const merged = normalizeChips([
    { since: 0, until: 100, text: "Main discussion." },
    { since: 101, until: 110, text: "Okay, ended the livestream." }
  ]);
  assert.equal(merged.length, 1);
  assert.match(String(merged[0]?.text ?? ""), /Main discussion.*livestream/u);
});

test("sanitize model title preserves coherent short titles", () => {
  const title = sanitizeModelTitle("Why Solar Payback Is One Hundred Times Slower Than Oil", 8);
  assert.equal(title, "Why Solar Payback Is One Hundred Times Slower Than Oil");
});

test("fallback topic title removes speaker tags and filler", () => {
  const title = fallbackTopicTitle("[SPEAKER_07] okay um critical minerals are harder to find and lower grade", 8);
  assert.doesNotMatch(title, /SPEAKER|Okay|Um/u);
  assert.match(title, /Critical Minerals/u);
});
