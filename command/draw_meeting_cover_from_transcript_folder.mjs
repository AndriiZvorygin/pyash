#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from "node:url";
import {
  deriveCoverOverlayText,
  verifyCoverOverlayText,
  renderDeterministicOverlay,
  runCoverOverlayStage,
  writePyaReport,
} from "../program/library/reporter_shared/cover-overlay-stage.mjs";
import { runCoverPromptifyStage, buildRetryPromptForBackgroundRisk } from "../program/library/reporter_shared/cover-promptify-stage.mjs";
import { selectCoverOverlaySource } from "../program/library/reporter_shared/cover-overlay-source.mjs";
import { diagnoseCoverBackground } from "../program/library/reporter_shared/cover-background-diagnostics.mjs";

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(COMMAND_DIR, "..");
const DEFAULT_STYLE = 'bold civic poster background, high contrast, simple geometry, strong readability';

function usage() {
  return [
    'Usage: node command/draw_meeting_cover_from_transcript_folder.mjs <transcript_dir> [prefix] [style]',
    'Example: node command/draw_meeting_cover_from_transcript_folder.mjs world/house/owen-sound-reporter/artifacts/.../transcript meeting-qwen-auto-normalized',
  ].join('\n');
}

function existsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeReadText(filePath, fallback = '') {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function extractMarkdownSection(mdText, headingText) {
  const lines = String(mdText || '').split(/\r?\n/u);
  const target = String(headingText || '').trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/u);
    if (!m) continue;
    if (m[1].trim().toLowerCase() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/u.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function sanitizeStem(input) {
  const base = path.basename(String(input || ''), path.extname(String(input || '')));
  let out = base.replace(/[^A-Za-z0-9_-]/gu, '_').replace(/_+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!out) out = 'output';
  return out.slice(0, 96);
}

function parseGeneratedImagePath(drawStdout, sourceFilename, runCwd = ROOT) {
  const text = String(drawStdout || '');
  const escapedRoot = ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const imagePathAbsRe = new RegExp(`${escapedRoot}\\/(?:artifacts|know\\/produce)\\/[^\\s"']+\\.png`, 'gu');
  const imagePathRelRe = /(?:^|[\s"'`])((?:artifacts|know\/produce)\/[^\s"'`]+\.png)(?=$|[\s"'`])/gu;
  const matches = [
    ...[...text.matchAll(imagePathAbsRe)].map((m) => m[0]),
    ...[...text.matchAll(imagePathRelRe)].map((m) => path.resolve(runCwd, m[1])),
  ];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (existsFile(matches[i])) return matches[i];
  }
  const stem = sanitizeStem(sourceFilename);
  const fallbackRoot = path.join(ROOT, 'know/produce', `${stem}.png`);
  if (existsFile(fallbackRoot)) return fallbackRoot;
  const fallbackRun = path.join(runCwd, 'know/produce', `${stem}.png`);
  return existsFile(fallbackRun) ? fallbackRun : '';
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/u).filter(Boolean).length;
}

function verifyOverlayWordRange(overlay, minWords = 3, maxWords = 6) {
  const n = countWords(overlay);
  if (n < minWords || n > maxWords) {
    throw new Error(`thumbnail overlay defective: expected ${minWords}-${maxWords} words, got ${n} ("${overlay}")`);
  }
}

function extractOverlayCandidate(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return "";
  const quoted = text.match(/["“]([^"”\n]{2,96})["”]/u);
  if (quoted?.[1]) return quoted[1].trim();

  const line = text.split(/\r?\n/u).map((x) => x.trim()).find(Boolean) || "";
  const overlayLead = line.match(/(?:overlay|text|phrase)\s*[:\-]\s*(.+)$/iu);
  if (overlayLead?.[1]) return overlayLead[1].trim();
  return line;
}

function normalizeOverlayText(text) {
  return String(text || "")
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/gu, "")
    .replace(/[^A-Za-z0-9\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

async function observeVisibleTextRaw(imagePath) {
  if (String(process.env.COVER_BACKGROUND_OCR || '').trim() !== '1') return '';
  const verifyHost = String(process.env.OLLAMA_HOST || "http://mriczo:11434").trim();
  const model = String(process.env.DRAW_OVERLAY_VERIFY_MODEL || "qwen3.5:9b").trim();
  const prompt = [
    "Read this image and extract all visible readable text.",
    "Return one line with text exactly as visible.",
    "If there is no readable text, return EMPTY.",
  ].join(" ");
  try {
    const res = await runWithStreaming({
      cmd: "node",
      args: [path.join(ROOT, "command/see_vl_runner.mjs"), "--host", verifyHost, "--model", model, "--image", imagePath, "--prompt", prompt],
      cwd: ROOT,
      timeoutMs: 120000,
      label: "background-ocr",
    });
    const observed = normalizeOverlayText(String(res.stdout || ""));
    if (/^empty$/iu.test(observed)) return "";
    return observed;
  } catch {
    return "";
  }
}

async function verifyRenderedOverlayWords({
  imagePath,
  expectedOverlay,
  minWords = 3,
  maxWords = 8,
}) {
  const verifyHost = String(process.env.OLLAMA_HOST || "http://mriczo:11434").trim();
  const verifyModels = [
    String(process.env.DRAW_OVERLAY_VERIFY_MODEL || "").trim(),
    "qwen3.5:9b",
  ].filter(Boolean);
  const uniqModels = [...new Set(verifyModels)];

  const prompt = [
    "Read this image and extract all visible readable text.",
    "Return one line with text exactly as visible.",
    "If multiple text regions exist, include them all in reading order.",
  ].join(" ");

  let lastError = "";
  for (const model of uniqModels) {
    try {
      const res = await runWithStreaming({
        cmd: "node",
        args: [
          path.join(ROOT, "command/see_vl_runner.mjs"),
          "--host",
          verifyHost,
          "--model",
          model,
          "--image",
          imagePath,
          "--prompt",
          prompt,
        ],
        cwd: ROOT,
        timeoutMs: 2 * 60 * 1000,
        label: "verify-overlay-ocr",
      });
      const observedAll = normalizeOverlayText(String(res.stdout || ""));
      const candidate = normalizeOverlayText(extractOverlayCandidate(observedAll));
      if (!candidate) throw new Error(`empty overlay text from model ${model}`);
      const lc = candidate.toLowerCase();
      if (
        /\b(no|none|cannot|unable|did not|could not)\b/iu.test(lc) ||
        /\b(detect|detected|visible|headline text|overlay text)\b/iu.test(lc)
      ) {
        throw new Error(`model ${model} returned non-overlay/meta text "${candidate}"`);
      }
      const verify = verifyCoverOverlayText({
        expectedText: expectedOverlay,
        observedText: candidate,
        observedAllText: observedAll,
        minWords,
        maxWords,
      });
      if (!verify.pass) {
        throw new Error(`model ${model} extracted "${candidate}" but verify failed: ${verify.failures.join(", ")}`);
      }
      process.stdout.write(
        `[meeting-cover] overlay verify model=${model} expected="${expectedOverlay}" extracted="${candidate}" words=${countWords(candidate)}\n`
      );
      return { model, extracted: candidate, observedAll };
    } catch (err) {
      lastError = String(err?.message || err);
    }
  }
  throw new Error(`thumbnail overlay verification failed: ${lastError || "no successful vision extraction"}`);
}

function runWithStreaming({ cmd, args, cwd = ROOT, timeoutMs = 45 * 60 * 1000, label = 'draw' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk ?? '');
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk ?? '');
      stderr += text;
      process.stderr.write(text);
    });

    const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(10_000, Number(timeoutMs) || 10_000));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${label} failed (code=${code ?? 'null'} signal=${signal ?? ''})\n${stderr || stdout}`.trim()));
    });
  });
}

async function forceSquare512(inputPath, outputPath, cwd = ROOT) {
  await runWithStreaming({
    cmd: 'ffmpeg',
    args: [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=512:512:force_original_aspect_ratio=increase,crop=512:512',
      '-frames:v',
      '1',
      '-update',
      '1',
      outputPath,
    ],
    cwd,
    timeoutMs: 3 * 60 * 1000,
    label: 'meeting-cover-square-512',
  });
}


async function generateSafeBackgroundFallback(outputPath, size = 512, cwd = ROOT) {
  const vf = [
    "color=c=#243748:s=" + size + "x" + size,
    "format=rgba",
    "drawgrid=w=64:h=64:t=1:c=white@0.10",
    "drawbox=x=0:y=" + Math.floor(size * 0.58) + ":w=" + size + ":h=" + Math.floor(size * 0.42) + ":color=black@0.25:t=fill",
    "gblur=sigma=0.6",
  ].join(",");
  await runWithStreaming({
    cmd: "ffmpeg",
    args: ["-y", "-f", "lavfi", "-i", vf, "-frames:v", "1", outputPath],
    cwd,
    timeoutMs: 120000,
    label: "safe-background-fallback",
  });
}

function deriveRunCwdFromTranscriptDir(transcriptDir) {
  const abs = path.resolve(String(transcriptDir || ''));
  const marker = `${path.sep}artifacts${path.sep}`;
  const idx = abs.indexOf(marker);
  if (idx > 0) {
    const candidate = abs.slice(0, idx);
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return ROOT;
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefix = String(process.argv[3] || 'meeting-qwen-auto-normalized').trim();
  const style = String(process.argv[4] || process.env.OWEN_DRAW_STYLE || DEFAULT_STYLE).trim();
  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = path.resolve(process.cwd(), transcriptDirArg);
  const drawRunCwd = deriveRunCwdFromTranscriptDir(transcriptDir);
  const hookPath = path.join(transcriptDir, `${prefix}.meeting-hook.txt`);
  const meetingSummaryPath = path.join(transcriptDir, `${prefix}.meeting-summary.md`);
  const lemmyPostJsonPath = path.join(transcriptDir, `${prefix}.lemmy-post.json`);
  const thumbnailSourcePath = path.join(transcriptDir, `${prefix}.thumbnail-source.md`);
  const coverImagePath = path.join(transcriptDir, `${prefix}.meeting-cover.png`);
  const coverImageStablePath = path.join(transcriptDir, 'meeting-cover.png');
  const overlayInputPath = path.join(transcriptDir, `${prefix}.cover-overlay.input.pya`);
  const overlayDerivedPath = path.join(transcriptDir, `${prefix}.cover-overlay.derived.pya`);
  const overlayVerifyPath = path.join(transcriptDir, `${prefix}.cover-overlay.verify.pya`);
  const overlayFinalPath = path.join(transcriptDir, `${prefix}.cover-overlay.final.pya`);
  const coverPromptifyPath = path.join(transcriptDir, `${prefix}.cover-promptify.pya`);
  const coverBackgroundDiagnosticPath = path.join(transcriptDir, `${prefix}.cover-background.diagnostic.pya`);
  const coverBackgroundAttemptsPath = path.join(transcriptDir, `${prefix}.cover-background.attempts.pya`);

  const hookText = safeReadText(hookPath, '').trim();
  const meetingSummaryText = safeReadText(meetingSummaryPath, '').trim();
  const topNewsworthy = extractMarkdownSection(meetingSummaryText, 'Top Newsworthy Developments');
  const oneSentenceSummary = extractMarkdownSection(meetingSummaryText, "One-Sentence Summary").split("\n").find((line) => line.trim()) || "";

  const overlayDecision = selectCoverOverlaySource({
    lemmyPostJsonPath,
    meetingSummaryMd: meetingSummaryText,
    meetingHookText: hookText,
  });
  const overlaySourceText = overlayDecision.selectedOverlayText || "City Meeting Update";
  const topNewsForPrompt = overlayDecision.sourceDisagreementDetected
    ? "municipal roadwork, downtown streetscape, and infrastructure decision context"
    : (topNewsworthy || meetingSummaryText);
  const overlayDerived = deriveCoverOverlayText({ sourceText: overlaySourceText, minWords: 3, maxWords: 6 });
  const shortOverlay = overlayDerived.finalOverlayText;
  verifyOverlayWordRange(shortOverlay, 3, 6);

  const promptify = runCoverPromptifyStage({
    hookText: shortOverlay,
    oneSentenceSummary,
    topNews: topNewsForPrompt,
    jurisdiction: "Owen Sound",
    meetingType: "council meeting",
    style,
    overlayText: shortOverlay,
    reportPath: coverPromptifyPath,
  });
  const promptSpec = {
    positivePrompt: promptify.positivePrompt,
    negativePrompt: promptify.negativePrompt,
  };

  const thumbnailSource = [
    '# Thumbnail Brief',
    promptSpec.positivePrompt,
    '',
    '# Negative Prompt',
    promptSpec.negativePrompt,
    '',
    '# Context',
    hookText || 'Council Meeting Highlights',
    topNewsForPrompt,
  ].join('\n').trim();
  fs.writeFileSync(thumbnailSourcePath, `${thumbnailSource}\n`, 'utf8');

  const backgroundAttempts = [];
  async function renderBackgroundAttempt(outputPath, attemptLabel, strictNegative = false, promptOverride = "") {
    const neg = strictNegative
      ? `${promptSpec.negativePrompt}, typographic characters, stray glyphs, alphanumeric marks`
      : promptSpec.negativePrompt;
    await runWithStreaming({
      cmd: 'node',
      args: [
        path.join(ROOT, 'command/draw_comfyui_runner.mjs'),
        '--prompt',
        (promptOverride || promptSpec.positivePrompt),
        '--negative-prompt',
        neg,
        '--workflow-root',
        path.join(ROOT, 'draw'),
        '--workflow-name',
        String(process.env.PYA_DRAW_WORKFLOW_DEFAULT || 'Z-Image-TSV'),
        '--host',
        String(process.env.PYA_DRAW_HOST || 'http://mriczo:8188'),
        '--output',
        outputPath,
        '--width',
        '1024',
        '--height',
        '1024',
      ],
      cwd: drawRunCwd,
      timeoutMs: 45 * 60 * 1000,
      label: 'draw-meeting-cover-background',
    });

    const squarePath = `${outputPath}.square.tmp.png`;
    await forceSquare512(outputPath, squarePath, drawRunCwd);
    const observedText = await observeVisibleTextRaw(squarePath);
    const diag = await diagnoseCoverBackground({
      backgroundPath: squarePath,
      observedBackgroundText: observedText,
      selectedOverlayText: shortOverlay,
      rejectedOverlayTexts: overlayDecision.rejectedOverlayTexts,
      sourceDisagreementDetected: overlayDecision.sourceDisagreementDetected,
      backgroundKind: 'generated_scene',
      visualSubject: promptify.selectedVisualSubject,
      abstractFallbackAllowed: false,
      promptText: `${(promptOverride || promptSpec.positivePrompt)}\nNEG:${neg}`,
      selectedOverlayTextHash: '',
      reportPath: '',
    });

    backgroundAttempts.push({
      label: attemptLabel,
      outputPath,
      squarePath,
      observedText,
      diagnostics: diag,
      accepted: Boolean(diag.backgroundUseful && diag.backgroundRelevancePass),
      rejectionReasons: diag.failureReasons,
    });
    return { squarePath, observedText, diag };
  }

  const backgroundOutputPath = path.join(transcriptDir, prefix + '.meeting-cover.background.generated.png');
  const retryBackgroundOutputPath = path.join(transcriptDir, prefix + '.meeting-cover.background.generated.retry-1.png');

  let chosenBackgroundPath = '';
  let backgroundDiagnostic = null;

  const first = await renderBackgroundAttempt(backgroundOutputPath, 'generated_attempt_1', false);
  backgroundDiagnostic = first.diag;
  if (backgroundDiagnostic.backgroundUseful && backgroundDiagnostic.backgroundRelevancePass) {
    chosenBackgroundPath = first.squarePath;
  } else {
    const retryPrompt = buildRetryPromptForBackgroundRisk({ visualSubject: promptify.selectedVisualSubject, positivePrompt: promptSpec.positivePrompt });
    const second = await renderBackgroundAttempt(retryBackgroundOutputPath, 'generated_attempt_2_strict_negative', true, retryPrompt);
    backgroundDiagnostic = second.diag;
    if (backgroundDiagnostic.backgroundUseful && backgroundDiagnostic.backgroundRelevancePass) {
      chosenBackgroundPath = second.squarePath;
    }
  }

  if (!chosenBackgroundPath) {
    const safeBgPath = `${coverImagePath}.background.safe.png`;
    await generateSafeBackgroundFallback(safeBgPath, 512, drawRunCwd);
    const safeDiag = await diagnoseCoverBackground({
      backgroundPath: safeBgPath,
      observedBackgroundText: '',
      selectedOverlayText: shortOverlay,
      rejectedOverlayTexts: overlayDecision.rejectedOverlayTexts,
      sourceDisagreementDetected: false,
      backgroundKind: 'abstract_fallback',
      visualSubject: promptify.selectedVisualSubject,
      abstractFallbackAllowed: false,
      promptText: 'safe_background_fallback',
      selectedOverlayTextHash: '',
      reportPath: '',
    });
    backgroundAttempts.push({
      label: 'abstract_fallback',
      outputPath: safeBgPath,
      squarePath: safeBgPath,
      observedText: '',
      diagnostics: safeDiag,
      accepted: false,
      rejectionReasons: safeDiag.failureReasons,
    });
    backgroundDiagnostic = safeDiag;
    chosenBackgroundPath = safeBgPath;
  }

  writePyaReport(coverBackgroundAttemptsPath, {
    selectedOverlayText: shortOverlay,
    visualSubject: promptify.selectedVisualSubject,
    attempts: backgroundAttempts,
  });

  backgroundDiagnostic = await diagnoseCoverBackground({
    backgroundPath: chosenBackgroundPath,
    observedBackgroundText: '',
    selectedOverlayText: shortOverlay,
    rejectedOverlayTexts: overlayDecision.rejectedOverlayTexts,
    sourceDisagreementDetected: overlayDecision.sourceDisagreementDetected,
    backgroundKind: backgroundDiagnostic?.backgroundKind || (String(chosenBackgroundPath).includes('.background.safe.') ? 'abstract_fallback' : 'generated_scene'),
    visualSubject: promptify.selectedVisualSubject,
    abstractFallbackAllowed: false,
    promptText: `${promptSpec.positivePrompt}\nNEG:${promptSpec.negativePrompt}`,
    selectedOverlayTextHash: '',
    reportPath: coverBackgroundDiagnosticPath,
  });

  await runCoverOverlayStage({
    stageInput: {
      backgroundPath: chosenBackgroundPath,
      overlayText: overlaySourceText,
      outputPath: coverImagePath,
      imageSizeTarget: 512,
      imageTextMode: "deterministic",
      legacyModelTextUsed: false,
      hookText,
      contextTopNews: topNewsForPrompt,
      backgroundPrompt: promptSpec.positivePrompt,
      backgroundNegativePrompt: promptSpec.negativePrompt,
      overlaySource: overlayDecision.overlaySource,
      overlaySourcePath: overlayDecision.overlaySourcePath,
      overlaySourceFreshness: overlayDecision.overlaySourceFreshness,
      candidateOverlayTexts: overlayDecision.candidateOverlayTexts,
      selectedOverlayText: overlayDecision.selectedOverlayText,
      rejectedOverlayTexts: overlayDecision.rejectedOverlayTexts,
      sourceDisagreementDetected: overlayDecision.sourceDisagreementDetected,
      backgroundUseful: backgroundDiagnostic.backgroundUseful,
      backgroundDiagnosticPath: coverBackgroundDiagnosticPath,
      backgroundFailureReasons: backgroundDiagnostic.failureReasons,
      safeBackgroundFallbackUsed: String(chosenBackgroundPath).includes(".background.safe."),
      safeBackgroundPath: String(chosenBackgroundPath).includes(".background.safe.") ? chosenBackgroundPath : "",
      backgroundKind: String(chosenBackgroundPath).includes(".background.safe.") ? "abstract_fallback" : "generated_scene",
      backgroundRelevancePass: Boolean(backgroundDiagnostic?.backgroundRelevancePass),
      backgroundRelevanceReason: String(backgroundDiagnostic?.backgroundRelevanceReason || ""),
      abstractFallbackUsed: String(chosenBackgroundPath).includes(".background.safe."),
      abstractFallbackAllowed: false,
      visualSubject: String(promptify.selectedVisualSubject || ""),
      coverBackgroundAttemptsPath,
    },
    deriveOverlay: () => overlayDerived,
    observeOverlay: async () => ({
      observedText: "",
      observedAllText: "",
      outsideOverlayText: "",
      observeError: "overlay_ocr_skipped_deterministic_mode",
    }),
    verifyOverlay: ({ finalOverlayText, observedText, observedAllText, outsideOverlayText }) => verifyCoverOverlayText({
      expectedText: finalOverlayText,
      observedText,
      observedAllText,
      outsideOverlayText,
      minWords: 3,
      maxWords: 8,
      requireNoExtraVisibleText: true,
    }),
    renderDeterministic: async ({ backgroundPath, finalOverlayText, outputPath }) => renderDeterministicOverlay({
      backgroundPath,
      overlayText: finalOverlayText,
      outputPath,
      size: 512,
      cwd: drawRunCwd,
    }),
    reports: {
      input: overlayInputPath,
      derived: overlayDerivedPath,
      verify: overlayVerifyPath,
      final: overlayFinalPath,
    },
    diagnoseFinalBackground: async ({ finalImagePath }) => diagnoseCoverBackground({
      backgroundPath: finalImagePath,
      observedBackgroundText: "",
      selectedOverlayText: shortOverlay,
      rejectedOverlayTexts: overlayDecision.rejectedOverlayTexts,
      sourceDisagreementDetected: false,
      backgroundKind: String(chosenBackgroundPath).includes(".background.safe.") ? "abstract_fallback" : "transformed_generated_scene",
      visualSubject: String(promptify.selectedVisualSubject || ""),
      abstractFallbackAllowed: false,
      promptText: "final_composite_check",
      reportPath: "",
    }),
  });

  for (const a of backgroundAttempts) {
    try { if (String(a.squarePath || "").endsWith(".square.tmp.png")) fs.unlinkSync(a.squarePath); } catch {}
  }
  fs.copyFileSync(coverImagePath, coverImageStablePath);

  process.stdout.write(`[meeting-cover] source: ${chosenBackgroundPath}\n`);
  process.stdout.write(`[meeting-cover] thumbnail source: ${thumbnailSourcePath}\n`);
  process.stdout.write(`[meeting-cover] wrote: ${coverImagePath}\n`);
  process.stdout.write(`[meeting-cover] wrote: ${coverImageStablePath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
