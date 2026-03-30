#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from "node:url";
import { DEFAULT_SUMMARY_FOCUS } from "./defaults.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE = path.resolve(PROGRAM_DIR, "..");
const ROOT = path.resolve(PROGRAM_DIR, "../../../..");
const SECRET_PATH = path.join(ROOT, "configure/secret.pya");

function usage() {
  return [
    'Usage: node program/run-shared-transcript-pipeline-from-folder.mjs <transcript_dir> [base_prefix] [focus] [jurisdiction] [body] [site_url] [discussion_url] [source_url] [video_url]',
    'Example: node ... artifacts/grey-county/meetings/2026-03-12_council/transcript meeting-qwen-auto "newsworthy civic impacts" "Grey County" "Council" "https://helpos.ca"',
  ].join('\n');
}

function resolveHousePath(inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(HOUSE, inputPath);
}

function ensureDir(p) {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`directory not found: ${p}`);
}

function existsFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function hasMinSize(p, minBytes = 1) {
  try { return fs.statSync(p).isFile() && Number(fs.statSync(p).size || 0) >= minBytes; } catch { return false; }
}

function isValidAgendaSummaryJson(p) {
  if (!hasMinSize(p, 200)) return false;
  try {
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(obj?.sections) && obj.sections.length > 0;
  } catch {
    return false;
  }
}

function isValidMeetingSummaryMd(p) {
  if (!hasMinSize(p, 400)) return false;
  const text = String(fs.readFileSync(p, "utf8") || "");
  return (
    /^#\s+Whole Meeting Summary\b/mu.test(text) &&
    /^##\s+Top Newsworthy Developments\b/mu.test(text) &&
    /^##\s+Why It Matters\b/mu.test(text) &&
    /^##\s+Watch Next\b/mu.test(text)
  );
}

function isValidHookTxt(p) {
  if (!hasMinSize(p, 4)) return false;
  const line = String(fs.readFileSync(p, "utf8") || "").trim();
  const words = line.split(/\s+/u).filter(Boolean);
  return words.length >= 3;
}

function isValidWiseSeries(p) {
  if (!hasMinSize(p, 150)) return false;
  const text = String(fs.readFileSync(p, "utf8") || "");
  return /su name wise chips be series def/iu.test(text) && /since num /iu.test(text);
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

function readSecretText() {
  try {
    if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, "utf8");
  } catch {
    // best effort
  }
  return "";
}

function pickSecretValue(secretText, patterns) {
  const src = String(secretText || "");
  for (const re of patterns) {
    const m = src.match(re);
    if (m && m[1]) return String(m[1]).trim();
  }
  return "";
}

const SECRET_TEXT = readSecretText();

function resolveSpeakerHost() {
  const fromEnv = String(process.env.PYA_SPEAKER_HOST || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/u, "");
  return pickSecretValue(SECRET_TEXT, [
    /exists\s+su\s+name\s+speaker\s+host\s+ob\s+text\s+"([^"]+)"/iu,
  ]).replace(/\/$/u, "");
}

function resolveSpeakerHostRoot() {
  const fromEnv = String(process.env.PYA_SPEAKER_HOST_ROOT || "").trim();
  if (fromEnv) return fromEnv;
  return pickSecretValue(SECRET_TEXT, [
    /exists\s+su\s+name\s+speaker\s+host\s+root\s+ob\s+text\s+"([^"]+)"/iu,
  ]);
}

function resolveOllamaHost() {
  const fromEnv = String(process.env.OLLAMA_HOST || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/u, "");
  return pickSecretValue(SECRET_TEXT, [
    /exists\s+su\s+name\s+ollama\s+host\s+ob\s+text\s+"([^"]+)"/iu,
    /exists\s+su\s+name\s+ai\s+host\s+ob\s+text\s+"([^"]+)"/iu,
    /su\s+name\s+relay\s+local\s+host\s+ob\s+text\s+"([^"]+)"/iu,
  ]).replace(/\/$/u, "");
}

function runNode(scriptPath, args, { env = {}, cwd = ROOT, timeoutMs = 28800000, label = 'stage' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      const t = String(c || '');
      stdout += t;
      process.stdout.write(t);
    });
    child.stderr.on('data', (c) => {
      const t = String(c || '');
      stderr += t;
      process.stderr.write(t);
    });

    const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(10000, Number(timeoutMs) || 10000));
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

async function stage(name, fn, skip = false) {
  if (skip) {
    log(`[grey-pipeline] skip ${name} (checkpoint)`);
    return;
  }
  log(`[grey-pipeline] start ${name}`);
  const t0 = Date.now();
  await fn();
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[grey-pipeline] done ${name} in ${sec}s`);
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const basePrefix = process.argv[3] || 'meeting-qwen-auto';
  const focus = process.argv[4] || DEFAULT_SUMMARY_FOCUS;
  const jurisdiction = process.argv[5] || 'Grey County';
  const body = process.argv[6] || 'Council';
  const siteUrl = process.argv[7] || 'https://helpos.ca';
  const discussionUrl = process.argv[8] || '';
  const sourceUrl = process.argv[9] || '';
  const videoUrl = process.argv[10] || '';

  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolveHousePath(transcriptDirArg);
  ensureDir(transcriptDir);

  const normPrefix = `${basePrefix}-normalized`;
  const rosterPath = process.env.GREY_ROSTER_FILE || path.join(HOUSE, 'artifacts/grey-county/roster.txt');
  const voicesBase = process.env.GREY_VOICES_DIR || path.join(ROOT, 'world/voices');
  const voicesWork = process.env.GREY_VOICES_WORK_DIR || path.join(transcriptDir, 'voices-working');

  const sentenceMerged = path.join(transcriptDir, `${normPrefix}.sentences.merged.srt`);
  const speakerJson = path.join(transcriptDir, `${normPrefix}.sentences.speaker.sentences.json`);
  const speakerSrt = path.join(transcriptDir, `${normPrefix}.sentences.speaker.sentence.srt`);
  const agendaWise = path.join(transcriptDir, `${normPrefix}.agenda-wise.series.pya`);
  const agendaSummary = path.join(transcriptDir, `${normPrefix}.agenda-summary.json`);
  const meetingSummary = path.join(transcriptDir, `${normPrefix}.meeting-summary.md`);
  const meetingHook = path.join(transcriptDir, `${normPrefix}.meeting-hook.txt`);
  const htmlPath = path.join(transcriptDir, 'transcript-page.html');
  const speakerHost = resolveSpeakerHost();
  const speakerHostRoot = resolveSpeakerHostRoot();
  const ollamaHost = resolveOllamaHost();

  if (!existsFile(sentenceMerged)) {
    throw new Error(`missing sentence merged srt: ${sentenceMerged}`);
  }

  await stage('diarize-speakers', async () => {
    const sharedEnv = {
      PYA_SPEAKER_ISOLATE_VOICES: process.env.PYA_SPEAKER_ISOLATE_VOICES || '1',
      PYA_SPEAKER_WORKING_VOICES_DIR: voicesWork,
      PYA_SPEAKER_RESEED_VOICES: process.env.PYA_SPEAKER_RESEED_VOICES || '1',
    };
    const runDiarize = (extraEnv = {}, label = 'diarize-speakers') => runNode(
      path.join(ROOT, 'command/diarize_sentence_srt_from_transcript_folder.mjs'),
      [transcriptDir, `${normPrefix}.sentences`, voicesBase],
      { env: { ...sharedEnv, ...extraEnv }, label },
    );

    try {
      await runDiarize({
        ...(speakerHost ? { PYA_SPEAKER_HOST: speakerHost } : {}),
        ...(speakerHostRoot ? { PYA_SPEAKER_HOST_ROOT: speakerHostRoot } : {}),
      }, 'diarize-speakers');
    } catch (err) {
      const msg = String(err?.message || err || '');
      const remoteMissingAudio = /speaker service defective:\s*audio missing:/iu.test(msg);
      if (!speakerHost || !remoteMissingAudio) throw err;
      log('[grey-pipeline] diarize remote path unavailable; retry local worker');
      await runDiarize({}, 'diarize-speakers-local-retry');
    }
  }, hasMinSize(speakerJson, 200));

  await stage('auto-assign-speakers', async () => {
    await runNode(path.join(ROOT, 'command/auto_assign_speakers_from_callouts.mjs'), [transcriptDir, `${normPrefix}.sentences`, rosterPath, voicesWork], {
      label: 'auto-assign-speakers',
    });
  });

  await stage('relabel-speakers', async () => {
    await runNode(path.join(ROOT, 'command/relabel_speaker_sentence_srt_from_transcript_folder.mjs'), [transcriptDir, `${normPrefix}.sentences`, voicesWork], {
      label: 'relabel-speakers',
    });
  }, hasMinSize(speakerSrt, 200));

  await stage('build-agenda-wise-series', async () => {
    const sourceSrt = existsFile(speakerSrt) ? speakerSrt : sentenceMerged;
    await runNode(path.join(ROOT, 'command/srt_to_wise_chip_series.mjs'), [
      sourceSrt,
      agendaWise,
      '--min-words',
      String(process.env.GREY_WISE_MIN_WORDS || 120),
      '--max-words',
      String(process.env.GREY_WISE_MAX_WORDS || 320),
      '--pause-seconds',
      String(process.env.GREY_WISE_PAUSE_SECONDS || 6),
    ], {
      label: 'build-agenda-wise-series',
      timeoutMs: 20 * 60 * 1000,
    });
  }, isValidWiseSeries(agendaWise));

  await stage('agenda-section-summaries', async () => {
    await runNode(path.join(ROOT, 'command/summarize_agenda_wise_sections_from_transcript_folder.mjs'), [transcriptDir, normPrefix, focus], {
      label: 'agenda-section-summaries',
      timeoutMs: 7200000,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
      },
    });
  }, isValidAgendaSummaryJson(agendaSummary));

  await stage('whole-meeting-summary', async () => {
    await runNode(path.join(ROOT, 'command/summarize_whole_meeting_from_agenda_summary.mjs'), [transcriptDir, normPrefix, focus], {
      label: 'whole-meeting-summary',
      timeoutMs: 3600000,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
      },
    });
  }, isValidMeetingSummaryMd(meetingSummary));

  await stage('meeting-hook', async () => {
    await runNode(path.join(ROOT, 'command/generate_meeting_hook_from_transcript_folder.mjs'), [transcriptDir, normPrefix, focus, jurisdiction, body], {
      label: 'meeting-hook',
      timeoutMs: 1800000,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
      },
    });
  }, isValidHookTxt(meetingHook));

  await stage('render-transcript-html', async () => {
    const hook = existsFile(meetingHook) ? String(fs.readFileSync(meetingHook, 'utf8')).trim() : '';
    await runNode(path.join(ROOT, 'command/render_transcript_html_from_transcript_folder.mjs'), [
      transcriptDir,
      htmlPath,
      jurisdiction,
      body,
      siteUrl,
      discussionUrl,
      sourceUrl,
      videoUrl,
      hook,
    ], { label: 'render-transcript-html' });
  }, existsFile(htmlPath));

  log('[grey-pipeline] complete');
  log(`[grey-pipeline] transcript_dir: ${transcriptDir}`);
  log(`[grey-pipeline] html: ${htmlPath}`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
