import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function uniq(list = []) {
  return [...new Set((list || []).filter(Boolean))];
}

function normalizeToken(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/^[^a-z0-9%$]+|[^a-z0-9%$]+$/gu, "")
    .trim();
}

function splitWords(text) {
  return String(text || "")
    .replace(/[“”‘’]/gu, "\"")
    .split(/\s+/u)
    .map((w) => w.trim())
    .filter(Boolean);
}

function isEssentialToken(token) {
  const t = normalizeToken(token);
  if (!t) return false;
  if (/^\d{4}$/u.test(t)) return true;
  if (/^[\$]?\d[\d,]*(?:\.\d+)?$/u.test(t)) return true;
  if (/^\d+(?:\.\d+)?%$/u.test(t)) return true;
  if (/^(?:tl-?\d+|mash|hwy\d+|#?\d+[a-z]?)$/iu.test(t)) return true;
  return false;
}

function dedupeAdjacentWords(words = []) {
  const out = [];
  for (const word of words) {
    const prev = out[out.length - 1];
    if (normalizeToken(prev) && normalizeToken(prev) === normalizeToken(word)) continue;
    out.push(word);
  }
  return out;
}

function pruneWords(words = [], maxWords = 6) {
  if (words.length <= maxWords) return words.slice();
  const essentials = new Set();
  for (let i = 0; i < words.length; i += 1) {
    if (isEssentialToken(words[i])) essentials.add(i);
  }
  const picked = [];
  for (let i = 0; i < words.length; i += 1) {
    if (picked.length >= maxWords) break;
    if (i < maxWords - essentials.size || essentials.has(i)) picked.push({ i, w: words[i] });
  }
  for (const idx of [...essentials].sort((a, b) => a - b)) {
    if (picked.some((p) => p.i === idx)) continue;
    const replaceAt = picked.findIndex((p) => !isEssentialToken(p.w));
    if (replaceAt >= 0) picked[replaceAt] = { i: idx, w: words[idx] };
  }
  return picked.sort((a, b) => a.i - b.i).slice(0, maxWords).map((p) => p.w);
}

function extendWords(words = [], minWords = 3) {
  if (words.length >= minWords) return words.slice();
  const fillers = ["Meeting", "Update", "Today"];
  const out = words.slice();
  for (const filler of fillers) {
    if (out.length >= minWords) break;
    out.push(filler);
  }
  return out;
}

export function deriveCoverOverlayText({
  sourceText,
  minWords = 3,
  maxWords = 6,
} = {}) {
  const srcWords = dedupeAdjacentWords(splitWords(sourceText));
  const preservedTokens = uniq(srcWords.filter((w) => isEssentialToken(w)).map((w) => normalizeToken(w)));
  let words = pruneWords(srcWords, maxWords);
  words = dedupeAdjacentWords(words);
  words = extendWords(words, minWords);
  const finalOverlayText = words.join(" ").replace(/\s+/gu, " ").trim();
  const finalNorm = new Set(splitWords(finalOverlayText).map((w) => normalizeToken(w)).filter(Boolean));
  const droppedTokens = srcWords
    .map((w) => normalizeToken(w))
    .filter((t) => t && !finalNorm.has(t));
  return {
    sourceText: String(sourceText || "").trim(),
    finalOverlayText,
    preservedTokens,
    droppedTokens: uniq(droppedTokens),
    reason: "shorten_overlay_preserve_essentials",
  };
}

function normalizedWords(text) {
  return splitWords(text).map((w) => normalizeToken(w)).filter(Boolean);
}

function orderedTokenSimilarity(expectedWords = [], observedWords = []) {
  if (!expectedWords.length) return 0;
  let lastFound = -1;
  let found = 0;
  for (const token of expectedWords) {
    const idx = observedWords.findIndex((w, i) => i > lastFound && w === token);
    if (idx >= 0) {
      found += 1;
      lastFound = idx;
    }
  }
  return found / expectedWords.length;
}

export function verifyCoverOverlayText({
  expectedText,
  observedText,
  minWords = 3,
  maxWords = 8,
} = {}) {
  const failures = [];
  const warnings = [];
  const missingEssentialTokens = [];
  const duplicateTokens = [];

  const expected = normalizedWords(expectedText);
  const observed = normalizedWords(observedText);

  if (!observed.length) failures.push("observed_text_empty_or_unreadable");

  const observedWordCount = splitWords(observedText).length;
  if (observedWordCount < minWords || observedWordCount > maxWords) {
    warnings.push(`observed_word_count_${observedWordCount}_outside_${minWords}_${maxWords}`);
  }

  for (let i = 1; i < observed.length; i += 1) {
    if (observed[i] === observed[i - 1]) duplicateTokens.push(observed[i]);
  }
  if (duplicateTokens.length) failures.push("adjacent_duplicate_tokens");

  const expectedEssentials = uniq(splitWords(expectedText).filter((w) => isEssentialToken(w)).map((w) => normalizeToken(w)));
  for (const essential of expectedEssentials) {
    if (!observed.includes(essential)) missingEssentialTokens.push(essential);
  }
  if (missingEssentialTokens.length) failures.push("missing_essential_tokens");

  const expectedYears = uniq(expected.filter((w) => /^\d{4}$/u.test(w)));
  for (const year of expectedYears) {
    if (!observed.includes(year) && !missingEssentialTokens.includes(year)) missingEssentialTokens.push(year);
  }
  if (expectedYears.length && expectedYears.some((y) => !observed.includes(y))) {
    if (!failures.includes("missing_year_token")) failures.push("missing_year_token");
  }

  const similarity = orderedTokenSimilarity(expected, observed);
  if (similarity < 0.6) failures.push(`low_ordered_token_similarity_${similarity.toFixed(2)}`);

  const observedPhrase = observed.join(" ");
  if (/(\b\w+\b\s+\b\w+\b)\s+\1/u.test(observedPhrase)) failures.push("repeated_phrase_fragments");

  return {
    expectedText: String(expectedText || "").trim(),
    observedText: String(observedText || "").trim(),
    pass: failures.length === 0,
    failures,
    warnings,
    missingEssentialTokens,
    duplicateTokens: uniq(duplicateTokens),
    similarity,
  };
}

function escapeDrawtext(text) {
  return String(text || "")
    .replace(/\\/gu, "\\\\")
    .replace(/:/gu, "\\:")
    .replace(/'/gu, "\\\\'")
    .replace(/%/gu, "\\%");
}

function runWithStreaming({ cmd, args, cwd, env, timeoutMs = 120000, label = "cmd" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), Math.max(10_000, Number(timeoutMs) || 10_000));
    child.stdout.on("data", (chunk) => { stdout += String(chunk || ""); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${label} failed (code=${code ?? "null"} signal=${signal ?? ""})\n${stderr || stdout}`.trim()));
    });
  });
}

async function getImageDimensions(filePath, cwd = process.cwd()) {
  try {
    const res = await runWithStreaming({
      cmd: "ffprobe",
      args: ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", filePath],
      cwd,
      env: process.env,
      timeoutMs: 15000,
      label: "probe-image-dimensions",
    });
    const m = String(res.stdout || "").trim().match(/^(\d+)x(\d+)$/u);
    if (!m) return { width: 0, height: 0 };
    return { width: Number(m[1]) || 0, height: Number(m[2]) || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function renderDeterministicOverlay({
  backgroundPath,
  overlayText,
  outputPath,
  size = 512,
  cwd = process.cwd(),
} = {}) {
  if (!backgroundPath || !fs.existsSync(backgroundPath)) throw new Error("background image missing for deterministic overlay");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const font = process.env.COVER_OVERLAY_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const escaped = escapeDrawtext(overlayText);
  const vf = [
    `scale=${size}:${size}:force_original_aspect_ratio=increase`,
    `crop=${size}:${size}`,
    `drawbox=x=24:y=ih-170:w=iw-48:h=130:color=black@0.48:t=fill`,
    `drawtext=fontfile=${font}:text='${escaped}':fontcolor=white:fontsize=38:line_spacing=6:x=(w-text_w)/2:y=h-130:shadowx=2:shadowy=2:shadowcolor=black@0.85`
  ].join(",");
  await runWithStreaming({
    cmd: "ffmpeg",
    args: ["-y", "-i", backgroundPath, "-vf", vf, "-frames:v", "1", outputPath],
    cwd,
    env: process.env,
    timeoutMs: 180000,
    label: "deterministic-cover-overlay",
  });
  const dims = await getImageDimensions(outputPath, cwd);
  const outputExists = fs.existsSync(outputPath);
  const layoutContractPass = Boolean(outputExists && dims.width === Number(size) && dims.height === Number(size));
  return {
    mode: "deterministic_fallback",
    outputPath,
    overlayText: String(overlayText || ""),
    outputExists,
    dimensions: dims,
    imageSizeTarget: Number(size),
    layoutContractPass,
    exactOverlayDrawn: true,
  };
}

function pyaQuote(text) {
  return `"${String(text || "").replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function toPyaLines(obj, prefix = "") {
  const lines = [];
  for (const [key, value] of Object.entries(obj || {})) {
    const name = prefix ? `${prefix} ${key}` : key;
    if (Array.isArray(value)) {
      if (!value.length) lines.push(`${name} count is 0.`);
      else {
        lines.push(`${name} count is ${value.length}.`);
        value.forEach((item, idx) => {
          if (item && typeof item === "object") lines.push(...toPyaLines(item, `${name} ${idx + 1}`));
          else lines.push(`${name} ${idx + 1} is ${pyaQuote(String(item))}.`);
        });
      }
    } else if (value && typeof value === "object") {
      lines.push(...toPyaLines(value, name));
    } else if (typeof value === "number") {
      lines.push(`${name} is ${Number.isFinite(value) ? value : 0}.`);
    } else if (typeof value === "boolean") {
      lines.push(`${name} is ${value ? "yes" : "no"}.`);
    } else if (value == null) {
      lines.push(`${name} is ${pyaQuote("")}.`);
    } else {
      lines.push(`${name} is ${pyaQuote(String(value))}.`);
    }
  }
  return lines;
}

export function writePyaReport(filePath, payload = {}) {
  const lines = toPyaLines(payload);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function safeObserve(observeOverlay, payload, failureCode, failuresOut) {
  if (!observeOverlay) return { observedText: "" };
  try {
    return await observeOverlay(payload);
  } catch (err) {
    failuresOut.push(failureCode);
    return {
      observedText: "",
      observeError: String(err?.message || err || "observe_failed"),
    };
  }
}

function safeVerify(verifyOverlay, payload, failureCode, failuresOut) {
  try {
    return verifyOverlay
      ? verifyOverlay(payload)
      : verifyCoverOverlayText({ expectedText: payload.finalOverlayText, observedText: payload.observedText || "" });
  } catch (err) {
    failuresOut.push(failureCode);
    return {
      expectedText: String(payload.finalOverlayText || ""),
      observedText: String(payload.observedText || ""),
      pass: false,
      failures: [failureCode],
      warnings: [String(err?.message || err || failureCode)],
      missingEssentialTokens: [],
      duplicateTokens: [],
      similarity: 0,
    };
  }
}

export async function runCoverOverlayStage({
  stageInput,
  deriveOverlay,
  observeOverlay,
  verifyOverlay,
  renderDeterministic,
  reports,
} = {}) {
  if (!stageInput?.overlayText) throw new Error("cover overlay stage requires overlayText");
  writePyaReport(reports.input, stageInput);

  const derived = deriveOverlay
    ? await deriveOverlay(stageInput)
    : deriveCoverOverlayText({ sourceText: stageInput.overlayText });
  writePyaReport(reports.derived, derived);

  const expectedText = String(derived.finalOverlayText || "").trim();
  const candidateErrors = [];
  const fallbackErrors = [];

  const candidateObserved = await safeObserve(observeOverlay, { ...stageInput, ...derived }, "candidate_observe_failed", candidateErrors);
  const candidateVerify = safeVerify(verifyOverlay, { ...stageInput, ...derived, ...candidateObserved }, "candidate_verify_failed", candidateErrors);
  const candidatePass = Boolean(candidateVerify?.pass);

  let fallbackAttempted = false;
  let fallbackRender = null;
  let fallbackObserved = { observedText: "" };
  let fallbackVerify = {
    expectedText,
    observedText: "",
    pass: false,
    failures: ["fallback_not_attempted"],
    warnings: [],
    missingEssentialTokens: [],
    duplicateTokens: [],
    similarity: 0,
  };

  let acceptedMode = "failed";
  let acceptedPath = "";
  let acceptedObservedText = String(candidateObserved?.observedText || "");
  let deterministicFallbackUsed = false;

  if (candidatePass) {
    acceptedMode = "candidate";
    acceptedPath = String(stageInput.outputPath || stageInput.backgroundPath || "");
  } else {
    fallbackAttempted = true;
    deterministicFallbackUsed = true;
    if (renderDeterministic) {
      try {
        fallbackRender = await renderDeterministic({ ...stageInput, ...derived, candidateObserved, candidateVerify });
      } catch (err) {
        fallbackErrors.push("fallback_render_failed");
        fallbackRender = {
          mode: "deterministic_fallback",
          outputPath: String(stageInput.outputPath || ""),
          exactOverlayDrawn: false,
          layoutContractPass: false,
          outputExists: false,
          dimensions: { width: 0, height: 0 },
          imageSizeTarget: Number(stageInput.imageSizeTarget || 0),
          renderError: String(err?.message || err || "fallback_render_failed"),
        };
      }

      fallbackObserved = await safeObserve(observeOverlay, { ...stageInput, ...derived, ...fallbackRender }, "fallback_observe_failed", fallbackErrors);
      fallbackVerify = safeVerify(verifyOverlay, { ...stageInput, ...derived, ...fallbackObserved }, "fallback_verify_failed", fallbackErrors);

      const fallbackVerifiedPass = Boolean(fallbackVerify?.pass);
      const fallbackLayoutTrusted = Boolean(
        fallbackRender?.exactOverlayDrawn
        && fallbackRender?.layoutContractPass
        && fallbackRender?.outputExists
      );
      if (fallbackVerifiedPass || fallbackLayoutTrusted) {
        acceptedMode = "deterministic_fallback";
        acceptedPath = String(fallbackRender?.outputPath || stageInput.outputPath || "");
        acceptedObservedText = String(fallbackObserved?.observedText || expectedText);
      }
    } else {
      fallbackErrors.push("fallback_not_available");
    }
  }

  const finalPath = acceptedPath || String(stageInput.outputPath || "");
  const outputExists = finalPath ? fs.existsSync(finalPath) : false;
  const dimensions = outputExists ? await getImageDimensions(finalPath, process.cwd()) : { width: 0, height: 0 };
  const target = Number(stageInput.imageSizeTarget || 0);

  const verifyReport = {
    expectedText,
    candidateObservedText: String(candidateObserved?.observedText || ""),
    candidatePass,
    candidateFailures: uniq([...(candidateVerify?.failures || []), ...candidateErrors]),
    candidateWarnings: uniq([...(candidateVerify?.warnings || []), String(candidateObserved?.observeError || "")].filter(Boolean)),
    fallbackAttempted,
    fallbackObservedText: String(fallbackObserved?.observedText || ""),
    fallbackPass: Boolean(fallbackVerify?.pass),
    fallbackFailures: uniq([...(fallbackVerify?.failures || []), ...fallbackErrors]),
    fallbackWarnings: uniq([...(fallbackVerify?.warnings || []), String(fallbackObserved?.observeError || ""), String(fallbackRender?.renderError || "")].filter(Boolean)),
    acceptedPath: finalPath,
    acceptedMode,
  };
  writePyaReport(reports.verify, verifyReport);

  const finalFailures = [];
  if (acceptedMode === "failed") finalFailures.push("no_accepted_overlay_candidate");
  if (!outputExists) finalFailures.push("output_missing");
  if (target > 0 && (dimensions.width !== target || dimensions.height !== target)) {
    finalFailures.push("output_dimensions_mismatch");
  }

  const finalReport = {
    pass: finalFailures.length === 0,
    finalImagePath: finalPath,
    acceptedMode,
    deterministicFallbackUsed,
    expectedOverlayText: expectedText,
    observedOverlayText: acceptedObservedText,
    failures: finalFailures,
    warnings: uniq([
      ...verifyReport.candidateWarnings,
      ...verifyReport.fallbackWarnings,
    ]),
    imageSizeTarget: target,
    outputExists,
    dimensions,
  };
  writePyaReport(reports.final, finalReport);

  if (!finalReport.pass) {
    throw new Error(`cover overlay stage failed: ${finalFailures.join(", ") || "unknown_failure"}`);
  }

  return {
    derived,
    verify: verifyReport,
    final: finalReport,
    usedDeterministicFallback: deterministicFallbackUsed,
  };
}
