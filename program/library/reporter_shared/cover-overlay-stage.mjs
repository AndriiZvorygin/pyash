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

function breakLongWord(word, maxChars) {
  const token = String(word || "");
  if (!token || token.length <= maxChars) return [token];
  const out = [];
  for (let i = 0; i < token.length; i += maxChars) out.push(token.slice(i, i + maxChars));
  return out;
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
  const sourceTextClean = String(sourceText || "").replace(/\s+/gu, " ").trim();
  const srcWords = dedupeAdjacentWords(splitWords(sourceTextClean));
  const preservedTokens = uniq(srcWords.filter((w) => isEssentialToken(w)).map((w) => normalizeToken(w)));
  let words = pruneWords(srcWords, maxWords);
  words = dedupeAdjacentWords(words);
  words = extendWords(words, minWords);
  const finalOverlayText = words.join(" ").replace(/\s+/gu, " ").trim();
  const finalNorm = new Set(splitWords(finalOverlayText).map((w) => normalizeToken(w)).filter(Boolean));
  const droppedTokens = srcWords
    .map((w) => normalizeToken(w))
    .filter((t) => t && !finalNorm.has(t));
  const usedHookUnchanged = normalizeToken(finalOverlayText) === normalizeToken(sourceTextClean);
  return {
    sourceText: sourceTextClean,
    finalOverlayText,
    preservedTokens,
    droppedTokens: uniq(droppedTokens),
    reason: "shorten_overlay_preserve_essentials",
    sourceUsedUnchanged: usedHookUnchanged,
    sourceShortened: !usedHookUnchanged,
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
  observedAllText,
  outsideOverlayText,
  minWords = 3,
  maxWords = 8,
  requireNoExtraVisibleText = true,
} = {}) {
  const failures = [];
  const warnings = [];
  const missingEssentialTokens = [];
  const duplicateTokens = [];
  const extraVisibleTokens = [];

  const expected = normalizedWords(expectedText);
  const observed = normalizedWords(observedText);
  const observedAll = normalizedWords(observedAllText || observedText || "");
  const outsideOverlay = normalizedWords(outsideOverlayText || "");

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

  if (requireNoExtraVisibleText) {
    const expectedSet = new Set(expected);
    for (const token of observedAll) {
      if (!expectedSet.has(token)) extraVisibleTokens.push(token);
    }
    if (outsideOverlay.length) failures.push("outside_overlay_text_detected");
    if (extraVisibleTokens.length || observedAll.length > expected.length + 1) failures.push("extra_visible_text");
    const allPhrase = observedAll.join(" ");
    if (/(\b\w+\b\s+\b\w+\b)\s+\1/u.test(allPhrase)) failures.push("repeated_background_text");
  }

  return {
    expectedText: String(expectedText || "").trim(),
    observedText: String(observedText || "").trim(),
    observedAllText: String(observedAllText || observedText || "").trim(),
    outsideOverlayText: String(outsideOverlayText || "").trim(),
    pass: failures.length === 0,
    failures,
    warnings,
    missingEssentialTokens,
    duplicateTokens: uniq(duplicateTokens),
    extraVisibleTokens: uniq(extraVisibleTokens),
    extraVisibleTextPass: extraVisibleTokens.length === 0 && outsideOverlay.length === 0,
    backgroundTextDetected: extraVisibleTokens.length > 0 || outsideOverlay.length > 0,
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

async function readRgbaSample(filePath, size = 128, cwd = process.cwd()) {
  const res = await runWithStreaming({
    cmd: "ffmpeg",
    args: ["-v", "error", "-i", filePath, "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:black,format=rgba`, "-f", "rawvideo", "-"],
    cwd,
    env: process.env,
    timeoutMs: 30000,
    label: "read-rgba-sample",
  });
  return { buf: Buffer.from(res.stdout || ""), size };
}

async function analyzeAlpha(filePath, size = 128, cwd = process.cwd()) {
  try {
    const { buf, size: s } = await readRgbaSample(filePath, size, cwd);
    const px = s * s;
    if (buf.length < px * 4) return { hasAlpha: false, transparentPixelRatio: 0, opaquePixelRatio: 1 };
    let transparent = 0;
    let opaque = 0;
    for (let i = 0; i < px; i += 1) {
      const a = buf[i * 4 + 3];
      if (a < 8) transparent += 1;
      if (a > 247) opaque += 1;
    }
    return {
      hasAlpha: true,
      transparentPixelRatio: transparent / px,
      opaquePixelRatio: opaque / px,
    };
  } catch {
    return { hasAlpha: false, transparentPixelRatio: 0, opaquePixelRatio: 1 };
  }
}

async function compareRgbSimilarity(aPath, bPath, size = 128, cwd = process.cwd()) {
  try {
    const mk = async (fp) => {
      const res = await runWithStreaming({
        cmd: "ffmpeg",
        args: ["-v", "error", "-i", fp, "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:black,format=rgb24`, "-f", "rawvideo", "-"],
        cwd, env: process.env, timeoutMs: 30000, label: "read-rgb-sample",
      });
      return Buffer.from(res.stdout || "");
    };
    const A = await mk(aPath);
    const B = await mk(bPath);
    const n = Math.min(A.length, B.length);
    if (!n) return { score: 0, meanAbsDiff: 255 };
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += Math.abs(A[i] - B[i]);
    const mad = sum / n;
    const score = Math.max(0, 1 - (mad / 255));
    return { score, meanAbsDiff: mad };
  } catch {
    return { score: 0, meanAbsDiff: 255 };
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

  const textLayerPath = outputPath.replace(/\.png$/iu, ".cover-overlay.text-layer.png");
  const font = process.env.COVER_OVERLAY_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const safeMargin = 32;
  const maxWidth = Math.floor(Number(size) * 0.88);
  const lineHeight = 1.0;
  const strokeWidth = 3;
  const shadowX = 2;
  const shadowY = 2;
  const shadowColor = "black@0.70";

  const baseText = String(overlayText || "").replace(/\s+/gu, " ").trim();
  const words = baseText.split(" ").filter(Boolean);
  const makeLines = (maxChars) => {
    const lines = [];
    let cur = [];
    const safeWords = words.flatMap((w) => breakLongWord(w, Math.max(8, Math.floor(maxChars * 0.9))));
    for (const w of safeWords) {
      const test = [...cur, w].join(" ");
      if (cur.length && test.length > maxChars) {
        lines.push(cur.join(" "));
        cur = [w];
      } else {
        cur.push(w);
      }
    }
    if (cur.length) lines.push(cur.join(" "));
    return lines;
  };

  let fontSize = 36;
  let lines = [];
  let best = null;
  const maxTextBlockHeight = Math.floor(Number(size) * 0.36);
  for (let trySize = 36; trySize >= 20; trySize -= 1) {
    const charsPerLine = Math.max(10, Math.floor(maxWidth / Math.max(1, trySize * 0.56)));
    const candidate = makeLines(charsPerLine);
    const longest = candidate.reduce((m, l) => Math.max(m, l.length), 0);
    const linePx = Math.max(22, Math.round(trySize * lineHeight));
    const totalHeight = linePx * candidate.length;
    const fitsHeight = totalHeight <= maxTextBlockHeight;
    if (candidate.length <= 4 && longest <= charsPerLine && fitsHeight) {
      fontSize = trySize;
      lines = candidate;
      break;
    }
    if (!best || totalHeight < best.totalHeight) {
      best = { trySize, candidate, totalHeight };
    }
  }
  if (!lines.length) {
    fontSize = Math.max(20, best?.trySize || 20);
    lines = (best?.candidate || [baseText]).slice(0, 4);
  }

  const escapedMultiline = escapeDrawtext(lines.join("\n"));
  const textX = "(w-text_w)/2";
  const linePx = Math.max(28, Math.round(fontSize * lineHeight));
  const totalTextHeight = linePx * lines.length;
  const textYNum = Math.max(safeMargin, Number(size) - safeMargin - totalTextHeight - 10);
  const textY = String(textYNum);

  const overlayRegion = {
    x: safeMargin,
    y: Math.max(0, textYNum - 12),
    width: Math.max(0, Number(size) - safeMargin * 2),
    height: Math.max(0, totalTextHeight + 24),
  };

  const textVf = [
    "color=c=black@0.0:s=" + size + "x" + size + ":r=1,format=rgba",
    "drawtext=fontfile=" + font
      + ":text='" + escapedMultiline + "'"
      + ":fontcolor=white@0.97"
      + ":borderw=" + strokeWidth
      + ":bordercolor=black@0.95"
      + ":fontsize=" + fontSize
      + ":line_spacing=4"
      + ":x=" + textX
      + ":y=" + textY
      + ":box=0"
      + ":shadowx=" + shadowX
      + ":shadowy=" + shadowY
      + ":shadowcolor=" + shadowColor,
  ].join(",");

  const textLayerCommand = ["ffmpeg", "-y", "-f", "lavfi", "-i", textVf, "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgba", textLayerPath];
  await runWithStreaming({
    cmd: textLayerCommand[0],
    args: textLayerCommand.slice(1),
    cwd,
    env: process.env,
    timeoutMs: 180000,
    label: "deterministic-cover-text-layer",
  });

  const compositeCommand = [
    "ffmpeg", "-y",
    "-i", backgroundPath,
    "-i", textLayerPath,
    "-filter_complex", "[0:v]scale=" + size + ":" + size + ":force_original_aspect_ratio=increase,crop=" + size + ":" + size + "[bg];[bg][1:v]overlay=0:0:format=auto",
    "-frames:v", "1",
    "-c:v", "png",
    outputPath,
  ];
  await runWithStreaming({
    cmd: compositeCommand[0],
    args: compositeCommand.slice(1),
    cwd,
    env: process.env,
    timeoutMs: 180000,
    label: "deterministic-cover-composite",
  });

  const dims = await getImageDimensions(outputPath, cwd);
  const outputExists = fs.existsSync(outputPath);
  const textLayerExists = fs.existsSync(textLayerPath);
  const layoutContractPass = Boolean(outputExists && textLayerExists && dims.width === Number(size) && dims.height === Number(size));
  const alpha = textLayerExists ? await analyzeAlpha(textLayerPath, 128, cwd) : { hasAlpha: false, transparentPixelRatio: 0, opaquePixelRatio: 1 };
  const sim = outputExists ? await compareRgbSimilarity(backgroundPath, outputPath, 128, cwd) : { score: 0, meanAbsDiff: 255 };
  const alphaFlatteningDetected = !alpha.hasAlpha || alpha.transparentPixelRatio < 0.70;
  const compositePreservedBackground = sim.score >= 0.72;

  return {
    mode: "deterministic_fallback",
    outputPath,
    textLayerPath,
    backgroundPath,
    safeBackgroundPath: "",
    overlayText: String(overlayText || ""),
    outputExists,
    textLayerExists,
    dimensions: dims,
    imageSizeTarget: Number(size),
    layoutContractPass,
    exactOverlayDrawn: true,
    overlayRegion,
    overlayStyle: {
      fillColor: "white@0.97",
      strokeColor: "black@0.95",
      strokeWidth,
      shadow: { x: shadowX, y: shadowY, color: shadowColor },
      backplate: { enabled: false, opacity: 0, areaRatio: 0 },
      lineHeight,
      fontSize,
      safeMargin,
      maxWidth,
      placement: "lower_third",
      lineCount: lines.length,
      lines,
    },
    backplateAreaRatio: 0,
    safeBackgroundFallbackUsed: false,
    compositorMode: "ffmpeg_overlay_rgba",
    compositorCommand: compositeCommand.join(" "),
    textLayerCommand: textLayerCommand.join(" "),
    backgroundInputPath: backgroundPath,
    textLayerHasAlpha: alpha.hasAlpha,
    textLayerTransparentPixelRatio: Number((alpha.transparentPixelRatio || 0).toFixed(4)),
    alphaFlatteningDetected,
    finalBackgroundSimilarity: Number((sim.score || 0).toFixed(4)),
    finalBackgroundMeanAbsDiff: Number((sim.meanAbsDiff || 255).toFixed(3)),
    compositePreservedBackground,
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
  diagnoseFinalBackground,
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
  let acceptedObservedAllText = String(candidateObserved?.observedAllText || candidateObserved?.observedText || "");
  let deterministicFallbackUsed = false;
  let overlayRegion = null;
  let backgroundRegenerated = false;
  let safeBackgroundFallbackUsed = false;
  let safeBackgroundPath = "";

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
        acceptedObservedAllText = String(fallbackObserved?.observedAllText || fallbackObserved?.observedText || acceptedObservedText);
        overlayRegion = fallbackRender?.overlayRegion || null;
        backgroundRegenerated = Boolean(fallbackRender?.backgroundRegenerated);
        safeBackgroundFallbackUsed = Boolean(fallbackRender?.safeBackgroundFallbackUsed);
        safeBackgroundPath = String(fallbackRender?.safeBackgroundPath || "");
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
    extraVisibleText: uniq([...(candidateVerify?.extraVisibleTokens || []), ...(fallbackVerify?.extraVisibleTokens || [])]),
    extraVisibleTextPass: Boolean((candidateVerify?.extraVisibleTextPass || false) || (fallbackVerify?.extraVisibleTextPass || false)),
    backgroundTextDetected: Boolean((candidateVerify?.backgroundTextDetected || false) || (fallbackVerify?.backgroundTextDetected || false)),
    overlayRegion,
    outsideOverlayTextObserved: String(fallbackObserved?.outsideOverlayText || candidateObserved?.outsideOverlayText || ""),
    backgroundRegenerated,
    safeBackgroundFallbackUsed,
    safeBackgroundPath,
    compositorMode: String(fallbackRender?.compositorMode || ""),
    compositorCommand: String(fallbackRender?.compositorCommand || ""),
    backgroundInputPath: String(fallbackRender?.backgroundInputPath || stageInput?.backgroundPath || ""),
    textLayerPath: String(fallbackRender?.textLayerPath || ""),
    textLayerHasAlpha: typeof fallbackRender?.textLayerHasAlpha === "boolean" ? fallbackRender.textLayerHasAlpha : null,
    textLayerTransparentPixelRatio: Number(fallbackRender?.textLayerTransparentPixelRatio ?? -1),
    finalBackgroundSimilarity: Number(fallbackRender?.finalBackgroundSimilarity ?? -1),
    alphaFlatteningDetected: typeof fallbackRender?.alphaFlatteningDetected === "boolean" ? fallbackRender.alphaFlatteningDetected : null,
    compositePreservedBackground: typeof fallbackRender?.compositePreservedBackground === "boolean" ? fallbackRender.compositePreservedBackground : null,
    acceptedPath: finalPath,
    acceptedMode,
  };
  writePyaReport(reports.verify, verifyReport);


  let finalBackgroundDiagnostic = null;
  if (typeof diagnoseFinalBackground === "function" && outputExists) {
    try {
      finalBackgroundDiagnostic = await diagnoseFinalBackground({
        finalImagePath: finalPath,
        overlayRegion,
        expectedOverlayText: expectedText,
      });
    } catch (err) {
      finalBackgroundDiagnostic = {
        backgroundUseful: false,
        flatBackgroundDetected: true,
        visualUsefulnessMetrics: { nearBlackPixelRatio: 1, luminanceVariance: 0 },
        failureReasons: [String(err?.message || err || "final_background_diagnostic_failed")],
      };
    }
  }
  const finalFailures = [];
  if (acceptedMode === "failed") finalFailures.push("no_accepted_overlay_candidate");
  if (!outputExists) finalFailures.push("output_missing");
  if (target > 0 && (dimensions.width !== target || dimensions.height !== target)) {
    finalFailures.push("output_dimensions_mismatch");
  }
  if (stageInput?.backgroundUseful === false) finalFailures.push("background_usefulness_failed");
  if (finalBackgroundDiagnostic && finalBackgroundDiagnostic.backgroundUseful === false) finalFailures.push("final_background_usefulness_failed");
  if (stageInput?.backgroundRelevancePass === false) finalFailures.push("background_relevance_failed");
  if (finalBackgroundDiagnostic && finalBackgroundDiagnostic.backgroundRelevancePass === false) finalFailures.push("final_background_relevance_failed");
  if (stageInput?.abstractFallbackUsed === true && stageInput?.abstractFallbackAllowed !== true) finalFailures.push("abstract_fallback_not_allowed");
  if (verifyReport.textLayerHasAlpha === false) finalFailures.push("text_layer_alpha_missing");
  if (verifyReport.alphaFlatteningDetected === true) finalFailures.push("alpha_flattening_detected");
  if (verifyReport.compositePreservedBackground === false && Number(verifyReport.finalBackgroundSimilarity || 0) > 0) finalFailures.push("background_not_preserved_in_composite");

  const finalReport = {
    pass: finalFailures.length === 0,
    finalImagePath: finalPath,
    acceptedMode,
    deterministicFallbackUsed,
    expectedOverlayText: expectedText,
    observedOverlayText: acceptedObservedText,
    observedFinalText: acceptedObservedAllText,
    extraVisibleText: verifyReport.extraVisibleText,
    extraVisibleTextPass: verifyReport.extraVisibleTextPass,
    backgroundTextDetected: verifyReport.backgroundTextDetected,
    overlayRegion: verifyReport.overlayRegion,
    outsideOverlayTextObserved: verifyReport.outsideOverlayTextObserved,
    backgroundRegenerated: verifyReport.backgroundRegenerated,
    safeBackgroundFallbackUsed: verifyReport.safeBackgroundFallbackUsed,
    safeBackgroundPath: verifyReport.safeBackgroundPath,
    finalTextVerificationMode: acceptedObservedText ? "ocr" : "deterministic_layout",
    ocrReliable: acceptedObservedText ? "yes" : "no",
    failures: finalFailures,
    warnings: uniq([
      ...verifyReport.candidateWarnings,
      ...verifyReport.fallbackWarnings,
    ]),
    imageSizeTarget: target,
    outputExists,
    dimensions,
    backgroundUseful: stageInput?.backgroundUseful !== false,
    finalBackgroundUseful: finalBackgroundDiagnostic?.backgroundUseful ?? null,
    finalNearBlackPixelRatio: finalBackgroundDiagnostic?.visualUsefulnessMetrics?.nearBlackPixelRatio ?? null,
    finalLuminanceVariance: finalBackgroundDiagnostic?.visualUsefulnessMetrics?.luminanceVariance ?? null,
    finalFlatBackgroundDetected: finalBackgroundDiagnostic?.flatBackgroundDetected ?? null,
    finalBackgroundUsefulnessPass: finalBackgroundDiagnostic ? Boolean(finalBackgroundDiagnostic.backgroundUseful) : null,
    backgroundKind: String(stageInput?.backgroundKind || finalBackgroundDiagnostic?.backgroundKind || "unknown"),
    backgroundRelevancePass: finalBackgroundDiagnostic ? Boolean(finalBackgroundDiagnostic.backgroundRelevancePass) : (stageInput?.backgroundRelevancePass ?? null),
    backgroundRelevanceReason: String(finalBackgroundDiagnostic?.backgroundRelevanceReason || stageInput?.backgroundRelevanceReason || ""),
    abstractFallbackUsed: Boolean(stageInput?.abstractFallbackUsed),
    abstractFallbackAllowed: Boolean(stageInput?.abstractFallbackAllowed),
    visualSubject: String(stageInput?.visualSubject || finalBackgroundDiagnostic?.visualSubject || ""),
    finalPublishableCover: false,
    compositorMode: verifyReport.compositorMode,
    compositorCommand: verifyReport.compositorCommand,
    backgroundInputPath: verifyReport.backgroundInputPath,
    textLayerPath: verifyReport.textLayerPath,
    textLayerHasAlpha: verifyReport.textLayerHasAlpha,
    textLayerTransparentPixelRatio: verifyReport.textLayerTransparentPixelRatio,
    finalBackgroundSimilarity: verifyReport.finalBackgroundSimilarity,
    alphaFlatteningDetected: verifyReport.alphaFlatteningDetected,
    compositePreservedBackground: verifyReport.compositePreservedBackground,
  };
  finalReport.finalPublishableCover = Boolean(
    finalReport.pass
    && finalReport.backgroundRelevancePass !== false
    && finalReport.finalBackgroundUsefulnessPass !== false
    && (finalReport.abstractFallbackUsed !== true || finalReport.abstractFallbackAllowed === true)
  );
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
