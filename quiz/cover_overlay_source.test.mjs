import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { selectCoverOverlaySource, stripPostTitleBoilerplate, deriveFromOneSentence } from "../program/library/reporter_shared/cover-overlay-source.mjs";
import { runCoverPromptifyStage } from "../program/library/reporter_shared/cover-promptify-stage.mjs";

function mkTmpDir(prefix = "cover-overlay-source-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("final lemmy title beats stale meeting hook", () => {
  const tmp = mkTmpDir();
  const payload = path.join(tmp, "meeting-qwen-auto-normalized.lemmy-post.json");
  fs.writeFileSync(payload, JSON.stringify({
    title: "Fourth Avenue One-Way Option Defeated — Owen Sound Council Meeting - Regular Transcript — April 27, 2026",
  }), "utf8");
  const out = selectCoverOverlaySource({
    lemmyPostJsonPath: payload,
    meetingSummaryMd: "",
    meetingHookText: "Easing The Burden On Local Businesses",
  });
  assert.equal(out.overlaySource, "lemmy_payload_title");
  assert.equal(out.selectedOverlayText, "Fourth Avenue One-Way Option Defeated");
  assert.equal(out.sourceDisagreementDetected, true);
});

test("boilerplate suffix is removed from post title", () => {
  const t = "Fourth Avenue One-Way Option Defeated — Owen Sound Council Meeting - Regular Transcript — April 27, 2026";
  assert.equal(stripPostTitleBoilerplate(t), "Fourth Avenue One-Way Option Defeated");
});

test("one sentence summary derives deferred to year overlay", () => {
  const s = "On April 27, 2026, council deferred Fourth Avenue to 2027.";
  assert.equal(deriveFromOneSentence(s), "Fourth Avenue Deferred To 2027");
});

test("stale business hook rejected when final title is fourth avenue", () => {
  const tmp = mkTmpDir();
  const payload = path.join(tmp, "meeting-qwen-auto-normalized.lemmy-post.json");
  fs.writeFileSync(payload, JSON.stringify({
    title: "Fourth Avenue One-Way Option Defeated — Owen Sound Council Meeting - Regular Transcript — April 27, 2026",
  }), "utf8");
  const out = selectCoverOverlaySource({
    lemmyPostJsonPath: payload,
    meetingSummaryMd: "",
    meetingHookText: "Easing The Burden On Local Businesses",
  });
  assert.ok(out.rejectedOverlayTexts.some((r) => r.text === "Easing The Burden On Local Businesses"));
});

test("promptify for fourth avenue picks roadwork/street civic subject", () => {
  const out = runCoverPromptifyStage({
    hookText: "Fourth Avenue One-Way Option Defeated",
    overlayText: "Fourth Avenue One-Way Option Defeated",
    oneSentenceSummary: "On April 27, 2026, council deferred Fourth Avenue to 2027.",
    topNews: "Fourth Avenue project deferred",
  });
  assert.match(out.selectedVisualSubject, /roadway|corridor|infrastructure|street|roadwork/iu);
});
