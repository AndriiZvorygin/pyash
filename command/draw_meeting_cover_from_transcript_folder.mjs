#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from "node:url";

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(COMMAND_DIR, "..");
const RUN_BIN = path.join(ROOT, 'run');
const DEFAULT_STYLE = 'bold civic poster background, no person required, high contrast, simple geometry, strong readability';

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

function parseGeneratedImagePath(drawStdout, sourceFilename) {
  const text = String(drawStdout || '');
  const escapedRoot = ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const imagePathRe = new RegExp(`${escapedRoot}\\/(?:artifacts|know\\/produce)\\/[^\\s"']+\\.png`, 'gu');
  const matches = [...text.matchAll(imagePathRe)].map((m) => m[0]);
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (existsFile(matches[i])) return matches[i];
  }
  const stem = sanitizeStem(sourceFilename);
  const fallback = path.join(ROOT, 'know/produce', `${stem}.png`);
  return existsFile(fallback) ? fallback : '';
}

function toShortOverlay(hookText) {
  const words = String(hookText || '')
    .replace(/[^A-Za-z0-9\s-]/gu, ' ')
    .split(/\s+/u)
    .map((w) => w.trim())
    .filter(Boolean);
  if (!words.length) return 'City Meeting Update';
  if (words.length >= 4) return words.slice(0, 4).join(' ');
  if (words.length === 3) return words.join(' ');
  if (words.length === 2) return `${words[0]} ${words[1]} Update`;
  return `${words[0]} City Update`;
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

function tokenSet(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/\s+/u)
      .map((x) => x.trim())
      .filter((x) => x && x.length >= 3)
  );
}

async function verifyRenderedOverlayWords({
  imagePath,
  expectedOverlay,
  minWords = 3,
  maxWords = 6,
}) {
  const verifyHost = String(process.env.OLLAMA_HOST || "http://mriczo:11434").trim();
  const verifyModels = [
    String(process.env.DRAW_OVERLAY_VERIFY_MODEL || "").trim(),
    "qwen3.5:9b",
  ].filter(Boolean);
  const uniqModels = [...new Set(verifyModels)];

  const prompt = [
    "Read this image and extract only the large overlay headline text.",
    "Return only that overlay text phrase.",
    "Do not add explanation.",
    "If unsure, return your best guess of the large overlaid words.",
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
      const candidate = normalizeOverlayText(extractOverlayCandidate(res.stdout));
      if (!candidate) throw new Error(`empty overlay text from model ${model}`);
      const lc = candidate.toLowerCase();
      if (
        /\b(no|none|cannot|unable|did not|could not)\b/iu.test(lc) ||
        /\b(detect|detected|visible|headline text|overlay text)\b/iu.test(lc)
      ) {
        throw new Error(`model ${model} returned non-overlay/meta text "${candidate}"`);
      }
      const words = countWords(candidate);
      if (words < minWords || words > maxWords) {
        throw new Error(`model ${model} extracted "${candidate}" (${words} words), expected ${minWords}-${maxWords}`);
      }
      const expectedTokens = tokenSet(expectedOverlay);
      const candidateTokens = tokenSet(candidate);
      let overlap = 0;
      for (const t of candidateTokens) {
        if (expectedTokens.has(t)) overlap += 1;
      }
      const minOverlap = Math.min(2, expectedTokens.size);
      if (minOverlap > 0 && overlap < minOverlap) {
        throw new Error(
          `model ${model} extracted "${candidate}" but token overlap ${overlap}/${expectedTokens.size} is too low for expected "${expectedOverlay}"`
        );
      }
      process.stdout.write(
        `[meeting-cover] overlay verify model=${model} expected="${expectedOverlay}" extracted="${candidate}" words=${words}\n`
      );
      return { model, extracted: candidate, words };
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

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefix = String(process.argv[3] || 'meeting-qwen-auto-normalized').trim();
  const style = String(process.argv[4] || process.env.OWEN_DRAW_STYLE || DEFAULT_STYLE).trim();
  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = path.resolve(process.cwd(), transcriptDirArg);
  const hookPath = path.join(transcriptDir, `${prefix}.meeting-hook.txt`);
  const meetingSummaryPath = path.join(transcriptDir, `${prefix}.meeting-summary.md`);
  const thumbnailSourcePath = path.join(transcriptDir, `${prefix}.thumbnail-source.md`);
  const coverImagePath = path.join(transcriptDir, `${prefix}.meeting-cover.png`);
  const coverImageStablePath = path.join(transcriptDir, 'meeting-cover.png');

  const hookText = safeReadText(hookPath, '').trim();
  const meetingSummaryText = safeReadText(meetingSummaryPath, '').trim();
  const topNewsworthy = extractMarkdownSection(meetingSummaryText, 'Top Newsworthy Developments');
  const shortOverlay = toShortOverlay(hookText);
  verifyOverlayWordRange(shortOverlay, 3, 6);
  const thumbnailSource = [
    '# Thumbnail Brief',
    'Create a square civic thumbnail.',
    `Overlay text should be 3-6 words: "${shortOverlay}".`,
    'Do not require a person in frame. Prefer symbolic/atmospheric municipal background.',
    '',
    '# Hook (context only)',
    hookText || 'Council Meeting Highlights',
    '',
    '# Top Newsworthy Developments',
    topNewsworthy || meetingSummaryText,
  ].join('\n').trim();
  fs.writeFileSync(thumbnailSourcePath, `${thumbnailSource}\n`, 'utf8');

  const drawOut = await runWithStreaming({
    cmd: RUN_BIN,
    args: [
      path.join(ROOT, 'examples/pyash/draw-thumbnail-from-filename.pya'),
      thumbnailSourcePath,
      style,
      '--verbose',
    ],
    cwd: ROOT,
    timeoutMs: 45 * 60 * 1000,
    label: 'draw-meeting-cover',
  });

  const generated = parseGeneratedImagePath(drawOut.stdout, thumbnailSourcePath);
  if (!generated) throw new Error('could not find generated image path in draw output');

  await verifyRenderedOverlayWords({
    imagePath: generated,
    expectedOverlay: shortOverlay,
    minWords: 3,
    maxWords: 6,
  });

  fs.copyFileSync(generated, coverImagePath);
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
