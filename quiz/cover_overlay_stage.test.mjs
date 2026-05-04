import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  deriveCoverOverlayText,
  verifyCoverOverlayText,
  writePyaReport,
  renderDeterministicOverlay,
  runCoverOverlayStage,
} from "../program/library/reporter_shared/cover-overlay-stage.mjs";
import { buildBackgroundPromptSpec } from "../program/library/reporter_shared/cover-prompt-policy.mjs";

function mkTmpDir(prefix = "cover-overlay-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("derive overlay preserves trailing year", () => {
  const out = deriveCoverOverlayText({ sourceText: "Fourth Avenue Delayed Until 2027", minWords: 3, maxWords: 6 });
  assert.equal(out.finalOverlayText, "Fourth Avenue Delayed Until 2027");
  assert.ok(out.preservedTokens.includes("2027"));
});

test("derive overlay preserves numeric token in longer phrase", () => {
  const out = deriveCoverOverlayText({ sourceText: "Operations Committee Reviews Proposed 2026 Fees for Food Trucks", minWords: 3, maxWords: 6 });
  assert.ok(/\b2026\b/u.test(out.finalOverlayText));
});

test("derive overlay avoids adjacent duplicate requested tokens", () => {
  const out = deriveCoverOverlayText({ sourceText: "Delayed Delayed Until 2027", minWords: 3, maxWords: 6 });
  assert.equal(out.finalOverlayText, "Delayed Until 2027");
});

test("verifier rejects adjacent duplicate observed tokens", () => {
  const v = verifyCoverOverlayText({
    expectedText: "Fourth Avenue Delayed Until 2027",
    observedText: "Fourth Avenue Delayed Delayed Until",
  });
  assert.equal(v.pass, false);
  assert.ok(v.failures.includes("adjacent_duplicate_tokens"));
});

test("verifier rejects missing year", () => {
  const v = verifyCoverOverlayText({
    expectedText: "Fourth Avenue Delayed Until 2027",
    observedText: "Fourth Avenue Delayed Until",
  });
  assert.equal(v.pass, false);
  assert.ok(v.failures.includes("missing_year_token"));
});

test("verifier rejects missing numeric amount percentage", () => {
  const v = verifyCoverOverlayText({
    expectedText: "Property Tax Increase 5%",
    observedText: "Property Tax Increase",
  });
  assert.equal(v.pass, false);
  assert.ok(v.failures.includes("missing_essential_tokens"));
});

test("verifier accepts exact overlay", () => {
  const v = verifyCoverOverlayText({
    expectedText: "Fourth Avenue Project Deferred 2027",
    observedText: "Fourth Avenue Project Deferred 2027",
  });
  assert.equal(v.pass, true);
});

test("deterministic compositor creates image within target dimensions", async (t) => {
  const tmp = mkTmpDir();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bg = path.join(tmp, "bg.png");
  const out = path.join(tmp, "out.png");

  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=#203040:s=512x512", "-frames:v", "1", bg]);
    let err = "";
    child.stderr.on("data", (c) => { err += String(c || ""); });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err))));
    child.on("error", reject);
  });

  const meta = await renderDeterministicOverlay({ backgroundPath: bg, overlayText: "Fourth Avenue Deferred 2027", outputPath: out, size: 512 });
  assert.ok(fs.existsSync(out));
  assert.equal(meta.layoutContractPass, true);

  const probe = await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", out]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += String(c || ""); });
    child.stderr.on("data", (c) => { stderr += String(c || ""); });
    child.on("close", (code) => (code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr))));
    child.on("error", reject);
  });
  assert.equal(probe, "512x512");
});

test("report artefact writer uses .pya files", () => {
  const tmp = mkTmpDir("cover-overlay-pya-");
  const report = path.join(tmp, "cover-overlay.verify.pya");
  writePyaReport(report, { pass: true, expectedText: "Fourth Avenue Delayed Until 2027" });
  assert.ok(fs.existsSync(report));
  const text = fs.readFileSync(report, "utf8");
  assert.match(text, /pass is yes\./u);
  assert.match(text, /expectedText is "Fourth Avenue Delayed Until 2027"\./u);
});

test("april 27 regression fixture fails duplicate and missing year", () => {
  const derived = deriveCoverOverlayText({ sourceText: "Fourth Avenue Delayed Until 2027", minWords: 3, maxWords: 6 });
  assert.equal(derived.finalOverlayText, "Fourth Avenue Delayed Until 2027");
  const v = verifyCoverOverlayText({
    expectedText: derived.finalOverlayText,
    observedText: "Fourth Avenue Delayed Delayed Until",
  });
  assert.equal(v.pass, false);
  assert.ok(v.failures.includes("adjacent_duplicate_tokens"));
  assert.ok(v.failures.includes("missing_year_token"));
});

test("run stage writes verify/final when observe throws", async (t) => {
  const tmp = mkTmpDir("cover-stage-observe-throw-");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const out = path.join(tmp, "out.png");
  fs.writeFileSync(out, "x");

  const reports = {
    input: path.join(tmp, "cover-overlay.input.pya"),
    derived: path.join(tmp, "cover-overlay.derived.pya"),
    verify: path.join(tmp, "cover-overlay.verify.pya"),
    final: path.join(tmp, "cover-overlay.final.pya"),
  };

  await runCoverOverlayStage({
    stageInput: { overlayText: "Fourth Avenue Delayed Until 2027", outputPath: out, imageSizeTarget: 0 },
    deriveOverlay: ({ overlayText }) => ({ finalOverlayText: overlayText }),
    observeOverlay: async () => { throw new Error("observe boom"); },
    verifyOverlay: ({ finalOverlayText, observedText }) => verifyCoverOverlayText({ expectedText: finalOverlayText, observedText }),
    renderDeterministic: async ({ outputPath, finalOverlayText }) => {
      fs.writeFileSync(outputPath, finalOverlayText);
      return { outputPath, exactOverlayDrawn: true, layoutContractPass: true, outputExists: true, dimensions: { width: 0, height: 0 } };
    },
    reports,
  });

  assert.ok(fs.existsSync(reports.verify));
  assert.ok(fs.existsSync(reports.final));
  const verifyText = fs.readFileSync(reports.verify, "utf8");
  assert.match(verifyText, /candidateFailures count is/u);
  assert.match(verifyText, /fallbackAttempted is yes\./u);
});

test("candidate verification failure triggers deterministic fallback and acceptedMode deterministic_fallback", async (t) => {
  const tmp = mkTmpDir("cover-stage-fallback-");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const outputPath = path.join(tmp, "cover.png");
  const reports = {
    input: path.join(tmp, "cover-overlay.input.pya"),
    derived: path.join(tmp, "cover-overlay.derived.pya"),
    verify: path.join(tmp, "cover-overlay.verify.pya"),
    final: path.join(tmp, "cover-overlay.final.pya"),
  };
  let attempt = 0;

  const result = await runCoverOverlayStage({
    stageInput: { overlayText: "Fourth Avenue Delayed Until 2027", outputPath, imageSizeTarget: 0 },
    deriveOverlay: ({ overlayText }) => ({ finalOverlayText: overlayText }),
    observeOverlay: async () => {
      attempt += 1;
      if (attempt === 1) return { observedText: "Fourth Avenue Delayed Delayed Until" };
      throw new Error("ocr unavailable");
    },
    verifyOverlay: ({ finalOverlayText, observedText }) => verifyCoverOverlayText({ expectedText: finalOverlayText, observedText }),
    renderDeterministic: async ({ outputPath, finalOverlayText }) => {
      fs.writeFileSync(outputPath, finalOverlayText);
      return {
        outputPath,
        exactOverlayDrawn: true,
        layoutContractPass: true,
        outputExists: true,
        dimensions: { width: 512, height: 512 },
      };
    },
    reports,
  });

  assert.equal(result.final.acceptedMode, "deterministic_fallback");
  const verifyText = fs.readFileSync(reports.verify, "utf8");
  assert.match(verifyText, /acceptedMode is "deterministic_fallback"\./u);
  assert.match(verifyText, /candidatePass is no\./u);
});


test("verifier rejects extra background words beyond expected overlay", () => {
  const v = verifyCoverOverlayText({
    expectedText: "Easing The Burden On Local Businesses",
    observedText: "Easing The Burden On Local Businesses",
    observedAllText: "Easing The Burden On Local Businesses The Burden On Local Businesses",
    requireNoExtraVisibleText: true,
  });
  assert.equal(v.pass, false);
  assert.ok(v.failures.includes("extra_visible_text"));
});

test("prompt policy keeps overlay text out of positive prompt and puts exclusions in negative", () => {
  const spec = buildBackgroundPromptSpec({
    style: "editorial civic scene",
    hookText: "Fourth Avenue Delayed Until 2027",
    topNewsworthy: "Road project deferral",
    overlayText: "Easing The Burden On Local Businesses",
    imageTextMode: "deterministic",
  });
  const lower = spec.positivePrompt.toLowerCase();
  for (const banned of [" do not ", " without ", " exclude ", " avoid ", " no "]) {
    assert.equal(lower.includes(banned.trim()), false);
  }
  assert.equal(lower.includes("easing the burden on local businesses"), false);
  const neg = spec.negativePrompt.toLowerCase();
  for (const term of ["words","letters","numbers","signs","labels","captions","headline text","typography","watermark","logo","poster","banner","duplicated text","gibberish text"]) {
    assert.equal(neg.includes(term), true);
  }
  assert.equal(spec.modelOverlayText, "");
});

test("deterministic compositor returns transparent text layer metadata", async (t) => {
  const tmp = mkTmpDir("cover-overlay-layer-");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bg = path.join(tmp, "bg.png");
  const out = path.join(tmp, "out.png");
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=#203040:s=512x512", "-frames:v", "1", bg]);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("ffmpeg create bg failed")));
    child.on("error", reject);
  });
  const meta = await renderDeterministicOverlay({ backgroundPath: bg, overlayText: "Easing The Burden On Local Businesses", outputPath: out, size: 512 });
  assert.equal(Boolean(meta.textLayerPath), true);
  assert.equal(fs.existsSync(meta.textLayerPath), true);
  assert.equal(meta.overlayStyle.backplate.enabled, false);
  assert.equal(meta.textLayerHasAlpha, true);
  assert.ok(meta.textLayerTransparentPixelRatio > 0.75);
  assert.equal(meta.compositePreservedBackground, true);
});

test("hook becomes overlay text by default", () => {
  const hook = "Easing The Burden On Local Businesses";
  const derived = deriveCoverOverlayText({ sourceText: hook, minWords: 3, maxWords: 6 });
  assert.equal(derived.finalOverlayText, hook);
  assert.equal(derived.sourceUsedUnchanged, true);
  assert.equal(derived.sourceShortened, false);
});

test("derived report records whether hook was unchanged or shortened", () => {
  const unchanged = deriveCoverOverlayText({ sourceText: "Easing The Burden On Local Businesses", minWords: 3, maxWords: 6 });
  assert.equal(unchanged.sourceUsedUnchanged, true);
  const shortened = deriveCoverOverlayText({ sourceText: "Operations Committee Reviews Proposed 2026 Fees for Food Trucks", minWords: 3, maxWords: 6 });
  assert.equal(shortened.sourceShortened, true);
});

test("promptify infers visual subject from hook semantics", async () => {
  const { runCoverPromptifyStage } = await import("../program/library/reporter_shared/cover-promptify-stage.mjs");
  const out = runCoverPromptifyStage({
    hookText: "Easing The Burden On Local Businesses",
    overlayText: "Easing The Burden On Local Businesses",
    oneSentenceSummary: "Council reviewed costs for local operators.",
    topNews: "Patio permit barriers and business costs",
  });
  assert.match(out.selectedVisualSubject, /storefronts|business|downtown/iu);
  assert.equal(out.promptContainsOverlayText, false);
});

test("positive prompt does not contain hook verbatim in deterministic mode", () => {
  const spec = buildBackgroundPromptSpec({
    style: "editorial civic scene",
    hookText: "Easing The Burden On Local Businesses",
    topNewsworthy: "Patio permit barriers and business costs",
    overlayText: "Easing The Burden On Local Businesses",
    imageTextMode: "deterministic",
  });
  assert.equal(spec.positivePrompt.toLowerCase().includes("easing the burden on local businesses"), false);
});

test("overlay input report records hook and overlay text", async (t) => {
  const tmp = mkTmpDir("cover-stage-hook-input-");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const outputPath = path.join(tmp, "cover.png");
  const reports = {
    input: path.join(tmp, "cover-overlay.input.pya"),
    derived: path.join(tmp, "cover-overlay.derived.pya"),
    verify: path.join(tmp, "cover-overlay.verify.pya"),
    final: path.join(tmp, "cover-overlay.final.pya"),
  };

  await runCoverOverlayStage({
    stageInput: {
      hookText: "Easing The Burden On Local Businesses",
      overlayText: "Easing The Burden On Local Businesses",
      outputPath,
      imageSizeTarget: 0,
    },
    deriveOverlay: ({ overlayText }) => deriveCoverOverlayText({ sourceText: overlayText, minWords: 3, maxWords: 6 }),
    observeOverlay: async () => ({ observedText: "", observedAllText: "" }),
    verifyOverlay: ({ finalOverlayText, observedText, observedAllText }) => verifyCoverOverlayText({ expectedText: finalOverlayText, observedText, observedAllText }),
    renderDeterministic: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, "ok");
      return { outputPath, exactOverlayDrawn: true, layoutContractPass: true, outputExists: true, dimensions: { width: 0, height: 0 } };
    },
    reports,
  });

  const inputText = fs.readFileSync(reports.input, "utf8");
  assert.match(inputText, /hookText is "Easing The Burden On Local Businesses"\./u);
  assert.match(inputText, /overlayText is "Easing The Burden On Local Businesses"\./u);
});


test("black text-layer background/alpha flattening fails stage", async (t) => {
  const tmp = mkTmpDir("cover-stage-alpha-fail-");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const outputPath = path.join(tmp, "cover.png");
  fs.writeFileSync(outputPath, "x");
  const reports = {
    input: path.join(tmp, "cover-overlay.input.pya"),
    derived: path.join(tmp, "cover-overlay.derived.pya"),
    verify: path.join(tmp, "cover-overlay.verify.pya"),
    final: path.join(tmp, "cover-overlay.final.pya"),
  };
  await assert.rejects(() => runCoverOverlayStage({
    stageInput: { overlayText: "Fourth Avenue One-Way Option Defeated", outputPath, imageSizeTarget: 0, backgroundUseful: true },
    deriveOverlay: ({ overlayText }) => ({ finalOverlayText: overlayText }),
    observeOverlay: async () => ({ observedText: "", observedAllText: "" }),
    verifyOverlay: () => ({ pass: false, failures: ["force_fallback"], warnings: [] }),
    renderDeterministic: async ({ outputPath }) => ({
      outputPath,
      exactOverlayDrawn: true,
      layoutContractPass: true,
      outputExists: true,
      dimensions: { width: 512, height: 512 },
      textLayerHasAlpha: false,
      textLayerTransparentPixelRatio: 0,
      alphaFlatteningDetected: true,
      finalBackgroundSimilarity: 0.2,
      compositePreservedBackground: false,
    }),
    reports,
    diagnoseFinalBackground: async () => ({ backgroundUseful: true, visualUsefulnessMetrics: { nearBlackPixelRatio: 0.2, luminanceVariance: 1000 }, flatBackgroundDetected: false }),
  }));
});

test("final pass requires background relevance and disallows abstract fallback", async (t) => {
  const tmp = mkTmpDir();
  const out = path.join(tmp, "final.png");
  const reports = {
    input: path.join(tmp, "in.pya"),
    derived: path.join(tmp, "derived.pya"),
    verify: path.join(tmp, "verify.pya"),
    final: path.join(tmp, "final.pya"),
  };
  await assert.rejects(() => runCoverOverlayStage({
    stageInput: {
      overlayText: "Fourth Avenue One-Way Option Defeated",
      outputPath: out,
      imageSizeTarget: 512,
      backgroundUseful: true,
      backgroundRelevancePass: false,
      abstractFallbackUsed: true,
      abstractFallbackAllowed: false,
      backgroundKind: "abstract_fallback",
    },
    deriveOverlay: ({ overlayText }) => ({ finalOverlayText: overlayText }),
    observeOverlay: async ({ overlayText }) => ({ observedText: overlayText, observedAllText: overlayText }),
    verifyOverlay: () => ({ pass: true, failures: [], warnings: [] }),
    renderDeterministic: async ({ outputPath }) => ({ outputPath, exactOverlayDrawn: true, layoutContractPass: true, outputExists: true, dimensions: { width: 512, height: 512 } }),
    reports,
    diagnoseFinalBackground: async () => ({ backgroundUseful: true, backgroundRelevancePass: false, backgroundKind: "abstract_fallback", visualUsefulnessMetrics: { nearBlackPixelRatio: 0.1, luminanceVariance: 100 } }),
  }));
});

test("roadwork prompt uses object-level street terms and excludes text-inducing terms", () => {
  const spec = buildBackgroundPromptSpec({
    style: "editorial documentary background",
    hookText: "Fourth Avenue One-Way Option Defeated",
    topNewsworthy: "Council deferred the road project and rejected one-way option",
    visualSubject: "municipal roadway corridor with civic infrastructure context",
    overlayText: "Fourth Avenue One-Way Option Defeated",
    imageTextMode: "deterministic",
  });
  const p = spec.positivePrompt.toLowerCase();
  for (const term of ["traffic barrels", "barricades", "lane markings", "pavement"]) {
    assert.equal(p.includes(term), true);
  }
  for (const banned of ["civic-news", "poster", "headline", "title", "sign", "signage", "label", "fourth avenue one-way option defeated"]) {
    assert.equal(p.includes(banned), false);
  }
  const neg = spec.negativePrompt.toLowerCase();
  for (const term of ["billboard", "placard", "storefront signs", "road signs", "license plates"]) {
    assert.equal(neg.includes(term), true);
  }
});

test("retry prompt for synthetic text risk shifts to close-up roadwork framing", async () => {
  const { buildRetryPromptForBackgroundRisk } = await import("../program/library/reporter_shared/cover-promptify-stage.mjs");
  const retry = buildRetryPromptForBackgroundRisk({
    visualSubject: "municipal roadway corridor with civic infrastructure context",
    positivePrompt: "Documentary photograph style municipal street under roadwork",
  }).toLowerCase();
  for (const term of ["close-up", "traffic barrels", "barricades", "pavement", "blurred", "open pavement foreground"]) {
    assert.equal(retry.includes(term), true);
  }
});
