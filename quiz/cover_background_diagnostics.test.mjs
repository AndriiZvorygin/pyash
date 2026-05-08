import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { diagnoseCoverBackground } from "../program/library/reporter_shared/cover-background-diagnostics.mjs";
import { runCoverOverlayStage } from "../program/library/reporter_shared/cover-overlay-stage.mjs";

function mkTmpDir(prefix = "cover-bg-diag-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeImage(color, out) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=512x512`, "-frames:v", "1", out]);
    let err = "";
    child.stderr.on("data", (c) => { err += String(c || ""); });
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(err)));
    child.on("error", reject);
  });
}

test("rejected overlay text overlap triggers stale_background_text_detected", async (t) => {
  const tmp = mkTmpDir();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bg = path.join(tmp, "bg.png");
  await makeImage("#606060", bg);
  const rep = path.join(tmp, "diag.pya");
  const out = await diagnoseCoverBackground({
    backgroundPath: bg,
    observedBackgroundText: "Easing The Burden On Local Businesses",
    selectedOverlayText: "Fourth Avenue One-Way Option Defeated",
    rejectedOverlayTexts: [{ text: "Easing The Burden On Local Businesses" }],
    sourceDisagreementDetected: true,
    promptText: "x",
    reportPath: rep,
  });
  assert.equal(out.staleBackgroundTextDetected, true);
  assert.ok(out.failureReasons.includes("stale_background_text_detected"));
  assert.equal(fs.existsSync(rep), true);
});

test("final mostly black composite fails when final background usefulness is false", async (t) => {
  const tmp = mkTmpDir();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const out = path.join(tmp, "final.png");
  fs.writeFileSync(out, "x");
  const reports = {
    input: path.join(tmp, "i.pya"),
    derived: path.join(tmp, "d.pya"),
    verify: path.join(tmp, "v.pya"),
    final: path.join(tmp, "f.pya"),
  };
  await assert.rejects(() => runCoverOverlayStage({
    stageInput: { overlayText: "Fourth Avenue One-Way Option Defeated", outputPath: out, imageSizeTarget: 0, backgroundUseful: true },
    deriveOverlay: ({ overlayText }) => ({ finalOverlayText: overlayText }),
    observeOverlay: async ({ overlayText }) => ({ observedText: overlayText, observedAllText: overlayText }),
    verifyOverlay: () => ({ pass: true, failures: [], warnings: [] }),
    renderDeterministic: async ({ outputPath }) => ({ outputPath, exactOverlayDrawn: true, layoutContractPass: true, outputExists: true, dimensions: { width: 0, height: 0 } }),
    reports,
    diagnoseFinalBackground: async () => ({ backgroundUseful: false, flatBackgroundDetected: true, visualUsefulnessMetrics: { nearBlackPixelRatio: 0.95, luminanceVariance: 10 } }),
  }));
});

test("abstract fallback fails relevance by default", async (t) => {
  const tmp = mkTmpDir();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bg = path.join(tmp, "bg.png");
  await makeImage("#4a6ea8", bg);
  const out = await diagnoseCoverBackground({
    backgroundPath: bg,
    backgroundKind: "abstract_fallback",
    abstractFallbackAllowed: false,
    promptText: "safe_background_fallback",
  });
  assert.equal(out.backgroundRelevancePass, false);
  assert.ok(out.failureReasons.includes("relevant_background_unavailable"));
  assert.equal(out.finalPublishableCover, false);
});
