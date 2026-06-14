#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureStarted, identify, discharge, stop } from './speaker_runner.mjs';

let __speakerCleanupDone = false;
async function cleanupSpeakerRunner(reason = '') {
  if (__speakerCleanupDone) return;
  __speakerCleanupDone = true;
  try { await discharge(); } catch {}
  try { await stop(); } catch {}
  if (reason) {
    try { process.stdout.write(`[speaker-sentence] cleanup: ${reason}\n`); } catch {}
  }
}

process.on('SIGINT', () => {
  cleanupSpeakerRunner('SIGINT').finally(() => process.exit(130));
});
process.on('SIGTERM', () => {
  cleanupSpeakerRunner('SIGTERM').finally(() => process.exit(143));
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CUES = (() => {
  const raw = Number(process.env.PYA_SPEAKER_MAX_CUES || process.env.OWEN_SPEAKER_MAX_CUES || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
})();
const MIN_IDENTIFY_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_MIN_IDENTIFY_SECONDS || 2.2);
  return Number.isFinite(raw) && raw > 0 ? raw : 2.2;
})();
const MIN_IDENTIFY_WORDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_MIN_IDENTIFY_WORDS || 6);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
})();
const SAME_SPEAKER_THRESHOLD = (() => {
  const raw = Number(process.env.PYA_SPEAKER_SAME_THRESHOLD || 0.58);
  return Number.isFinite(raw) ? raw : 0.58;
})();
const KNOWN_SPEAKER_THRESHOLD = (() => {
  const raw = Number(process.env.PYA_SPEAKER_KNOWN_THRESHOLD || 0.68);
  return Number.isFinite(raw) ? raw : 0.68;
})();
const NAME_LOCK_THRESHOLD = (() => {
  const raw = Number(process.env.PYA_SPEAKER_NAME_LOCK_THRESHOLD || 0.62);
  return Number.isFinite(raw) ? raw : 0.62;
})();
const NAME_LOCK_MIN_WINDOWS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_NAME_LOCK_MIN_WINDOWS || 2);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
})();
const NAME_LOCK_WINDOW_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_NAME_LOCK_WINDOW_SECONDS || 90);
  return Number.isFinite(raw) && raw > 0 ? raw : 90;
})();
const TURN_MAX_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_TURN_MAX_SECONDS || 14);
  return Number.isFinite(raw) && raw > 0 ? raw : 14;
})();
const TURN_MAX_WORDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_TURN_MAX_WORDS || 80);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 80;
})();
const TURN_MAX_GAP_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_TURN_MAX_GAP_SECONDS || 1.2);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1.2;
})();
const EDGE_PROBE_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_EDGE_PROBE_SECONDS || 3.2);
  return Number.isFinite(raw) && raw > 0 ? raw : 3.2;
})();
const BOUNDARY_REFINE_ENABLED = !/^(0|false|no)$/iu.test(String(process.env.PYA_SPEAKER_BOUNDARY_REFINE || '1'));
const BOUNDARY_REFINE_WINDOW = (() => {
  const raw = Number(process.env.PYA_SPEAKER_BOUNDARY_REFINE_WINDOW || 1);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 1;
})();
const BOUNDARY_REFINE_MIN_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_BOUNDARY_REFINE_MIN_SECONDS || 0.45);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.45;
})();
const PREDECODE_PCM_ENABLED = !/^(0|false|no)$/iu.test(String(process.env.PYA_SPEAKER_PREDECODE_PCM || '1'));
const IDENTIFY_RETRY_COUNT = (() => {
  const raw = Number(process.env.PYA_SPEAKER_IDENTIFY_RETRY_COUNT || 2);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 2;
})();
const IDENTIFY_RETRY_DELAY_MS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_IDENTIFY_RETRY_DELAY_MS || 350);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 350;
})();
const MIN_NEW_SPEAKER_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_MIN_NEW_SECONDS || 4.5);
  return Number.isFinite(raw) && raw > 0 ? raw : 4.5;
})();
const MIN_NEW_SPEAKER_WORDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_MIN_NEW_WORDS || 14);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 14;
})();
const MIN_NEW_SPEAKER_SIMILARITY = (() => {
  const raw = Number(process.env.PYA_SPEAKER_MIN_NEW_SIMILARITY || 0.55);
  return Number.isFinite(raw) ? raw : 0.55;
})();
const REASSIGN_PASS_ENABLED = /^(1|true|yes)$/iu.test(String(process.env.PYA_SPEAKER_REASSIGN_PASS || '0'));
const RELABEL_MODE = String(process.env.PYA_SPEAKER_RELABEL_MODE || '').trim().toLowerCase();
const EXPECTED_MAX_SPEAKERS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_EXPECTED_MAX || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
})();
const TWO_SPEAKER_CUE_TURNS = (() => {
  const raw = String(process.env.PYA_SPEAKER_TWO_SPEAKER_CUE_TURNS || '').trim();
  if (/^(0|false|no)$/iu.test(raw)) return false;
  if (/^(1|true|yes)$/iu.test(raw)) return true;
  return EXPECTED_MAX_SPEAKERS === 2;
})();
const REASSIGN_WINDOW_ROWS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_REASSIGN_WINDOW_ROWS || 12);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
})();
const BAD_SAMPLE_GUARD_ENABLED = /^(1|true|yes)$/iu.test(String(process.env.PYA_SPEAKER_BAD_SAMPLE_GUARD || '0'));
const BAD_SAMPLE_MIN_SECONDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_BAD_SAMPLE_MIN_SECONDS || 1.1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.1;
})();
const BAD_SAMPLE_MIN_WORDS = (() => {
  const raw = Number(process.env.PYA_SPEAKER_BAD_SAMPLE_MIN_WORDS || 3);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
})();
const BAD_SAMPLE_LOW_SPEECH_DENSITY = (() => {
  const raw = Number(process.env.PYA_SPEAKER_BAD_SAMPLE_LOW_SPEECH_DENSITY || 0.4);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.4;
})();
const UNKNOWN_SPEAKER_KEY = 'speaker_unknown';

function usage() {
  return [
    'Usage: node command/diarize_sentence_srt_from_transcript_folder.mjs <transcript_dir> [prefix] [voices_dir]',
    'Example: node command/diarize_sentence_srt_from_transcript_folder.mjs artifacts/.../transcript meeting-qwen-auto world/voices'
  ].join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableIdentifyError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("worker returned empty response") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up") ||
    msg.includes("connection reset")
  );
}

function isNoisyEdgeIdentifyError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("mixed_or_noisy_edges") ||
    msg.includes("speaker sample defective") ||
    msg.includes("edge_similarity")
  );
}

async function identifyWithRetry(payload, context = "") {
  let lastErr = null;
  for (let attempt = 0; attempt <= IDENTIFY_RETRY_COUNT; attempt += 1) {
    try {
      return await identify(payload);
    } catch (error) {
      if (isNoisyEdgeIdentifyError(error)) {
        const fallbackSpeaker = String(payload?.prevSpeaker || payload?.prev_speaker || "").trim() || UNKNOWN_SPEAKER_KEY;
        process.stdout.write(
          `[speaker-sentence] identify degraded ${context} reason="${String(error?.message || error)}" fallback="${fallbackSpeaker}"\n`
        );
        return {
          speaker: fallbackSpeaker,
          matched: "noisy_edges_rejected",
          similarity: null,
          sample_count: null,
          degraded: true,
        };
      }
      lastErr = error;
      const retryable = isRetryableIdentifyError(error);
      const canRetry = retryable && attempt < IDENTIFY_RETRY_COUNT;
      if (!canRetry) throw error;
      process.stdout.write(
        `[speaker-sentence] identify retry ${attempt + 1}/${IDENTIFY_RETRY_COUNT} ${context} reason="${String(error?.message || error)}"\n`
      );
      if (IDENTIFY_RETRY_DELAY_MS > 0) await sleep(IDENTIFY_RETRY_DELAY_MS);
    }
  }
  throw lastErr || new Error("identify failed");
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`directory not found: ${dirPath}`);
}

function parseSrtTime(raw) {
  const m = String(raw || '').match(/^(\d\d):(\d\d):(\d\d),(\d\d\d)$/);
  if (!m) return 0;
  const [, hh, mm, ss, ms] = m.map(Number);
  return (hh * 3600) + (mm * 60) + ss + (ms / 1000);
}

function splitCueTextForDiarize(text) {
  const src = String(text || '').replace(/\s+/gu, ' ').trim();
  if (!src) return [];
  const out = src
    .split(/(?<=[.!?])\s+/u)
    .map((x) => x.trim())
    .filter(Boolean);
  return out.length ? out : [src];
}

function expandCue(cue) {
  const text = String(cue?.text || '').trim();
  const since = Number(cue?.since || 0);
  const until = Number(cue?.until || since);
  const duration = Math.max(0.06, until - since);
  const words = text.split(/\s+/u).filter(Boolean).length;
  const pieces = splitCueTextForDiarize(text);
  const looksTooLong = duration > 18 || words > 90;
  if (!looksTooLong || pieces.length <= 1) return [cue];

  const weighted = pieces.map((p) => Math.max(1, p.split(/\s+/u).filter(Boolean).length));
  const total = weighted.reduce((a, b) => a + b, 0);
  const out = [];
  let cursor = since;
  for (let i = 0; i < pieces.length; i += 1) {
    const span = (duration * weighted[i]) / total;
    const end = i === pieces.length - 1 ? until : Math.max(cursor + 0.06, cursor + span);
    out.push({
      index: Number(cue?.index || 0),
      since: cursor,
      until: end,
      text: pieces[i],
    });
    cursor = end;
  }
  return out;
}

function formatSrtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalMs = Math.round(safe * 1000);
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function parseSrt(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const blocks = src.split(/\n{2,}/u).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const idx = Number(lines[0].trim());
    const timing = lines[1].trim();
    const tm = timing.match(/^(\d\d:\d\d:\d\d,\d\d\d)\s+-->\s+(\d\d:\d\d:\d\d,\d\d\d)$/);
    if (!tm) continue;
    const since = parseSrtTime(tm[1]);
    const until = parseSrtTime(tm[2]);
    const textLine = lines.slice(2).join(' ').replace(/\s+/g, ' ').trim();
    if (!textLine) continue;
    const baseCue = { index: Number.isFinite(idx) ? idx : out.length + 1, since, until, text: textLine };
    for (const c of expandCue(baseCue)) out.push(c);
  }
  return out;
}

function toDisplayLabel(speakerKey, metadataMap, lockedSpeakerKeys = null) {
  const key = String(speakerKey || '').trim();
  const meta = metadataMap.get(key) || {};
  const rawName = String(meta.name || '').trim();
  const hasLocks = lockedSpeakerKeys instanceof Set && lockedSpeakerKeys.size > 0;
  const lockAllowed = !hasLocks || lockedSpeakerKeys.has(key);
  if (lockAllowed && rawName && !/^speaker_\d+$/iu.test(rawName)) {
    return rawName.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }
  const m = key.match(/^speaker_(\d+)$/iu);
  if (m) return `SPEAKER_${String(Number(m[1])).padStart(3, '0')}`;
  if (rawName) return rawName.replace(/_/g, ' ');
  return key || 'SPEAKER_UNKNOWN';
}

function hasNamedMetadata(speakerKey, metadataMap) {
  const key = String(speakerKey || '').trim();
  if (!key) return false;
  const meta = metadataMap.get(key) || {};
  const rawName = String(meta.name || '').trim();
  return Boolean(rawName && !/^speaker_\d+$/iu.test(rawName));
}

function noteNameEvidence(evidenceMap, speakerKey, matched, similarity, since, metadataMap) {
  const key = String(speakerKey || '').trim();
  if (!key) return;
  if (!hasNamedMetadata(key, metadataMap)) return;
  if (!isKnownLike(matched)) return;
  const sim = Number(similarity);
  if (!Number.isFinite(sim) || sim < NAME_LOCK_THRESHOLD) return;
  const t = Math.max(0, Number(since) || 0);
  const window = Math.floor(t / NAME_LOCK_WINDOW_SECONDS);
  if (!evidenceMap.has(key)) evidenceMap.set(key, new Set());
  evidenceMap.get(key).add(window);
}

function buildLockedSpeakerKeys(evidenceMap) {
  const out = new Set();
  for (const [key, windows] of evidenceMap.entries()) {
    if ((windows?.size || 0) >= NAME_LOCK_MIN_WINDOWS) out.add(key);
  }
  return out;
}

function parseSpeakerMetaFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  const re = /^\s*su name (.+?) ob (.+?) ya\s*$/gmu;
  let m;
  while ((m = re.exec(text))) {
    const key = String(m[1] || '').trim();
    const body = String(m[2] || '').trim();
    if (body.startsWith('text ')) {
      const q = body.slice(5).trim();
      try { out[key] = JSON.parse(q); } catch { out[key] = q.replace(/^"|"$/g, ''); }
      continue;
    }
    if (body.startsWith('num ')) {
      const n = Number(body.slice(4).trim());
      if (Number.isFinite(n)) out[key] = n;
      continue;
    }
    if (body.startsWith('bool ')) {
      out[key] = body.slice(5).trim().toLowerCase() === 'truth';
    }
  }
  return out;
}

function loadSpeakerMetadataMap(voicesDir) {
  const out = new Map();
  if (!fs.existsSync(voicesDir)) return out;
  const files = fs.readdirSync(voicesDir)
    .filter((n) => n.endsWith('.pya') && n !== 'index.pya')
    .sort();
  for (const file of files) {
    const key = file.replace(/\.pya$/u, '');
    try {
      out.set(key, parseSpeakerMetaFile(path.join(voicesDir, file)));
    } catch {
      // ignore malformed metadata
    }
  }
  return out;
}

function loadSpeakerKeysFromVoicesDir(voicesDir) {
  const out = new Set();
  if (!fs.existsSync(voicesDir)) return out;
  const files = fs.readdirSync(voicesDir);
  for (const file of files) {
    const m = String(file || '').match(/^(speaker_\d+)\.(?:wav|npy|meta|pya)$/iu);
    if (!m) continue;
    out.add(String(m[1] || '').toLowerCase());
  }
  return out;
}

function pickAudioFile(transcriptDir) {
  const entries = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => /\.(opus|wav|mp3|m4a)$/iu.test(n));
  if (!entries.length) throw new Error(`no audio file found in ${transcriptDir}`);
  const rank = (n) => {
    const x = n.toLowerCase();
    if (x === 'meeting-audio.opus') return 1000;
    if (x === 'meeting-audio.wav') return 900;
    if (x.endsWith('.opus')) return 700;
    if (x.endsWith('.wav')) return 600;
    if (x.endsWith('.m4a')) return 500;
    if (x.endsWith('.mp3')) return 400;
    return 0;
  };
  const sorted = entries
    .map((name) => {
      const full = path.join(transcriptDir, name);
      const st = fs.statSync(full);
      return { name, full, rank: rank(name), size: Number(st.size || 0), mtime: Number(st.mtimeMs || 0) };
    })
    .sort((a, b) => b.rank - a.rank || b.size - a.size || b.mtime - a.mtime || a.name.localeCompare(b.name));
  return sorted[0].full;
}

function pickMergedSrt(transcriptDir, prefix) {
  if (prefix && prefix !== 'auto') {
    const exact = path.join(transcriptDir, `${prefix}.merged.srt`);
    if (!fs.existsSync(exact)) throw new Error(`merged srt missing: ${exact}`);
    return { mergedSrt: exact, resolvedPrefix: prefix };
  }
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith('.merged.srt'));
  if (!files.length) throw new Error(`no *.merged.srt found in ${transcriptDir}`);
  const ranked = files
    .map((name) => {
      const lower = name.toLowerCase();
      const st = fs.statSync(path.join(transcriptDir, name));
      let score = 0;
      if (lower.includes('.normalized.')) score += 50;
      if (lower.includes('.sentences.')) score += 30;
      if (lower.startsWith('meeting-qwen-auto')) score += 15;
      return { name, score, mtime: Number(st.mtimeMs || 0) };
    })
    .sort((a, b) => b.score - a.score || b.mtime - a.mtime || a.name.localeCompare(b.name));
  const chosen = ranked[0].name;
  return {
    mergedSrt: path.join(transcriptDir, chosen),
    resolvedPrefix: chosen.replace(/\.merged\.srt$/u, '')
  };
}

function ensureWavClip({ audioPath, since, until, outPath }) {
  const start = Math.max(0, Number(since) || 0);
  const end = Math.max(start + 0.2, Number(until) || start + 0.2);
  const duration = Math.max(0.2, end - start);
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', String(start),
    '-t', String(duration),
    '-i', audioPath,
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    outPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function ensurePcmSource({ audioPath, tmpDir }) {
  const pcmPath = path.join(tmpDir, 'source-16k-mono.wav');
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', audioPath,
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    pcmPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return pcmPath;
}

function copyVoicesSnapshot({ sourceDir, outDir, excludeSpeakerKey = '' }) {
  fs.mkdirSync(outDir, { recursive: true });
  const names = fs.readdirSync(sourceDir);
  for (const name of names) {
    const src = path.join(sourceDir, name);
    const dst = path.join(outDir, name);
    const st = fs.statSync(src, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) continue;
    if (excludeSpeakerKey && (
      name === `${excludeSpeakerKey}.npy` ||
      name === `${excludeSpeakerKey}.pya` ||
      name === `${excludeSpeakerKey}.wav`
    )) {
      continue;
    }
    fs.copyFileSync(src, dst);
  }
}

function seedWorkingVoicesDir({ baseDir, workingDir, reseed = false }) {
  if (reseed && fs.existsSync(workingDir)) {
    fs.rmSync(workingDir, { recursive: true, force: true });
  }
  const needsSeed = !fs.existsSync(path.join(workingDir, 'index.pya'));
  if (!needsSeed) return;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(workingDir, { recursive: true });
    return;
  }
  copyVoicesSnapshot({ sourceDir: baseDir, outDir: workingDir });
}

function removeSpeakerArtifacts({ voicesDir, speakerKey }) {
  if (!speakerKey) return;
  for (const ext of ['.npy', '.pya', '.wav']) {
    const p = path.join(voicesDir, `${speakerKey}${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function isKnownLike(matchKind) {
  const m = String(matchKind || '').trim().toLowerCase();
  return m === 'known' || m === 'prev' || m === 'known_merge_guard';
}

function enforceNoPseudoKnownForFreshKey({
  speakerKey,
  matched,
  preexistingSpeakerKeys,
  context,
}) {
  const key = String(speakerKey || '').trim();
  const match = String(matched || '').trim().toLowerCase();
  if (!key) return;
  if (!/^speaker_\d+$/iu.test(key)) return;
  if (!(preexistingSpeakerKeys instanceof Set)) return;
  if (preexistingSpeakerKeys.has(String(key).toLowerCase())) return;
  if (!isKnownLike(match)) return;
  process.stdout.write(`[speaker-sentence] guard-known reject key=\"${key}\" matched=\"${match}\" context=\"${context}\"\n`);
  return;
}

function applyNewSpeakerGuard({
  speakerKey,
  matched,
  similarity,
  duration,
  words,
  prevSpeaker,
  voicesDir,
}) {
  const key = String(speakerKey || '').trim();
  const match = String(matched || '').trim().toLowerCase();
  if (match !== 'new') {
    return { speakerKey: key || UNKNOWN_SPEAKER_KEY, matched, demoted: false, reason: '' };
  }
  const dur = Math.max(0, Number(duration) || 0);
  const w = Math.max(0, Number(words) || 0);
  const sim = Number(similarity);
  const failsDuration = dur < MIN_NEW_SPEAKER_SECONDS;
  const failsWords = w < MIN_NEW_SPEAKER_WORDS;
  const failsSimilarity = Number.isFinite(sim) && sim < MIN_NEW_SPEAKER_SIMILARITY;
  if (!(failsDuration || failsWords || failsSimilarity)) {
    return { speakerKey: key || UNKNOWN_SPEAKER_KEY, matched, demoted: false, reason: '' };
  }
  const fallback = String(prevSpeaker || '').trim() || UNKNOWN_SPEAKER_KEY;
  if (key && key !== fallback && /^speaker_\d+$/iu.test(key)) {
    removeSpeakerArtifacts({ voicesDir, speakerKey: key });
  }
  const reasons = [];
  if (failsDuration) reasons.push(`dur<${MIN_NEW_SPEAKER_SECONDS}`);
  if (failsWords) reasons.push(`words<${MIN_NEW_SPEAKER_WORDS}`);
  if (failsSimilarity) reasons.push(`sim<${MIN_NEW_SPEAKER_SIMILARITY}`);
  return {
    speakerKey: fallback,
    matched: fallback === UNKNOWN_SPEAKER_KEY ? 'fallback_unknown_short_new' : 'fallback_prev_short_new',
    demoted: true,
    reason: reasons.join(','),
  };
}

function renderSrt(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    out.push(String(i + 1));
    out.push(`${formatSrtTime(row.since)} --> ${formatSrtTime(row.until)}`);
    out.push(`${row.display}: ${row.text}`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

function previewText(text, maxLen = 84) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function fmtScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(3) : 'na';
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/u).filter(Boolean).length;
}

function countAlphaWords(text) {
  return String(text || '')
    .split(/\s+/u)
    .map((w) => w.replace(/[^a-z]/giu, '').toLowerCase())
    .filter(Boolean)
    .length;
}

function evaluateSampleQuality({ text, duration, words }) {
  const sampleText = String(text || '').trim();
  const dur = Math.max(0, Number(duration || 0));
  const wordCount = Number.isFinite(Number(words)) ? Number(words) : countWords(sampleText);
  const alphaWords = countAlphaWords(sampleText);
  const density = dur > 0 ? wordCount / dur : 0;
  const reasons = [];
  const evidence = [];

  if (!sampleText) {
    reasons.push('empty_text');
    evidence.push('no transcript text');
  }
  if (dur < BAD_SAMPLE_MIN_SECONDS) {
    reasons.push('too_short');
    evidence.push(`duration<${BAD_SAMPLE_MIN_SECONDS}s`);
  }
  if (wordCount < BAD_SAMPLE_MIN_WORDS) {
    reasons.push('too_few_words');
    evidence.push(`words<${BAD_SAMPLE_MIN_WORDS}`);
  }
  if (dur >= 3 && density < BAD_SAMPLE_LOW_SPEECH_DENSITY) {
    reasons.push('low_speech_density');
    evidence.push(`words/sec<${BAD_SAMPLE_LOW_SPEECH_DENSITY}`);
  }
  if (/\[(music|applause|noise|laughter|inaudible)\]|\b(music|applause|noise|laughter|inaudible)\b/iu.test(sampleText)) {
    reasons.push('non_speech_marker');
    evidence.push('contains non-speech marker');
  }
  if (/^(?:uh+|um+|hmm+|mm+|ah+|eh+|yeah+|okay+|right+|yep+|no+|yes+|well+|so+|you know)+[.!?]*$/iu.test(sampleText)) {
    reasons.push('filler_only');
    evidence.push('filler-only utterance');
  }
  if (alphaWords <= 1 && wordCount <= 4) {
    reasons.push('low_lexical_content');
    evidence.push('too little lexical speech');
  }
  if (/\b(go ahead|thank you)\b/iu.test(sampleText) && wordCount <= 6) {
    reasons.push('handoff_fragment');
    evidence.push('likely handoff fragment');
  }

  return {
    bad: reasons.length > 0,
    reasons,
    evidence,
    duration: dur,
    words: wordCount,
    text: sampleText,
  };
}

function noteSampleQuality(qualityBySpeaker, speakerKey, quality) {
  const key = String(speakerKey || '').trim() || UNKNOWN_SPEAKER_KEY;
  if (!qualityBySpeaker.has(key)) qualityBySpeaker.set(key, { good: 0, bad: 0, bad_reasons: {} });
  const cur = qualityBySpeaker.get(key);
  if (quality?.bad) {
    cur.bad += 1;
    for (const reason of quality.reasons || []) {
      cur.bad_reasons[reason] = Number(cur.bad_reasons[reason] || 0) + 1;
    }
  } else {
    cur.good += 1;
  }
}

function keyByRow(row) {
  return `${Number(row?.index || 0)}|${Number(row?.since || 0).toFixed(3)}|${Number(row?.until || 0).toFixed(3)}|${String(row?.text || '')}`;
}

function speakerTotals(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = String(r?.speaker_key || '').trim() || UNKNOWN_SPEAKER_KEY;
    const dur = Math.max(0, Number(r?.until || 0) - Number(r?.since || 0));
    if (!by.has(k)) by.set(k, { lines: 0, duration: 0 });
    const cur = by.get(k);
    cur.lines += 1;
    cur.duration += dur;
  }
  return [...by.entries()]
    .map(([speaker, v]) => ({ speaker, lines: v.lines, duration: v.duration }))
    .sort((a, b) => b.duration - a.duration || b.lines - a.lines || a.speaker.localeCompare(b.speaker));
}

function buildRuns(rows) {
  const out = [];
  if (!rows.length) return out;
  let start = 0;
  for (let i = 1; i <= rows.length; i += 1) {
    if (i < rows.length && String(rows[i].speaker_key || '') === String(rows[start].speaker_key || '')) continue;
    const slice = rows.slice(start, i);
    out.push({
      start,
      end: i - 1,
      speaker: String(rows[start].speaker_key || ''),
      lines: slice.length,
      duration: slice.reduce((n, r) => n + Math.max(0, Number(r.until || 0) - Number(r.since || 0)), 0),
      since: Number(rows[start].since || 0),
      until: Number(rows[i - 1].until || 0),
    });
    start = i;
  }
  return out;
}

function findHostSpeakerFromRows(rows) {
  const intro = rows.find((r) => /\b(i am|i'm)\s+andrii\b/iu.test(String(r?.text || '')));
  if (intro) return String(intro.speaker_key || '').trim();
  const interviewIntro = rows.find((r) => /\b(i am|i'm)\s+here\s+with\b/iu.test(String(r?.text || '')));
  if (interviewIntro) return String(interviewIntro.speaker_key || '').trim();
  return '';
}

function isHostCue(text) {
  const t = String(text || '');
  return /\b(go ahead|you read it|did you want|shall we|should i share|next question|joined here today|i have a question|going back to the question|posted about you|from my perspective|i'm wondering|what message do you|what changes do you)\b/iu.test(t)
    || /^\s*welcome[, ]/iu.test(t)
    || /^\s*would you like to introduce\b/iu.test(t);
}

function applySmallPanelReassign(rows, { expectedMax, windowRows, sampleQualityBySpeaker, badSampleDetails }) {
  const beforeRows = rows.map((r) => ({ ...r }));
  const totals = speakerTotals(rows);
  const totalsBySpeaker = new Map(totals.map((t) => [t.speaker, t]));
  const qualityBySpeaker = sampleQualityBySpeaker instanceof Map ? sampleQualityBySpeaker : new Map();
  const pickKeep = [];
  for (const t of totals) {
    const q = qualityBySpeaker.get(t.speaker) || { good: 0, bad: 0 };
    const totalSamples = Number(q.good || 0) + Number(q.bad || 0);
    const goodRatio = totalSamples > 0 ? Number(q.good || 0) / totalSamples : 0;
    const anchorEligible = Number(q.good || 0) > 0 || (totalSamples === 0 && t.duration >= 45);
    if (!anchorEligible) continue;
    if (totalSamples > 0 && goodRatio < 0.2) continue;
    pickKeep.push(t.speaker);
    if (pickKeep.length >= Math.max(1, expectedMax)) break;
  }
  const keep = new Set(pickKeep);
  const hostSpeaker = findHostSpeakerFromRows(rows);
  if (hostSpeaker && !keep.has(hostSpeaker) && keep.size >= expectedMax) {
    const replace = [...keep].at(-1);
    if (replace) keep.delete(replace);
  }
  if (hostSpeaker) keep.add(hostSpeaker);
  const guestSpeaker = [...keep].find((speaker) => speaker !== hostSpeaker) || '';

  const changes = [];
  const lowConfidenceSegments = [];
  void windowRows;

  // Pass A: host cue normalization.
  if (hostSpeaker) {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const cur = String(r.speaker_key || '');
      if (guestSpeaker && /\bmy name(?:'s| is)\s+ray\b/iu.test(String(r.text || ''))) {
        if (cur !== guestSpeaker) {
          rows[i].speaker_key = guestSpeaker;
          changes.push({
            type: 'guest_self_identification',
            index: i,
            from: cur,
            to: guestSpeaker,
            since: Number(r?.since || 0),
            until: Number(r?.until || 0),
            text: String(r?.text || ''),
            reason: 'guest_self_identification',
            confidence: 1,
            evidence: ['guest self-identification cue'],
          });
        }
        continue;
      }
      if (cur === hostSpeaker) continue;
      if (!isHostCue(r.text)) continue;
      rows[i].speaker_key = hostSpeaker;
      changes.push({
        type: 'host_cue',
        index: i,
        from: cur,
        to: hostSpeaker,
        since: Number(r?.since || 0),
        until: Number(r?.until || 0),
        text: String(r?.text || ''),
        reason: 'strong_host_cue',
        confidence: 0.95,
        evidence: ['host cue phrase'],
      });
    }
  }

  // Pass B: collapse non-keep runs to keep speakers only when evidence is explicit/strong.
  // Never smooth based on continuity/majority-window alone.
  const runs = buildRuns(rows);
  for (const run of runs) {
    if (keep.has(run.speaker)) continue;
    const runRows = rows.slice(run.start, run.end + 1);
    const runText = runRows.map((r) => String(r?.text || '')).join(' ').trim();
    const rowCount = runRows.length;
    const allHostCue = rowCount > 0 && runRows.every((r) => isHostCue(r.text));
    const speakerTotalsEntry = totalsBySpeaker.get(run.speaker) || { lines: run.lines, duration: run.duration };
    const isWeakLabel = speakerTotalsEntry.lines <= 6 || speakerTotalsEntry.duration <= 45;

    let target = '';
    let confidence = 0;
    let reason = 'insufficient_evidence';

    if (hostSpeaker && /\b(i am|i'm)\s+andrii(?:\s+zvorygin)?\b/iu.test(runText)) {
      target = hostSpeaker;
      confidence = 1;
      reason = 'explicit_self_identification';
    } else if (hostSpeaker && isWeakLabel && run.duration <= 12 && rowCount <= 3 && allHostCue) {
      target = hostSpeaker;
      confidence = 0.95;
      reason = 'strong_host_cue_run';
    }

    if (target && keep.has(target) && confidence >= 0.9) {
      for (let i = run.start; i <= run.end; i += 1) {
        const from = String(rows[i].speaker_key || '');
        if (from === target) continue;
        rows[i].speaker_key = target;
        changes.push({
          type: reason,
          index: i,
          from,
          to: target,
          since: Number(rows[i]?.since || 0),
          until: Number(rows[i]?.until || 0),
          text: String(rows[i]?.text || ''),
          reason,
          confidence,
          evidence: reason === 'explicit_self_identification'
            ? ['self-identification cue']
            : ['strong host cue run'],
        });
      }
    } else {
      lowConfidenceSegments.push({
        since: run.since,
        until: run.until,
        speaker: run.speaker,
        lines: run.lines,
        duration: run.duration,
        candidate: target || '',
        confidence,
        reason,
        text_sample: previewText(runRows.map((r) => String(r?.text || '')).join(' '), 180),
        no_auto_reassign: true,
      });
    }
  }

  // Pass C: in explicit two-speaker mode, weak stray labels are usually
  // borderline samples of one of the two real voices. Collapse them only when
  // adjacent kept-speaker context is available.
  if (expectedMax === 2 && keep.size >= 2) {
    const findNeighborKeep = (from, step) => {
      for (let i = from; i >= 0 && i < rows.length; i += step) {
        const key = String(rows[i]?.speaker_key || '').trim();
        if (keep.has(key)) return key;
      }
      return '';
    };
    for (const run of buildRuns(rows)) {
      if (keep.has(run.speaker)) continue;
      const speakerTotalsEntry = totalsBySpeaker.get(run.speaker) || { lines: run.lines, duration: run.duration };
      const isWeakLabel = (
        run.speaker === UNKNOWN_SPEAKER_KEY ||
        speakerTotalsEntry.lines <= 8 ||
        speakerTotalsEntry.duration <= 60
      );
      if (!isWeakLabel || run.lines > 8 || run.duration > 75) continue;
      const prevKeep = findNeighborKeep(run.start - 1, -1);
      const nextKeep = findNeighborKeep(run.end + 1, 1);
      const prevGap = run.start > 0 ? Math.max(0, run.since - Number(rows[run.start - 1]?.until || run.since)) : Number.POSITIVE_INFINITY;
      const nextGap = run.end + 1 < rows.length ? Math.max(0, Number(rows[run.end + 1]?.since || run.until) - run.until) : Number.POSITIVE_INFINITY;
      const target = prevKeep && nextKeep
        ? (prevKeep === nextKeep ? prevKeep : (nextGap < prevGap ? nextKeep : prevKeep))
        : (!prevKeep && nextKeep ? nextKeep : (prevKeep && !nextKeep ? prevKeep : ''));
      if (!target || !keep.has(target)) continue;
      for (let i = run.start; i <= run.end; i += 1) {
        const from = String(rows[i].speaker_key || '');
        if (from === target) continue;
        rows[i].speaker_key = target;
        changes.push({
          type: 'two_speaker_context_collapse',
          index: i,
          from,
          to: target,
          since: Number(rows[i]?.since || 0),
          until: Number(rows[i]?.until || 0),
          text: String(rows[i]?.text || ''),
          reason: 'two_speaker_context_collapse',
          confidence: prevKeep && nextKeep && prevKeep === nextKeep ? 0.88 : 0.72,
          evidence: ['expected two speakers', 'adjacent kept-speaker context'],
        });
      }
    }
  }

  // Pass D: tiny acknowledgements have too little audio/text to classify
  // reliably. In a two-person interview, when one sits directly between two
  // different established speakers, it is normally the start of the following
  // turn ("Sure.", "Okay, cool.", "That's right.").
  if (expectedMax === 2 && keep.size >= 2) {
    const isShortAcknowledgement = (text) => {
      const normalized = String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!normalized || countWords(normalized) > 4) return false;
      return /^(sure|okay|ok|okay cool|ok cool|right|that's right|that is right|yes|yeah|yep|no|nope|thank you|thanks)$/iu.test(normalized);
    };
    const neighborKey = (index) => String(rows[index]?.speaker_key || '').trim();
    for (let i = 1; i < rows.length - 1; i += 1) {
      if (!isShortAcknowledgement(rows[i]?.text)) continue;
      const prevKey = neighborKey(i - 1);
      const nextKey = neighborKey(i + 1);
      const cur = neighborKey(i);
      if (!keep.has(prevKey) || !keep.has(nextKey)) continue;
      const target = prevKey === nextKey ? prevKey : nextKey;
      if (!target || cur === target) continue;
      rows[i].speaker_key = target;
      changes.push({
        type: 'two_speaker_short_acknowledgement',
        index: i,
        from: cur,
        to: target,
        since: Number(rows[i]?.since || 0),
        until: Number(rows[i]?.until || 0),
        text: String(rows[i]?.text || ''),
        reason: prevKey === nextKey ? 'short_acknowledgement_between_same_speaker' : 'short_acknowledgement_turn_start',
        confidence: prevKey === nextKey ? 0.82 : 0.76,
        evidence: ['expected two speakers', 'short acknowledgement', 'adjacent kept-speaker context'],
      });
    }
  }

  // Pass E: an explicit host invitation followed by a substantive response is
  // a reliable handoff, even when the response's opening audio is ambiguous.
  if (expectedMax === 2 && hostSpeaker && guestSpeaker) {
    const invitationRe = /\b(go ahead|would you like to|please (?:go ahead|continue|explain|introduce)|the floor is yours)\b/iu;
    for (let invitationIndex = 0; invitationIndex < rows.length - 2; invitationIndex += 1) {
      if (String(rows[invitationIndex]?.speaker_key || '').trim() !== hostSpeaker) continue;
      if (!invitationRe.test(String(rows[invitationIndex]?.text || ''))) continue;
      let guestIndex = -1;
      for (let j = invitationIndex + 1; j <= Math.min(rows.length - 1, invitationIndex + 4); j += 1) {
        if (String(rows[j]?.speaker_key || '').trim() === guestSpeaker) {
          guestIndex = j;
          break;
        }
      }
      if (guestIndex < 0) continue;
      for (let i = invitationIndex + 1; i < guestIndex; i += 1) {
        const curKey = String(rows[i]?.speaker_key || '').trim();
        if (curKey !== hostSpeaker || countWords(rows[i]?.text) < 5 || isHostCue(rows[i]?.text)) continue;
        rows[i].speaker_key = guestSpeaker;
        changes.push({
          type: 'two_speaker_explicit_handoff',
          index: i,
          from: curKey,
          to: guestSpeaker,
          since: Number(rows[i]?.since || 0),
          until: Number(rows[i]?.until || 0),
          text: String(rows[i]?.text || ''),
          reason: 'explicit_host_invitation',
          confidence: 0.9,
          evidence: ['expected two speakers', 'explicit host invitation', 'following guest context'],
        });
      }
    }
  }

  const afterTotals = speakerTotals(rows);
  const beforeLabels = new Set(beforeRows.map((r) => String(r.speaker_key || '')));
  const afterLabels = new Set(rows.map((r) => String(r.speaker_key || '')));
  const collapsedLabels = [...beforeLabels].filter((k) => !afterLabels.has(k));

  const badSamples = Array.isArray(badSampleDetails) ? badSampleDetails : [];
  const badSampleReasons = {};
  const badSampleLabels = new Set();
  const lowConfidenceRowsFromBadSamples = [];
  for (const b of badSamples) {
    badSampleLabels.add(String(b?.speaker || '').trim());
    for (const reason of (b?.reasons || [])) {
      badSampleReasons[reason] = Number(badSampleReasons[reason] || 0) + 1;
    }
    lowConfidenceRowsFromBadSamples.push({
      since: Number(b?.since || 0),
      until: Number(b?.until || 0),
      speaker: String(b?.speaker || '').trim() || UNKNOWN_SPEAKER_KEY,
      duration: Number(b?.duration || 0),
      reason: 'bad_sample_quality',
      why_flagged: (b?.reasons || []).join(','),
      text_sample: String(b?.text_sample || ''),
      no_auto_reassign: true,
    });
  }

  return {
    keep: [...keep].sort(),
    hostSpeaker,
    expectedMax,
    beforeTotals: totals,
    afterTotals,
    linesRelabeled: changes.length,
    collapsedLabels,
    lowConfidenceSegments,
    badSampleCount: badSamples.length,
    badSampleReasons,
    badSampleLabels: [...badSampleLabels].filter(Boolean).sort(),
    badSamples: badSamples.slice(0, 400),
    lowConfidenceRowsFromBadSamples: lowConfidenceRowsFromBadSamples.slice(0, 400),
    changeExamples: changes.slice(0, 120),
  };
}

function isLikelyHandoff(prevText, curText) {
  const prev = String(prevText || '').toLowerCase();
  const cur = String(curText || '').toLowerCase();
  if (!prev || !cur) return false;

  // In interviews and small panels, a completed question is the strongest
  // deterministic signal that the following cue may come from another voice.
  // Splitting here is harmless when the same speaker answers rhetorically:
  // the voice classifier will simply assign both turns to the same cluster.
  if (/[?]\s*$/u.test(String(prevText || '').trim())) return true;

  // Chair/moderator invitation markers.
  const inviteRe = /\b(you(?:'| a)?re on|go ahead|the floor is yours|welcome[, ]|please proceed|can you start|can you begin|next speaker)\b/iu;
  // Typical opening by a newly handed-off speaker.
  const openRe = /\b(thank you|good (morning|afternoon|evening)|by way of introduction|my name is|through you|mr\.? chair|madam chair|your worship)\b/iu;
  if (inviteRe.test(prev) && openRe.test(cur)) return true;

  // Generic "thank you" transition from a tiny prior cue is often a handoff.
  const prevWords = countWords(prevText);
  const curWords = countWords(curText);
  if (/\bthank you\b/iu.test(cur) && prevWords <= 6 && curWords <= 8) return true;

  return false;
}

function buildTurnsFromCues(cues) {
  const items = Array.isArray(cues) ? cues : [];
  const turns = [];
  if (!items.length) return turns;

  let start = 0;
  let accWords = countWords(items[0].text);
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const cur = items[i];
    const turnSince = items[start].since;
    const nextUntil = cur.until;
    const gap = Math.max(0, cur.since - prev.until);
    const nextDuration = Math.max(0.01, nextUntil - turnSince);
    const nextWords = accWords + countWords(cur.text);
    const shouldSplit = (
      gap > TURN_MAX_GAP_SECONDS ||
      nextDuration > TURN_MAX_SECONDS ||
      nextWords > TURN_MAX_WORDS ||
      isLikelyHandoff(prev.text, cur.text)
    );
    if (shouldSplit) {
      turns.push({
        since: items[start].since,
        until: items[i - 1].until,
        cues: items.slice(start, i),
      });
      start = i;
      accWords = countWords(cur.text);
      continue;
    }
    accWords = nextWords;
  }

  turns.push({
    since: items[start].since,
    until: items[items.length - 1].until,
    cues: items.slice(start),
  });
  return turns;
}

function buildCueLevelTurns(cues) {
  return (Array.isArray(cues) ? cues : []).map((cue) => ({
    since: cue.since,
    until: cue.until,
    cues: [cue],
  }));
}

async function refineBoundaries({
  rows,
  audioPath,
  voicesDir,
  tmpDir,
  totalCues,
}) {
  if (!BOUNDARY_REFINE_ENABLED || !rows.length) {
    return { changed: 0, checked: 0 };
  }

  const indices = new Set();
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (String(rows[i].speaker_key) === String(rows[i + 1].speaker_key)) continue;
    for (let k = i - BOUNDARY_REFINE_WINDOW; k <= i + 1 + BOUNDARY_REFINE_WINDOW; k += 1) {
      if (k >= 0 && k < rows.length) indices.add(k);
    }
  }

  const targets = [...indices].sort((a, b) => a - b);
  let changed = 0;
  let checked = 0;

  for (const idx of targets) {
    const row = rows[idx];
    const dur = Math.max(0.01, Number(row.until) - Number(row.since));
    if (dur < BOUNDARY_REFINE_MIN_SECONDS) continue;
    checked += 1;

    const prevKey = idx > 0 ? String(rows[idx - 1]?.speaker_key || '') : '';
    const curKey = String(row.speaker_key || '');
    const nextKey = idx + 1 < rows.length ? String(rows[idx + 1]?.speaker_key || '') : '';

    // Programmatic snap: tiny bridge sentence between same-speaker neighbors.
    const words = countWords(row.text);
    if (words <= 3 && prevKey && prevKey === nextKey && curKey !== prevKey) {
      row.speaker_key = prevKey;
      changed += 1;
      process.stdout.write(
        `[speaker-sentence][refine] atindex num ${idx + 1} toindex num ${totalCues} speaker "${curKey}" -> "${prevKey}" reason "bridge-short"\n`
      );
      continue;
    }

    const clipPath = path.join(tmpDir, `boundary-refine-${String(idx + 1).padStart(5, '0')}.wav`);
    ensureWavClip({ audioPath, since: row.since, until: row.until, outPath: clipPath });
    const ident = await identifyWithRetry({
      audio: clipPath,
      voicesDir,
      prevSpeaker: prevKey || null,
      sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
      knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
      clipSeconds: Math.max(1.0, Math.min(6, dur)),
    }, `boundary=${idx + 1}`);
    const candKey = String(ident?.speaker || '').trim();
    const candMatch = String(ident?.matched || '').trim().toLowerCase();
    const candSimNum = Number(ident?.similarity);
    const candSim = fmtScore(candSimNum);
    const confident = isKnownLike(candMatch) && Number.isFinite(candSimNum) && candSimNum >= Math.max(KNOWN_SPEAKER_THRESHOLD, 0.58);
    if (!confident) continue;
    if (!candKey || candKey === curKey) continue;
    if (candKey !== prevKey && candKey !== nextKey) continue;

    // Do not introduce a fresh unknown label in boundary pass.
    if (/^speaker_\d+$/iu.test(candKey) && !prevKey && !nextKey) continue;

    row.speaker_key = candKey;
    changed += 1;
    process.stdout.write(
      `[speaker-sentence][refine] atindex num ${idx + 1} toindex num ${totalCues} speaker "${curKey}" -> "${candKey}" matched "${candMatch}" sim ${candSim} text "${previewText(row.text)}"\n`
    );
  }

  return { changed, checked };
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const prefixArg = process.argv[3] || 'auto';
  const voicesDirArg = process.argv[4] || '';
  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = path.resolve(process.cwd(), transcriptDirArg);
  ensureDir(transcriptDir);
  const { mergedSrt, resolvedPrefix } = pickMergedSrt(transcriptDir, prefixArg);
  const audioPath = pickAudioFile(transcriptDir);

  const baseVoicesDir = voicesDirArg
    ? path.resolve(process.cwd(), voicesDirArg)
    : path.join(ROOT, 'world', 'voices');
  const isolateEnv = String(process.env.PYA_SPEAKER_ISOLATE_VOICES || '').trim();
  const reseedEnv = String(process.env.PYA_SPEAKER_RESEED_VOICES || '').trim();
  const workingDirEnv = String(process.env.PYA_SPEAKER_WORKING_VOICES_DIR || '').trim();
  if (/^(1|true|yes)$/iu.test(reseedEnv)) {
    throw new Error('reseed voices mode is no longer supported');
  }

  const isolateVoices = /^(1|true|yes)$/iu.test(isolateEnv);
  const reseedVoices = false;
  const resolvedSpeakerHost = String(process.env.PYA_SPEAKER_HOST || process.env.SPEAKER_HOST || '').trim();
  if (!resolvedSpeakerHost) {
    throw new Error('spec violation: local speaker worker is forbidden; set PYA_SPEAKER_HOST to the remote speaker service (mriczo)');
  }
  if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/iu.test(resolvedSpeakerHost)) {
    throw new Error(`spec violation: local speaker host is forbidden (${resolvedSpeakerHost}); use remote speaker service (mriczo)`);
  }
  const voicesDir = isolateVoices
    ? path.resolve(workingDirEnv || path.join(transcriptDir, 'speaker-voices'))
    : baseVoicesDir;
  fs.mkdirSync(voicesDir, { recursive: true });
  const samplesDir = voicesDir;

  const outSrt = path.join(transcriptDir, `${resolvedPrefix}.speaker.sentence.srt`);
  const outJson = path.join(transcriptDir, `${resolvedPrefix}.speaker.sentences.json`);
  const outReassignReport = path.join(transcriptDir, `${resolvedPrefix}.speaker.reassign.report.json`);

  const cues = parseSrt(fs.readFileSync(mergedSrt, 'utf8'));
  if (!cues.length) throw new Error(`no cues parsed from ${mergedSrt}`);
  const workCues = MAX_CUES > 0 ? cues.slice(0, MAX_CUES) : cues;

  process.stdout.write(`[speaker-sentence] transcript dir: ${transcriptDir}\n`);
  process.stdout.write(`[speaker-sentence] merged srt: ${mergedSrt}\n`);
  process.stdout.write(`[speaker-sentence] audio: ${audioPath}\n`);
  process.stdout.write(`[speaker-sentence] base voices dir: ${baseVoicesDir}\n`);
  process.stdout.write(`[speaker-sentence] voices dir: ${voicesDir}\n`);
  process.stdout.write(`[speaker-sentence] speaker host: ${resolvedSpeakerHost || '(local worker)'}\n`);
  process.stdout.write(`[speaker-sentence] isolate voices: ${isolateVoices ? 'on' : 'off'}\n`);
  process.stdout.write(`[speaker-sentence] cues: ${cues.length}\n`);
  if (MAX_CUES > 0) process.stdout.write(`[speaker-sentence] cue limit: ${workCues.length}\n`);
  const turns = TWO_SPEAKER_CUE_TURNS ? buildCueLevelTurns(workCues) : buildTurnsFromCues(workCues);
  process.stdout.write(`[speaker-sentence] turns: ${turns.length}\n`);
  process.stdout.write(
    `[speaker-sentence] policy: min_identify_seconds=${MIN_IDENTIFY_SECONDS} min_identify_words=${MIN_IDENTIFY_WORDS} same_threshold=${SAME_SPEAKER_THRESHOLD} known_threshold=${KNOWN_SPEAKER_THRESHOLD} name_lock_threshold=${NAME_LOCK_THRESHOLD} name_lock_min_windows=${NAME_LOCK_MIN_WINDOWS} name_lock_window_seconds=${NAME_LOCK_WINDOW_SECONDS} turn_max_seconds=${TURN_MAX_SECONDS} turn_max_words=${TURN_MAX_WORDS} turn_max_gap=${TURN_MAX_GAP_SECONDS} cue_level_turns=${TWO_SPEAKER_CUE_TURNS ? 'on' : 'off'} boundary_refine=${BOUNDARY_REFINE_ENABLED ? 'on' : 'off'} boundary_window=${BOUNDARY_REFINE_WINDOW}\n`
  );
  process.stdout.write(
    `[speaker-sentence] reassign: enabled=${REASSIGN_PASS_ENABLED ? 'on' : 'off'} mode=${RELABEL_MODE || 'default'} expected_max=${EXPECTED_MAX_SPEAKERS || 0}\n`
  );
  process.stdout.write(
    `[speaker-sentence] bad-sample-guard: ${BAD_SAMPLE_GUARD_ENABLED ? 'on' : 'off'} min_seconds=${BAD_SAMPLE_MIN_SECONDS} min_words=${BAD_SAMPLE_MIN_WORDS} low_density=${BAD_SAMPLE_LOW_SPEECH_DENSITY}\n`
  );

  const tempRoot = path.join(ROOT, 'world', 'temporary');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(tempRoot, 'owen-speaker-sentence-'));
  const rows = [];
  const firstSampleBySpeaker = new Set();
  let prevSpeaker = '';
  const metadataMapForLog = loadSpeakerMetadataMap(voicesDir);
  const preexistingSpeakerKeys = loadSpeakerKeysFromVoicesDir(voicesDir);
  for (const key of metadataMapForLog.keys()) preexistingSpeakerKeys.add(String(key || '').toLowerCase());
  const knownSpeakerKeysForGuard = new Set(preexistingSpeakerKeys);
  const nameEvidenceBySpeaker = new Map();
  const sampleQualityBySpeaker = new Map();
  const badSampleDetails = [];
  let clipAudioPath = audioPath;

  if (PREDECODE_PCM_ENABLED) {
    process.stdout.write('[speaker-sentence] predecode: start (mono 16k PCM)\n');
    clipAudioPath = ensurePcmSource({ audioPath, tmpDir });
    process.stdout.write(`[speaker-sentence] predecode: ready ${clipAudioPath}\n`);
  }

  await ensureStarted();
  try {
    let processedSentenceIndex = 0;
    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex];
      const turnDuration = Math.max(0.01, turn.until - turn.since);
      const turnWords = turn.cues.reduce((sum, cue) => sum + countWords(cue.text), 0);
      const shortTurn = turnDuration < MIN_IDENTIFY_SECONDS || turnWords < MIN_IDENTIFY_WORDS;

      let speakerKey = prevSpeaker || 'speaker_unknown';
      let matched = 'carry_short';
      let similarity = 'na';
      let sampleCount = 'na';
      const clipPath = path.join(tmpDir, `turn-${String(turnIndex + 1).padStart(5, '0')}.wav`);

      if (!(shortTurn && prevSpeaker)) {
        ensureWavClip({ audioPath: clipAudioPath, since: turn.since, until: turn.until, outPath: clipPath });
        const ident = await identifyWithRetry({
          audio: clipPath,
          voicesDir,
          prevSpeaker: TWO_SPEAKER_CUE_TURNS ? null : (prevSpeaker || null),
          sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
          knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
          clipSeconds: Math.max(1.0, Math.min(8, turnDuration)),
        }, `turn=${turnIndex + 1}`);
        speakerKey = String(ident?.speaker || '').trim() || 'speaker_unknown';
        matched = String(ident?.matched || 'na');
        enforceNoPseudoKnownForFreshKey({
          speakerKey,
          matched,
          preexistingSpeakerKeys: knownSpeakerKeysForGuard,
          context: `turn=${turnIndex + 1}/${turns.length}`,
        });
        similarity = fmtScore(ident?.similarity);
        sampleCount = Number.isFinite(Number(ident?.sample_count))
          ? String(Number(ident.sample_count))
          : 'na';
        noteNameEvidence(
          nameEvidenceBySpeaker,
          speakerKey,
          matched,
          ident?.similarity,
          turn.since,
          metadataMapForLog,
        );
        const guarded = applyNewSpeakerGuard({
          speakerKey,
          matched,
          similarity: ident?.similarity,
          duration: turnDuration,
          words: turnWords,
          prevSpeaker,
          voicesDir,
        });
        if (guarded.demoted) {
          process.stdout.write(
            `[speaker-sentence] guard-new turn ${turnIndex + 1}/${turns.length}: key "${speakerKey}" -> "${guarded.speakerKey}" reason "${guarded.reason}"\n`
          );
        }
        speakerKey = guarded.speakerKey;
        matched = guarded.matched;
        if (BAD_SAMPLE_GUARD_ENABLED) {
          const turnSampleText = turn.cues.map((c) => String(c?.text || '')).join(' ').trim();
          const turnQuality = evaluateSampleQuality({
            text: turnSampleText,
            duration: turnDuration,
            words: turnWords,
          });
          noteSampleQuality(sampleQualityBySpeaker, speakerKey, turnQuality);
          if (turnQuality.bad) {
            badSampleDetails.push({
              stage: 'turn',
              turn_index: turnIndex + 1,
              since: Number(turn.since || 0),
              until: Number(turn.until || 0),
              speaker: String(speakerKey || '').trim() || UNKNOWN_SPEAKER_KEY,
              duration: turnQuality.duration,
              words: turnQuality.words,
              reasons: turnQuality.reasons,
              evidence: turnQuality.evidence,
              text_sample: previewText(turnQuality.text, 220),
            });
            if (matched === 'new') {
              const demoted = prevSpeaker || UNKNOWN_SPEAKER_KEY;
              process.stdout.write(
                `[speaker-sentence] bad-sample guard turn ${turnIndex + 1}/${turns.length}: new key "${speakerKey}" -> "${demoted}" reasons "${turnQuality.reasons.join(',')}"\n`
              );
              speakerKey = demoted;
              matched = 'bad_sample_new_demoted';
            }
          }
        }

        // Guard against mixed-speaker turns: if a fresh speaker was minted from a long
        // turn, probe beginning/end against a snapshot (excluding the new key) and
        // split per cue when edges look like different known speakers.
        if (matched === 'new' && turn.cues.length > 1) {
          const probeRoot = path.join(tmpDir, `probe-voices-turn-${String(turnIndex + 1).padStart(5, '0')}`);
          const edgeHeadPath = path.join(tmpDir, `turn-${String(turnIndex + 1).padStart(5, '0')}-edge-head.wav`);
          const edgeTailPath = path.join(tmpDir, `turn-${String(turnIndex + 1).padStart(5, '0')}-edge-tail.wav`);
          let mixedDetected = false;
          let edgeStart = null;
          let edgeEnd = null;
          try {
            copyVoicesSnapshot({ sourceDir: voicesDir, outDir: probeRoot, excludeSpeakerKey: speakerKey });
            const edgeHeadUntil = Math.min(turn.until, turn.since + EDGE_PROBE_SECONDS);
            const edgeTailSince = Math.max(turn.since, turn.until - EDGE_PROBE_SECONDS);
            ensureWavClip({ audioPath: clipAudioPath, since: turn.since, until: edgeHeadUntil, outPath: edgeHeadPath });
            ensureWavClip({ audioPath: clipAudioPath, since: edgeTailSince, until: turn.until, outPath: edgeTailPath });
            edgeStart = await identifyWithRetry({
              audio: edgeHeadPath,
              voicesDir: probeRoot,
              prevSpeaker: prevSpeaker || null,
              sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
              knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
              clipSeconds: Math.max(1.0, Math.min(6, edgeHeadUntil - turn.since)),
            }, `turn=${turnIndex + 1} edge=head`);
            edgeEnd = await identifyWithRetry({
              audio: edgeTailPath,
              voicesDir: probeRoot,
              prevSpeaker: String(edgeStart?.speaker || prevSpeaker || ''),
              sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
              knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
              clipSeconds: Math.max(1.0, Math.min(6, turn.until - edgeTailSince)),
            }, `turn=${turnIndex + 1} edge=tail`);
            const startKey = String(edgeStart?.speaker || '').trim();
            const endKey = String(edgeEnd?.speaker || '').trim();
            const startMatch = String(edgeStart?.matched || '').trim();
            const endMatch = String(edgeEnd?.matched || '').trim();
            mixedDetected = Boolean(
              startKey &&
              endKey &&
              startKey !== endKey &&
              isKnownLike(startMatch) &&
              isKnownLike(endMatch)
            );
          } catch {
            mixedDetected = false;
          } finally {
            try { fs.rmSync(probeRoot, { recursive: true, force: true }); } catch {}
            try { if (fs.existsSync(edgeHeadPath)) fs.unlinkSync(edgeHeadPath); } catch {}
            try { if (fs.existsSync(edgeTailPath)) fs.unlinkSync(edgeTailPath); } catch {}
          }

          if (mixedDetected) {
            process.stdout.write(
              `[speaker-sentence] mixed-turn guard turn ${turnIndex + 1}/${turns.length}: start="${String(edgeStart?.speaker || 'na')}"(${String(edgeStart?.matched || 'na')}) end="${String(edgeEnd?.speaker || 'na')}"(${String(edgeEnd?.matched || 'na')}) -> split per cue\n`
            );

            removeSpeakerArtifacts({ voicesDir, speakerKey });
            let localPrev = prevSpeaker || '';
            let localLast = localPrev;
            const cueAssignments = [];

            for (let cueIdx = 0; cueIdx < turn.cues.length; cueIdx += 1) {
              const cue = turn.cues[cueIdx];
              const cueDur = Math.max(0.01, cue.until - cue.since);
              const cueWords = countWords(cue.text);
              const cueClip = path.join(tmpDir, `turn-${String(turnIndex + 1).padStart(5, '0')}-cue-${String(cueIdx + 1).padStart(3, '0')}.wav`);
              let cueSpeaker = localPrev || 'speaker_unknown';
              let cueMatched = 'carry_short';
              let cueSim = 'na';
              let cueSamples = 'na';

              const cueShort = cueDur < MIN_IDENTIFY_SECONDS || cueWords < MIN_IDENTIFY_WORDS;
              if (!(cueShort && localPrev)) {
                ensureWavClip({ audioPath: clipAudioPath, since: cue.since, until: cue.until, outPath: cueClip });
                const cueIdent = await identifyWithRetry({
                  audio: cueClip,
                  voicesDir,
                  prevSpeaker: localPrev || null,
                  sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
                  knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
                  clipSeconds: Math.max(1.0, Math.min(6, cueDur)),
                }, `turn=${turnIndex + 1} cue=${cueIdx + 1}`);
                cueSpeaker = String(cueIdent?.speaker || '').trim() || cueSpeaker;
                cueMatched = String(cueIdent?.matched || 'na');
                enforceNoPseudoKnownForFreshKey({
                  speakerKey: cueSpeaker,
                  matched: cueMatched,
                  preexistingSpeakerKeys: knownSpeakerKeysForGuard,
                  context: `turn=${turnIndex + 1}/${turns.length} cue=${cueIdx + 1}/${turn.cues.length}`,
                });
                cueSim = fmtScore(cueIdent?.similarity);
                cueSamples = Number.isFinite(Number(cueIdent?.sample_count))
                  ? String(Number(cueIdent.sample_count))
                  : 'na';
                noteNameEvidence(
                  nameEvidenceBySpeaker,
                  cueSpeaker,
                  cueMatched,
                  cueIdent?.similarity,
                  cue.since,
                  metadataMapForLog,
                );
                const guardedCue = applyNewSpeakerGuard({
                  speakerKey: cueSpeaker,
                  matched: cueMatched,
                  similarity: cueIdent?.similarity,
                  duration: cueDur,
                  words: cueWords,
                  prevSpeaker: localPrev,
                  voicesDir,
                });
                if (guardedCue.demoted) {
                  process.stdout.write(
                    `[speaker-sentence] guard-new turn ${turnIndex + 1}/${turns.length} cue ${cueIdx + 1}/${turn.cues.length}: key "${cueSpeaker}" -> "${guardedCue.speakerKey}" reason "${guardedCue.reason}"\n`
                  );
                }
                cueSpeaker = guardedCue.speakerKey;
                cueMatched = guardedCue.matched;
                if (BAD_SAMPLE_GUARD_ENABLED) {
                  const cueQuality = evaluateSampleQuality({
                    text: cue.text,
                    duration: cueDur,
                    words: cueWords,
                  });
                  noteSampleQuality(sampleQualityBySpeaker, cueSpeaker, cueQuality);
                  if (cueQuality.bad) {
                    badSampleDetails.push({
                      stage: 'cue',
                      turn_index: turnIndex + 1,
                      cue_index: cueIdx + 1,
                      since: Number(cue.since || 0),
                      until: Number(cue.until || 0),
                      speaker: String(cueSpeaker || '').trim() || UNKNOWN_SPEAKER_KEY,
                      duration: cueQuality.duration,
                      words: cueQuality.words,
                      reasons: cueQuality.reasons,
                      evidence: cueQuality.evidence,
                      text_sample: previewText(cueQuality.text, 220),
                    });
                    if (cueMatched === 'new') {
                      const cueDemoted = localPrev || prevSpeaker || UNKNOWN_SPEAKER_KEY;
                      process.stdout.write(
                        `[speaker-sentence] bad-sample guard turn ${turnIndex + 1}/${turns.length} cue ${cueIdx + 1}/${turn.cues.length}: new key "${cueSpeaker}" -> "${cueDemoted}" reasons "${cueQuality.reasons.join(',')}"\n`
                      );
                      cueSpeaker = cueDemoted;
                      cueMatched = 'bad_sample_new_demoted';
                    }
                  }
                }
              }
              if (/^speaker_\d+$/iu.test(String(cueSpeaker || '').trim())) {
                knownSpeakerKeysForGuard.add(String(cueSpeaker || '').trim());
              }
              localPrev = cueSpeaker;
              localLast = cueSpeaker;
              cueAssignments.push({ cue, cueSpeaker, cueMatched, cueSim, cueSamples, cueClip });
            }

            prevSpeaker = localLast || prevSpeaker;

            for (const item of cueAssignments) {
              const cueLabel = toDisplayLabel(item.cueSpeaker, metadataMapForLog);
              if (!firstSampleBySpeaker.has(item.cueSpeaker) && fs.existsSync(item.cueClip)) {
                const cueQualityForSample = BAD_SAMPLE_GUARD_ENABLED
                  ? evaluateSampleQuality({
                    text: item.cue.text,
                    duration: Math.max(0.01, Number(item.cue.until || 0) - Number(item.cue.since || 0)),
                    words: countWords(item.cue.text),
                  })
                  : { bad: false };
                if (!cueQualityForSample.bad) {
                  const samplePath = path.join(samplesDir, `${item.cueSpeaker}.wav`);
                  if (!fs.existsSync(samplePath)) fs.copyFileSync(item.cueClip, samplePath);
                  firstSampleBySpeaker.add(item.cueSpeaker);
                }
              }
              processedSentenceIndex += 1;
              const cueDuration = Math.max(0.01, item.cue.until - item.cue.since);
              const cueWords = countWords(item.cue.text);
              process.stdout.write(
                `[speaker-sentence] atindex num ${processedSentenceIndex} toindex num ${workCues.length} speaker "${cueLabel}" key "${item.cueSpeaker}" matched "${item.cueMatched}" sim ${item.cueSim} samples ${item.cueSamples} dur ${cueDuration.toFixed(2)}s words ${cueWords} text "${previewText(item.cue.text)}"\n`
              );
              rows.push({
                index: item.cue.index,
                since: item.cue.since,
                until: item.cue.until,
                text: item.cue.text,
                speaker_key: item.cueSpeaker,
              });
            }
            continue;
          }
        }
      }
      if (/^speaker_\d+$/iu.test(String(speakerKey || '').trim())) {
        knownSpeakerKeysForGuard.add(String(speakerKey || '').trim());
      }

      prevSpeaker = speakerKey;
      const label = toDisplayLabel(speakerKey, metadataMapForLog);
      process.stdout.write(
        `[speaker-sentence] turn ${turnIndex + 1}/${turns.length} cues ${turn.cues.length} speaker "${label}" key "${speakerKey}" matched "${matched}" sim ${similarity} samples ${sampleCount} dur ${turnDuration.toFixed(2)}s words ${turnWords} text "${previewText(turn.cues[0]?.text || '')}"\n`
      );

      if (!firstSampleBySpeaker.has(speakerKey) && fs.existsSync(clipPath)) {
        if (speakerKey === UNKNOWN_SPEAKER_KEY) {
          // Do not persist unknown clips as canonical speaker samples.
        } else {
        const turnQualityForSample = BAD_SAMPLE_GUARD_ENABLED
          ? evaluateSampleQuality({
            text: turn.cues.map((c) => String(c?.text || '')).join(' ').trim(),
            duration: turnDuration,
            words: turnWords,
          })
          : { bad: false };
        if (!turnQualityForSample.bad) {
          const samplePath = path.join(samplesDir, `${speakerKey}.wav`);
          if (!fs.existsSync(samplePath)) fs.copyFileSync(clipPath, samplePath);
          firstSampleBySpeaker.add(speakerKey);
        }
        }
      }

      for (const cue of turn.cues) {
        processedSentenceIndex += 1;
        const cueDuration = Math.max(0.01, cue.until - cue.since);
        const cueWords = countWords(cue.text);
        process.stdout.write(
          `[speaker-sentence] atindex num ${processedSentenceIndex} toindex num ${workCues.length} speaker "${label}" key "${speakerKey}" matched "turn_assign" sim ${similarity} samples ${sampleCount} dur ${cueDuration.toFixed(2)}s words ${cueWords} text "${previewText(cue.text)}"\n`
        );
        rows.push({
          index: cue.index,
          since: cue.since,
          until: cue.until,
          text: cue.text,
          speaker_key: speakerKey,
        });
      }
    }
    const refine = await refineBoundaries({
      rows,
      audioPath: clipAudioPath,
      voicesDir,
      tmpDir,
      totalCues: workCues.length,
    });
    process.stdout.write(`[speaker-sentence][refine] checked: ${refine.checked}\n`);
    process.stdout.write(`[speaker-sentence][refine] changed: ${refine.changed}\n`);
  } finally {
    try { await discharge(); } catch {}
    try { await stop(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  const metadataMap = loadSpeakerMetadataMap(voicesDir);
  let reassignReport = null;
  if (REASSIGN_PASS_ENABLED && RELABEL_MODE === 'small_panel' && EXPECTED_MAX_SPEAKERS > 0) {
    reassignReport = applySmallPanelReassign(rows, {
      expectedMax: EXPECTED_MAX_SPEAKERS,
      windowRows: REASSIGN_WINDOW_ROWS,
      sampleQualityBySpeaker: BAD_SAMPLE_GUARD_ENABLED ? sampleQualityBySpeaker : new Map(),
      badSampleDetails: BAD_SAMPLE_GUARD_ENABLED ? badSampleDetails : [],
    });
    process.stdout.write(
      `[speaker-sentence][reassign] keep=${reassignReport.keep.join(',')} lines_relabeled=${reassignReport.linesRelabeled} collapsed=${reassignReport.collapsedLabels.length}\n`
    );
    process.stdout.write(
      `[speaker-sentence][reassign] low_conf_segments=${reassignReport.lowConfidenceSegments.length}\n`
    );
    fs.writeFileSync(outReassignReport, `${JSON.stringify({
      generated_at: new Date().toISOString(),
      mode: RELABEL_MODE,
      enabled: true,
      expected_max: EXPECTED_MAX_SPEAKERS,
      window_rows: REASSIGN_WINDOW_ROWS,
      ...reassignReport,
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`[speaker-sentence][reassign] wrote: ${outReassignReport}\n`);
  }
  const lockedSpeakerKeys = buildLockedSpeakerKeys(nameEvidenceBySpeaker);
  process.stdout.write(`[speaker-sentence] name-lock speakers: ${lockedSpeakerKeys.size}\n`);
  if (rows.length >= 2) {
    const first = rows[0];
    const second = rows[1];
    const firstWords = countWords(first?.text || "");
    const firstDur = Math.max(0, Number(first?.until || 0) - Number(first?.since || 0));
    const firstText = String(first?.text || "");
    const secondKey = String(second?.speaker_key || "");
    const secondKnown = secondKey && !/^speaker_\d+$/iu.test(secondKey);
    const looksHandoffOpen = /\bthank you\b|\bgood (?:morning|afternoon|evening)\b|\bwelcome\b/iu.test(firstText);
    if (
      secondKnown &&
      String(first?.speaker_key || "") !== secondKey &&
      firstWords > 0 &&
      firstWords <= 6 &&
      firstDur <= 4.5 &&
      looksHandoffOpen
    ) {
      const beforeKey = String(first?.speaker_key || "");
      first.speaker_key = secondKey;
      process.stdout.write(
        `[speaker-sentence][refine] opening-bridge: speaker "${beforeKey}" -> "${secondKey}" text "${previewText(firstText)}"\n`
      );
    }
  }
  for (const row of rows) {
    row.display = toDisplayLabel(row.speaker_key, metadataMap, lockedSpeakerKeys);
  }

  fs.writeFileSync(outSrt, renderSrt(rows), 'utf8');
  fs.writeFileSync(outJson, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    transcript_dir: transcriptDir,
    merged_srt: mergedSrt,
    audio: audioPath,
    voices_dir: voicesDir,
    samples_dir: samplesDir,
    name_lock: {
      threshold: NAME_LOCK_THRESHOLD,
      min_windows: NAME_LOCK_MIN_WINDOWS,
      window_seconds: NAME_LOCK_WINDOW_SECONDS,
      speakers: [...lockedSpeakerKeys].sort(),
    },
    reassign: reassignReport ? {
      mode: RELABEL_MODE,
      expected_max: EXPECTED_MAX_SPEAKERS,
      lines_relabeled: reassignReport.linesRelabeled,
      collapsed_labels: reassignReport.collapsedLabels,
      low_conf_segments: reassignReport.lowConfidenceSegments.length,
      report_path: outReassignReport,
    } : null,
    rows,
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(`[speaker-sentence] wrote: ${outSrt}\n`);
  process.stdout.write(`[speaker-sentence] wrote: ${outJson}\n`);
  process.stdout.write(`[speaker-sentence] samples dir: ${samplesDir}\n`);
}

(async () => {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
    process.exitCode = 1;
  } finally {
    await cleanupSpeakerRunner('finally');
  }
})();
