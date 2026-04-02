#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureStarted, identify, discharge, stop } from './speaker_runner.mjs';

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
  const raw = Number(process.env.PYA_SPEAKER_KNOWN_THRESHOLD || 0.50);
  return Number.isFinite(raw) ? raw : 0.50;
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

function usage() {
  return [
    'Usage: node command/diarize_sentence_srt_from_transcript_folder.mjs <transcript_dir> [prefix] [voices_dir]',
    'Example: node command/diarize_sentence_srt_from_transcript_folder.mjs artifacts/.../transcript meeting-qwen-auto world/voices'
  ].join('\n');
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

function toDisplayLabel(speakerKey, metadataMap) {
  const key = String(speakerKey || '').trim();
  const meta = metadataMap.get(key) || {};
  const rawName = String(meta.name || '').trim();
  if (rawName && !/^speaker_\d+$/iu.test(rawName)) {
    return rawName.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }
  const m = key.match(/^speaker_(\d+)$/iu);
  if (m) return `SPEAKER_${String(Number(m[1])).padStart(3, '0')}`;
  if (rawName) return rawName.replace(/_/g, ' ');
  return key || 'SPEAKER_UNKNOWN';
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
  return m === 'known' || m === 'prev';
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

function isLikelyHandoff(prevText, curText) {
  const prev = String(prevText || '').toLowerCase();
  const cur = String(curText || '').toLowerCase();
  if (!prev || !cur) return false;

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
    const ident = await identify({
      audio: clipPath,
      voicesDir,
      prevSpeaker: prevKey || null,
      sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
      knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
      clipSeconds: Math.max(1.0, Math.min(6, dur)),
    });
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
  const isolateVoices = !/^(0|false|no)$/iu.test(String(process.env.PYA_SPEAKER_ISOLATE_VOICES || '0'));
  const reseedVoices = /^(1|true|yes)$/iu.test(String(process.env.PYA_SPEAKER_RESEED_VOICES || ''));
  const voicesDir = isolateVoices
    ? path.resolve(process.cwd(), process.env.PYA_SPEAKER_WORKING_VOICES_DIR || path.join(transcriptDir, 'voices-working'))
    : baseVoicesDir;
  if (isolateVoices) {
    seedWorkingVoicesDir({ baseDir: baseVoicesDir, workingDir: voicesDir, reseed: reseedVoices });
  } else {
    fs.mkdirSync(voicesDir, { recursive: true });
  }
  const samplesDir = voicesDir;

  const outSrt = path.join(transcriptDir, `${resolvedPrefix}.speaker.sentence.srt`);
  const outJson = path.join(transcriptDir, `${resolvedPrefix}.speaker.sentences.json`);

  const cues = parseSrt(fs.readFileSync(mergedSrt, 'utf8'));
  if (!cues.length) throw new Error(`no cues parsed from ${mergedSrt}`);
  const workCues = MAX_CUES > 0 ? cues.slice(0, MAX_CUES) : cues;

  process.stdout.write(`[speaker-sentence] transcript dir: ${transcriptDir}\n`);
  process.stdout.write(`[speaker-sentence] merged srt: ${mergedSrt}\n`);
  process.stdout.write(`[speaker-sentence] audio: ${audioPath}\n`);
  process.stdout.write(`[speaker-sentence] base voices dir: ${baseVoicesDir}\n`);
  process.stdout.write(`[speaker-sentence] voices dir: ${voicesDir}\n`);
  process.stdout.write(`[speaker-sentence] isolate voices: ${isolateVoices ? 'on' : 'off'}\n`);
  process.stdout.write(`[speaker-sentence] cues: ${cues.length}\n`);
  if (MAX_CUES > 0) process.stdout.write(`[speaker-sentence] cue limit: ${workCues.length}\n`);
  const turns = buildTurnsFromCues(workCues);
  process.stdout.write(`[speaker-sentence] turns: ${turns.length}\n`);
  process.stdout.write(
    `[speaker-sentence] policy: min_identify_seconds=${MIN_IDENTIFY_SECONDS} min_identify_words=${MIN_IDENTIFY_WORDS} same_threshold=${SAME_SPEAKER_THRESHOLD} known_threshold=${KNOWN_SPEAKER_THRESHOLD} turn_max_seconds=${TURN_MAX_SECONDS} turn_max_words=${TURN_MAX_WORDS} turn_max_gap=${TURN_MAX_GAP_SECONDS} boundary_refine=${BOUNDARY_REFINE_ENABLED ? 'on' : 'off'} boundary_window=${BOUNDARY_REFINE_WINDOW}\n`
  );

  const tempRoot = path.join(ROOT, 'world', 'temporary');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(tempRoot, 'owen-speaker-sentence-'));
  const rows = [];
  const firstSampleBySpeaker = new Set();
  let prevSpeaker = '';
  const metadataMapForLog = loadSpeakerMetadataMap(voicesDir);
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
        const ident = await identify({
          audio: clipPath,
          voicesDir,
          prevSpeaker: prevSpeaker || null,
          sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
          knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
          clipSeconds: Math.max(1.0, Math.min(8, turnDuration)),
        });
        speakerKey = String(ident?.speaker || '').trim() || 'speaker_unknown';
        matched = String(ident?.matched || 'na');
        similarity = fmtScore(ident?.similarity);
        sampleCount = Number.isFinite(Number(ident?.sample_count))
          ? String(Number(ident.sample_count))
          : 'na';

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
            edgeStart = await identify({
              audio: edgeHeadPath,
              voicesDir: probeRoot,
              prevSpeaker: prevSpeaker || null,
              sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
              knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
              clipSeconds: Math.max(1.0, Math.min(6, edgeHeadUntil - turn.since)),
            });
            edgeEnd = await identify({
              audio: edgeTailPath,
              voicesDir: probeRoot,
              prevSpeaker: String(edgeStart?.speaker || prevSpeaker || ''),
              sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
              knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
              clipSeconds: Math.max(1.0, Math.min(6, turn.until - edgeTailSince)),
            });
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
                const cueIdent = await identify({
                  audio: cueClip,
                  voicesDir,
                  prevSpeaker: localPrev || null,
                  sameSpeakerThreshold: SAME_SPEAKER_THRESHOLD,
                  knownSpeakerThreshold: KNOWN_SPEAKER_THRESHOLD,
                  clipSeconds: Math.max(1.0, Math.min(6, cueDur)),
                });
                cueSpeaker = String(cueIdent?.speaker || '').trim() || cueSpeaker;
                cueMatched = String(cueIdent?.matched || 'na');
                cueSim = fmtScore(cueIdent?.similarity);
                cueSamples = Number.isFinite(Number(cueIdent?.sample_count))
                  ? String(Number(cueIdent.sample_count))
                  : 'na';
              }
              localPrev = cueSpeaker;
              localLast = cueSpeaker;
              cueAssignments.push({ cue, cueSpeaker, cueMatched, cueSim, cueSamples, cueClip });
            }

            prevSpeaker = localLast || prevSpeaker;

            for (const item of cueAssignments) {
              const cueLabel = toDisplayLabel(item.cueSpeaker, metadataMapForLog);
              if (!firstSampleBySpeaker.has(item.cueSpeaker) && fs.existsSync(item.cueClip)) {
                const samplePath = path.join(samplesDir, `${item.cueSpeaker}.wav`);
                if (!fs.existsSync(samplePath)) fs.copyFileSync(item.cueClip, samplePath);
                firstSampleBySpeaker.add(item.cueSpeaker);
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

      prevSpeaker = speakerKey;
      const label = toDisplayLabel(speakerKey, metadataMapForLog);
      process.stdout.write(
        `[speaker-sentence] turn ${turnIndex + 1}/${turns.length} cues ${turn.cues.length} speaker "${label}" key "${speakerKey}" matched "${matched}" sim ${similarity} samples ${sampleCount} dur ${turnDuration.toFixed(2)}s words ${turnWords} text "${previewText(turn.cues[0]?.text || '')}"\n`
      );

      if (!firstSampleBySpeaker.has(speakerKey) && fs.existsSync(clipPath)) {
        const samplePath = path.join(samplesDir, `${speakerKey}.wav`);
        if (!fs.existsSync(samplePath)) fs.copyFileSync(clipPath, samplePath);
        firstSampleBySpeaker.add(speakerKey);
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
    row.display = toDisplayLabel(row.speaker_key, metadataMap);
  }

  fs.writeFileSync(outSrt, renderSrt(rows), 'utf8');
  fs.writeFileSync(outJson, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    transcript_dir: transcriptDir,
    merged_srt: mergedSrt,
    audio: audioPath,
    voices_dir: voicesDir,
    samples_dir: samplesDir,
    rows,
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(`[speaker-sentence] wrote: ${outSrt}\n`);
  process.stdout.write(`[speaker-sentence] wrote: ${outJson}\n`);
  process.stdout.write(`[speaker-sentence] samples dir: ${samplesDir}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
