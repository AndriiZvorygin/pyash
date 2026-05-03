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
} from "../program/library/reporter_shared/cover-overlay-stage.mjs";
import { buildBackgroundPromptSpec, TEXT_EXCLUSION_NEGATIVE } from "../program/library/reporter_shared/cover-prompt-policy.mjs";

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
  const thumbnailSourcePath = path.join(transcriptDir, `${prefix}.thumbnail-source.md`);
  const coverImagePath = path.join(transcriptDir, `${prefix}.meeting-cover.png`);
  const coverImageStablePath = path.join(transcriptDir, 'meeting-cover.png');
  const overlayInputPath = path.join(transcriptDir, `${prefix}.cover-overlay.input.pya`);
  const overlayDerivedPath = path.join(transcriptDir, `${prefix}.cover-overlay.derived.pya`);
  const overlayVerifyPath = path.join(transcriptDir, `${prefix}.cover-overlay.verify.pya`);
  const overlayFinalPath = path.join(transcriptDir, `${prefix}.cover-overlay.final.pya`);

  const hookText = safeReadText(hookPath, '').trim();
  const meetingSummaryText = safeReadText(meetingSummaryPath, '').trim();
  const topNewsworthy = extractMarkdownSection(meetingSummaryText, 'Top Newsworthy Developments');
  const overlaySourceText = hookText || 'City Meeting Update';
  const overlayDerived = deriveCoverOverlayText({ sourceText: overlaySourceText, minWords: 3, maxWords: 6 });
  const shortOverlay = overlayDerived.finalOverlayText;
  verifyOverlayWordRange(shortOverlay, 3, 6);
  const promptSpec = buildBackgroundPromptSpec({
    style,
    hookText,
    topNewsworthy: topNewsworthy || meetingSummaryText,
    overlayText: shortOverlay,
    imageTextMode: "deterministic",
  });

  const thumbnailSource = [
    '# Thumbnail Brief',
    promptSpec.positivePrompt,
    '',
    '# Negative Prompt',
    promptSpec.negativePrompt,
    '',
    '# Context',
    hookText || 'Council Meeting Highlights',
    topNewsworthy || meetingSummaryText,
  ].join('\n').trim();
  fs.writeFileSync(thumbnailSourcePath, `${thumbnailSource}\n`, 'utf8');

  const backgroundOutputPath = path.join(transcriptDir, prefix + '.meeting-cover.background.generated.png');
  await runWithStreaming({
    cmd: 'node',
    args: [
      path.join(ROOT, 'command/draw_comfyui_runner.mjs'),
      '--prompt',
      promptSpec.positivePrompt,
      '--negative-prompt',
      promptSpec.negativePrompt,
      '--workflow-root',
      path.join(ROOT, 'draw'),
      '--workflow-name',
      String(process.env.PYA_DRAW_WORKFLOW_DEFAULT || 'Z-Image-TSV'),
      '--host',
      String(process.env.PYA_DRAW_HOST || 'http://mriczo:8188'),
      '--output',
      backgroundOutputPath,
      '--width',
      '1024',
      '--height',
      '1024',
    ],
    cwd: drawRunCwd,
    timeoutMs: 45 * 60 * 1000,
    label: 'draw-meeting-cover-background',
  });

  const generated = existsFile(backgroundOutputPath) ? backgroundOutputPath : '';
  if (!generated) throw new Error('could not find generated image path in draw output');

  const squareBackgroundPath = `${coverImagePath}.background.square.tmp.png`;
  await forceSquare512(generated, squareBackgroundPath, drawRunCwd);

  await runCoverOverlayStage({
    stageInput: {
      backgroundPath: squareBackgroundPath,
      overlayText: overlaySourceText,
      outputPath: coverImagePath,
      imageSizeTarget: 512,
      imageTextMode: "deterministic",
      legacyModelTextUsed: false,
      hookText,
      contextTopNews: topNewsworthy,
      backgroundPrompt: promptSpec.positivePrompt,
      backgroundNegativePrompt: promptSpec.negativePrompt,
    },
    deriveOverlay: () => overlayDerived,
    observeOverlay: async ({ backgroundPath, outputPath }) => {
      const targetImagePath = outputPath && existsFile(outputPath) ? outputPath : backgroundPath;
      const observed = await verifyRenderedOverlayWords({
        imagePath: targetImagePath,
        expectedOverlay: shortOverlay,
        minWords: 3,
        maxWords: 8,
      });
      const observedAllText = observed.observedAll || observed.extracted;
      const expectedWords = new Set(shortOverlay.toLowerCase().split(/\s+/u).filter(Boolean));
      const outsideOverlayText = observedAllText
        .split(/\s+/u)
        .filter((w) => w && !expectedWords.has(w.toLowerCase()))
        .join(" ");
      return { observedText: observed.extracted, observedAllText, outsideOverlayText, observedModel: observed.model };
    },
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
  });

  try { fs.unlinkSync(squareBackgroundPath); } catch {}
  fs.copyFileSync(coverImagePath, coverImageStablePath);

  process.stdout.write(`[meeting-cover] source: ${generated}\n`);
  process.stdout.write(`[meeting-cover] thumbnail source: ${thumbnailSourcePath}\n`);
  process.stdout.write(`[meeting-cover] wrote: ${coverImagePath}\n`);
  process.stdout.write(`[meeting-cover] wrote: ${coverImageStablePath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
