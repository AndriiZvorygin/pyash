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
