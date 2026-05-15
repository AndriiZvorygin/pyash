import fs from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { writePyaReport } from "./cover-overlay-stage.mjs";

function run(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => { stdout = Buffer.concat([stdout, Buffer.from(c)]); });
    child.stderr.on("data", (c) => { stderr += String(c || ""); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${cmd} failed: ${stderr}`));
    });
  });
}

function normTokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]+/gu, " ").split(/\s+/u).filter(Boolean);
}

function overlapScore(a, b) {
  const A = new Set(normTokens(a));
  const B = new Set(normTokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit += 1;
  return hit / Math.max(1, Math.min(A.size, B.size));
}

function sha(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

async function readRgbSample(imagePath, sampleW = 128, sampleH = 128) {
  const { stdout } = await run("ffmpeg", [
    "-v", "error", "-i", imagePath,
    "-vf", `scale=${sampleW}:${sampleH}:force_original_aspect_ratio=decrease,pad=${sampleW}:${sampleH}:(ow-iw)/2:(oh-ih)/2:black,format=rgb24`,
    "-f", "rawvideo", "-",
  ], 45000);
  return { buf: stdout, w: sampleW, h: sampleH };
}

export async function diagnoseCoverBackground({
  backgroundPath,
  observedBackgroundText = "",
  selectedOverlayText = "",
  rejectedOverlayTexts = [],
  sourceDisagreementDetected = false,
  backgroundKind = "unknown",
  visualSubject = "",
  abstractFallbackAllowed = false,
  promptText = "",
  selectedOverlayTextHash = "",
  previousPromptHash = "",
  previousOverlayHash = "",
  reportPath = "",
} = {}) {
  const exists = Boolean(backgroundPath && fs.existsSync(backgroundPath));
  const promptHash = sha(promptText);
  const overlayHash = selectedOverlayTextHash || sha(selectedOverlayText);
  const out = {
    backgroundPath: String(backgroundPath || ""),
    generationPromptHash: promptHash,
    selectedOverlayTextHash: overlayHash,
    rejectedOverlayTextHashes: (rejectedOverlayTexts || []).map((x) => sha(String(x?.text || x || ""))),
    backgroundGeneratedForPromptHash: promptHash,
    backgroundGeneratedForOverlayHash: overlayHash,
    staleBackgroundArtifactDetected: false,
    textLikeContentDetected: false,
    observedBackgroundText: String(observedBackgroundText || ""),
    staleBackgroundTextDetected: false,
    backgroundKind: String(backgroundKind || "unknown"),
    abstractFallbackUsed: String(backgroundKind || "").includes("fallback"),
    abstractFallbackAllowed: Boolean(abstractFallbackAllowed),
    visualSubject: String(visualSubject || ""),
    visualSubjectMatched: null,
    backgroundRelevancePass: false,
    backgroundRelevanceReason: "",
    finalPublishableCover: false,
    visualUsefulnessMetrics: {
      luminanceVariance: 0,
      colourVariance: 0,
      nearBlackPixelRatio: 1,
      nearWhitePixelRatio: 0,
      edgeDetailScore: 0,
    },
    backgroundUseful: false,
    flatBackgroundDetected: true,
    failureReasons: [],
    recommendedAction: "use_abstract_fallback",
  };

  if (!exists) {
    out.failureReasons.push("background_missing");
    out.backgroundRelevanceReason = "background_missing";
    if (reportPath) writePyaReport(reportPath, out);
    return out;
  }

  if ((previousPromptHash && previousPromptHash !== promptHash) || (previousOverlayHash && previousOverlayHash !== overlayHash)) {
    out.staleBackgroundArtifactDetected = true;
    out.failureReasons.push("stale_background_artifact_detected");
  }

  const { buf, w, h } = await readRgbSample(backgroundPath, 128, 128);
  const pxCount = w * h;
  if (buf.length < pxCount * 3) {
    out.failureReasons.push("background_decode_failed");
    if (reportPath) writePyaReport(reportPath, out);
    return out;
  }

  let sumL = 0; let sumL2 = 0;
  let sumSat = 0; let sumSat2 = 0;
  let nearBlack = 0; let nearWhite = 0;
  const lum = new Float64Array(pxCount);

  for (let i = 0; i < pxCount; i += 1) {
    const r = buf[i * 3 + 0];
    const g = buf[i * 3 + 1];
    const b = buf[i * 3 + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = l;
    sumL += l; sumL2 += l * l;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const sat = max - min;
    sumSat += sat; sumSat2 += sat * sat;
    if (l < 18) nearBlack += 1;
    if (l > 238) nearWhite += 1;
  }

  let edge = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = -lum[i - w - 1] + lum[i - w + 1] - 2 * lum[i - 1] + 2 * lum[i + 1] - lum[i + w - 1] + lum[i + w + 1];
      const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      edge += Math.sqrt(gx * gx + gy * gy);
    }
  }
  const edgeScore = edge / Math.max(1, (w - 2) * (h - 2));

  const meanL = sumL / pxCount;
  const varL = Math.max(0, (sumL2 / pxCount) - meanL * meanL);
  const meanSat = sumSat / pxCount;
  const varSat = Math.max(0, (sumSat2 / pxCount) - meanSat * meanSat);
  const nearBlackRatio = nearBlack / pxCount;
  const nearWhiteRatio = nearWhite / pxCount;

  const observedTextNorm = String(observedBackgroundText || "").trim();
  const textLikeContentDetected = observedTextNorm.length > 0;

  out.textLikeContentDetected = textLikeContentDetected;
  out.visualUsefulnessMetrics = {
    luminanceVariance: Number(varL.toFixed(3)),
    colourVariance: Number(varSat.toFixed(3)),
    nearBlackPixelRatio: Number(nearBlackRatio.toFixed(4)),
    nearWhitePixelRatio: Number(nearWhiteRatio.toFixed(4)),
    edgeDetailScore: Number(edgeScore.toFixed(3)),
  };

  const flatBackgroundDetected = varL < 20 || edgeScore < 2;
  const nearBlackTooHigh = nearBlackRatio > 0.78;
  const syntheticTextBannerRisk = textLikeContentDetected && nearWhiteRatio > 0.08 && edgeScore > 80 && varSat < 800;
  out.flatBackgroundDetected = flatBackgroundDetected;

  if (textLikeContentDetected) out.failureReasons.push("background_text_detected");
  if (syntheticTextBannerRisk) out.failureReasons.push("synthetic_text_banner_risk");
  if (flatBackgroundDetected) out.failureReasons.push("flat_background_detected");
  if (nearBlackTooHigh) out.failureReasons.push("near_black_ratio_too_high");

  const rejected = (rejectedOverlayTexts || []).map((x) => String(x?.text || x || "")).filter(Boolean);
  const staleTextMatch = Boolean(sourceDisagreementDetected && rejected.some((r) => overlapScore(observedTextNorm, r) >= 0.5));
  if (staleTextMatch) {
    out.staleBackgroundTextDetected = true;
    out.failureReasons.push("stale_background_text_detected");
  }

  out.backgroundUseful = out.failureReasons.length === 0;

  const kind = String(backgroundKind || "unknown");
  const isAbstract = kind === "abstract_fallback" || kind === "solid_fallback";
  const isGeneratedLike = kind === "generated_scene" || kind === "transformed_generated_scene";
  if (isAbstract && !abstractFallbackAllowed) {
    out.backgroundRelevancePass = false;
    out.backgroundRelevanceReason = "abstract_fallback_not_allowed";
    out.failureReasons.push("relevant_background_unavailable");
    out.backgroundUseful = false;
  } else if (isAbstract && abstractFallbackAllowed) {
    out.backgroundRelevancePass = true;
    out.backgroundRelevanceReason = "abstract_fallback_allowed_symbolic";
  } else if (isGeneratedLike) {
    out.backgroundRelevancePass = true;
    out.backgroundRelevanceReason = "generated_scene_provenance";
  } else if (out.backgroundUseful) {
    out.backgroundRelevancePass = false;
    out.backgroundRelevanceReason = "unknown_background_provenance";
  } else {
    out.backgroundRelevancePass = false;
    out.backgroundRelevanceReason = "background_usefulness_failed";
  }
  out.visualSubjectMatched = isGeneratedLike ? true : null;
  out.finalPublishableCover = Boolean(out.backgroundUseful && out.backgroundRelevancePass);

  if (out.backgroundUseful) out.recommendedAction = "accept";
  else if (staleTextMatch) out.recommendedAction = "regenerate_with_stricter_prompt";
  else if (textLikeContentDetected) out.recommendedAction = "safe_blur_transform";
  else if (nearBlackTooHigh) out.recommendedAction = "use_abstract_fallback";
  else out.recommendedAction = "regenerate_with_stricter_prompt";

  if (reportPath) writePyaReport(reportPath, out);
  return out;
}
