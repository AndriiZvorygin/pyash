#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUMMARY_FOCUS } from "./defaults.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE = path.resolve(PROGRAM_DIR, "..");
const ROOT = path.resolve(PROGRAM_DIR, "../../../..");
const SECRET_PATH = path.join(ROOT, "configure/secret.pya");
const DEFAULT_SITE = "https://helpos.ca";
const DEFAULT_FOCUS = DEFAULT_SUMMARY_FOCUS;
const DEFAULT_STYLE = "bold civic poster background, no person required, high contrast, simple geometry, strong readability";

function usage() {
  return [
    "Usage: node program/run-full-transcript-pipeline.mjs <transcript_dir> [base_prefix] [focus] [jurisdiction] [body] [site_url] [discussion_url]",
    "Example: node ... artifacts/grey-county/meetings/<meeting>/transcript meeting-qwen-auto \"the newsworthy juicy and unusual bits through a distributist lens\" \"Grey County\" \"County Council\" \"https://helpos.ca\" \"\"",
  ].join("\n");
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`directory not found: ${dirPath}`);
}

function existsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function existsDir(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function ensureWritableDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  const probe = path.join(
    dirPath,
    `.write-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(probe, "ok", "utf8");
  fs.unlinkSync(probe);
}

function fileMtimeMs(filePath) {
  try {
    return Number(fs.statSync(filePath).mtimeMs || 0);
  } catch {
    return 0;
  }
}

function hasMinSize(filePath, minBytes = 1) {
  try {
    return fs.statSync(filePath).isFile() && Number(fs.statSync(filePath).size || 0) >= minBytes;
  } catch {
    return false;
  }
}

function countSrtCues(filePath) {
  if (!existsFile(filePath)) return 0;
  const text = safeReadText(filePath, "");
  const m = String(text).match(/^\d\d:\d\d:\d\d,\d\d\d\s+-->\s+\d\d:\d\d:\d\d,\d\d\d$/gmu);
  return Array.isArray(m) ? m.length : 0;
}

function countSpeakerRowsJson(filePath) {
  if (!existsFile(filePath)) return 0;
  const obj = safeReadJson(filePath, {});
  const rows = Array.isArray(obj?.rows) ? obj.rows.length : 0;
  return Number.isFinite(rows) ? rows : 0;
}

function isValidWiseSeries(filePath) {
  if (!hasMinSize(filePath, 150)) return false;
  const text = safeReadText(filePath, "");
  return (
    /su name wise chips be series def/iu.test(text) &&
    /since num /iu.test(text) &&
    /\[Agenda Start\]/iu.test(text)
  );
}

function isValidAgendaMatches(filePath) {
  if (!hasMinSize(filePath, 120)) return false;
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(obj?.chips) && obj.chips.length > 0 && Array.isArray(obj?.boundaries) && obj.boundaries.length > 0;
  } catch {
    return false;
  }
}

function isValidAgendaSummaryJson(filePath) {
  if (!hasMinSize(filePath, 200)) return false;
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(obj?.sections) && obj.sections.length > 0;
  } catch {
    return false;
  }
}

function isValidMeetingSummaryMd(filePath) {
  if (!hasMinSize(filePath, 400)) return false;
  const text = safeReadText(filePath, "");
  return (
    /^#\s+Whole Meeting Summary\b/mu.test(text) &&
    /^##\s+Top Newsworthy Developments\b/mu.test(text) &&
    /^##\s+Why It Matters\b/mu.test(text) &&
    /^##\s+Watch Next\b/mu.test(text)
  );
}

function isValidHookTxt(filePath) {
  if (!hasMinSize(filePath, 4)) return false;
  const line = safeReadText(filePath, "").trim();
  const words = line.split(/\s+/u).filter(Boolean);
  return words.length >= 3;
}

function resolveReporterPath(inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(HOUSE, inputPath);
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

function runWithStreaming({ cmd, args, cwd = ROOT, env = {}, timeoutMs = 30 * 60 * 1000, label = "stage" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk ?? "");
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk ?? "");
      stderr += text;
      process.stderr.write(text);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, Math.max(10_000, Number(timeoutMs) || 10_000));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const msg = `${label} failed (code=${code ?? "null"} signal=${signal ?? ""})`;
      reject(new Error(`${msg}\n${stderr || stdout}`.trim()));
    });
  });
}

async function runSubmitHook(command, payloadPath) {
  const escapedPayload = String(payloadPath).replace(/"/gu, "\\\"");
  await runWithStreaming({
    cmd: "bash",
    args: ["-lc", `${command} "${escapedPayload}"`],
    cwd: ROOT,
    timeoutMs: 10 * 60 * 1000,
    label: "submit-hook",
  });
}

function ffprobeDurationSeconds(audioPath) {
  return new Promise((resolve) => {
    if (!existsFile(audioPath)) return resolve(0);
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let out = "";
    child.stdout.on("data", (chunk) => { out += String(chunk ?? ""); });
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const n = Number(String(out || "").trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
  });
}

function scaleTimeout(baseMs, audioSeconds, slopePerHour = 0.8) {
  const hours = Math.max(0, Number(audioSeconds) || 0) / 3600;
  const factor = 1 + (hours * slopePerHour);
  return Math.round(baseMs * Math.max(1, factor));
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "unknown";
}

function deriveDateLongFromMeetingDir(meetingDirName) {
  const m = String(meetingDirName || "").match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!m) return { iso: "", long: "Unknown date" };
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const dt = new Date(`${iso}T12:00:00Z`);
  return {
    iso,
    long: dt.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
  };
}

function safeReadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeReadText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function syncSpeakerArtifactsToGlobal({ fromDir, toDir }) {
  if (!existsFile(path.join(fromDir, "index.pya"))) return { copied: 0, keys: [] };
  fs.mkdirSync(toDir, { recursive: true });
  const copiedKeys = [];
  const names = fs.readdirSync(fromDir)
    .filter((n) => /^speaker_\d+\.pya$/iu.test(n))
    .map((n) => n.replace(/\.pya$/u, ""))
    .sort();
  for (const key of names) {
    let copiedForKey = false;
    for (const ext of [".pya", ".npy", ".wav"]) {
      const src = path.join(fromDir, `${key}${ext}`);
      const dst = path.join(toDir, `${key}${ext}`);
      if (!existsFile(src)) continue;
      if (!existsFile(dst)) {
        fs.copyFileSync(src, dst);
        copiedForKey = true;
      }
    }
    if (copiedForKey) copiedKeys.push(key);
  }
  return { copied: copiedKeys.length, keys: copiedKeys };
}

function hasSuccessfulMeetingPublishResponse(transcriptDir) {
  if (!existsDir(transcriptDir)) return false;
  const files = fs.readdirSync(transcriptDir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => n.endsWith(".meeting-publish.response.json"));
  for (const name of files) {
    const full = path.join(transcriptDir, name);
    try {
      const obj = JSON.parse(fs.readFileSync(full, "utf8"));
      const postUrl = String(obj?.post_url || "").trim();
      const transcriptUrl = String(obj?.transcript_url || "").trim();
      const err = String(obj?.error || "").trim();
      if ((postUrl || transcriptUrl) && !err) return true;
    } catch {
      // ignore malformed response artifacts
    }
  }
  return false;
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const basePrefix = process.argv[3] || "meeting-qwen-auto";
  const focus = process.argv[4] || DEFAULT_FOCUS;
  const jurisdiction = process.argv[5] || "Grey County";
  const body = process.argv[6] || "County Council";
  const siteUrl = process.argv[7] || DEFAULT_SITE;
  const discussionUrl = process.argv[8] || "";

  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolveReporterPath(transcriptDirArg);
  ensureDir(transcriptDir);
  const meetingDir = path.dirname(transcriptDir);

  const baseVoicesDir = process.env.GREY_VOICES_DIR || path.join(ROOT, "world/voices");
  const requestedVoicesWorkDir = process.env.GREY_VOICES_WORK_DIR || path.join(transcriptDir, "voices-working");
  let voicesWorkDir = requestedVoicesWorkDir;
  try {
    ensureWritableDir(voicesWorkDir);
  } catch {
    const fallback = path.join(os.tmpdir(), "grey-voices-working", path.basename(meetingDir));
    ensureWritableDir(fallback);
    voicesWorkDir = fallback;
    log(`[full-pipeline] warn voices-working not writable: ${requestedVoicesWorkDir}`);
    log(`[full-pipeline] using fallback voices-working: ${voicesWorkDir}`);
  }

  const normPrefix = `${basePrefix}-normalized`;
  const force = /^(1|true|yes)$/iu.test(String(process.env.GREY_PIPELINE_FORCE || ""));
  const skipImage = /^(1|true|yes)$/iu.test(String(process.env.GREY_PIPELINE_SKIP_IMAGE || ""));
  const skipLemmy =
    /^(1|true|yes)$/iu.test(String(process.env.GREY_PIPELINE_SKIP_LEMMY || "")) ||
    /^(1|true|yes)$/iu.test(String(process.env.PIPELINE_SKIP_POST || ""));

  const baseTimingSrt = path.join(transcriptDir, `${basePrefix}.timing.srt`);
  const basePlain = path.join(transcriptDir, `${basePrefix}.plain.txt`);
  const baseMerged = path.join(transcriptDir, `${basePrefix}.merged.srt`);

  const normalizedPlain = path.join(transcriptDir, `${normPrefix}.plain.txt`);
  const normalizedMeta = path.join(transcriptDir, `${normPrefix}.normalize.metadata.json`);
  const normalizedSentenceMerged = path.join(transcriptDir, `${normPrefix}.sentences.merged.srt`);
  const speakerJson = path.join(transcriptDir, `${normPrefix}.sentences.speaker.sentences.json`);
  const speakerSrt = path.join(transcriptDir, `${normPrefix}.sentences.speaker.sentence.srt`);
  const autoAssignReport = path.join(transcriptDir, `${normPrefix}.sentences.speaker.autoassign.report.json`);
  const agendaWiseSeries = path.join(transcriptDir, `${normPrefix}.agenda-wise.series.pya`);
  const agendaMatchesJson = path.join(transcriptDir, `${normPrefix}.agenda.matches.json`);
  const agendaSummaryJson = path.join(transcriptDir, `${normPrefix}.agenda-summary.json`);
  const meetingSummaryMd = path.join(transcriptDir, `${normPrefix}.meeting-summary.md`);
  const meetingHookTxt = path.join(transcriptDir, `${normPrefix}.meeting-hook.txt`);
  const htmlPath = path.join(transcriptDir, "transcript-page.html");
  const coverImagePath = path.join(transcriptDir, `${normPrefix}.meeting-cover.png`);
  const coverImageStablePath = path.join(transcriptDir, "meeting-cover.png");
  const lemmyPayloadPath = path.join(transcriptDir, `${normPrefix}.lemmy-post.json`);
  const lemmyBodyPath = path.join(transcriptDir, `${normPrefix}.lemmy-post.md`);

  const rosterPath = process.env.GREY_ROSTER_FILE || path.join(HOUSE, "artifacts/grey-county/roster.txt");
  const speakerHost = resolveSpeakerHost();
  const speakerHostRoot = resolveSpeakerHostRoot();
  const ollamaHost = resolveOllamaHost();

  const audioPath = path.join(transcriptDir, "meeting-audio.opus");
  const audioSeconds = await ffprobeDurationSeconds(audioPath);
  log(`[full-pipeline] transcript dir: ${transcriptDir}`);
  log(`[full-pipeline] base prefix: ${basePrefix}`);
  log(`[full-pipeline] normalized prefix: ${normPrefix}`);
  log(`[full-pipeline] audio seconds: ${audioSeconds.toFixed(1)}`);

  const stageStatus = [];

  function speakerCheckpointValid() {
    if (!existsFile(speakerJson) || !existsFile(speakerSrt)) return false;
    const expected = countSrtCues(normalizedSentenceMerged);
    if (expected <= 0) return true;
    const rows = countSpeakerRowsJson(speakerJson);
    const srtCues = countSrtCues(speakerSrt);
    const minNeeded = Math.max(40, Math.floor(expected * 0.8));
    return rows >= minNeeded && srtCues >= minNeeded;
  }

  function relabelCheckpointValid() {
    if (!existsFile(speakerJson) || !existsFile(speakerSrt)) return false;
    const srtTime = fileMtimeMs(speakerSrt);
    const jsonTime = fileMtimeMs(speakerJson);
    const reportTime = fileMtimeMs(autoAssignReport);
    return srtTime >= jsonTime && srtTime >= reportTime;
  }

  async function stage(name, fn, { skipWhen = null, optional = false } = {}) {
    if (!force && typeof skipWhen === "function" && skipWhen()) {
      log(`[full-pipeline] skip ${name} (checkpoint exists)`);
      stageStatus.push({ stage: name, status: "skipped" });
      return;
    }
    log(`[full-pipeline] start ${name}`);
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      log(`[full-pipeline] done ${name} in ${(ms / 1000).toFixed(1)}s`);
      stageStatus.push({ stage: name, status: "ok", duration_ms: ms });
    } catch (err) {
      if (optional) {
        log(`[full-pipeline] warn ${name}: ${String(err?.message || err)}`);
        stageStatus.push({ stage: name, status: "warn", error: String(err?.message || err) });
        return;
      }
      throw err;
    }
  }

  await stage("transcribe+merge", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/transcribe-and-merge-qwen-from-transcript-folder.mjs"),
        transcriptDir,
        basePrefix,
      ],
      cwd: ROOT,
      timeoutMs: scaleTimeout(70 * 60 * 1000, audioSeconds, 1.8),
      label: "transcribe+merge",
    });
  }, {
    skipWhen: () => existsFile(baseMerged) && existsFile(baseTimingSrt) && existsFile(basePlain),
  });

  await stage("normalize-transcript", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/normalize-transcript-from-transcript-folder.mjs"),
        transcriptDir,
        basePrefix,
        normPrefix,
      ],
      cwd: ROOT,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
      },
      timeoutMs: scaleTimeout(40 * 60 * 1000, audioSeconds, 1.1),
      label: "normalize-transcript",
    });
  }, {
    skipWhen: () => existsFile(normalizedPlain) && existsFile(normalizedMeta),
  });

  await stage("merge-normalized-sentence-srt", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/lyrics_to_srt_from_timing.mjs"),
        normalizedPlain,
        baseTimingSrt,
        normalizedSentenceMerged,
        "--sentence-cues",
      ],
      cwd: ROOT,
      timeoutMs: 15 * 60 * 1000,
      label: "merge-normalized-sentence-srt",
    });
  }, {
    skipWhen: () => existsFile(normalizedSentenceMerged),
  });

  await stage("diarize-speakers", async () => {
    const sharedEnv = {
      PYA_SPEAKER_ISOLATE_VOICES: process.env.PYA_SPEAKER_ISOLATE_VOICES || "1",
      PYA_SPEAKER_WORKING_VOICES_DIR: voicesWorkDir,
      PYA_SPEAKER_RESEED_VOICES: process.env.PYA_SPEAKER_RESEED_VOICES || "1",
      ...(speakerHost ? { PYA_SPEAKER_HOST: speakerHost } : {}),
      ...(speakerHostRoot ? { PYA_SPEAKER_HOST_ROOT: speakerHostRoot } : {}),
    };
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/diarize_sentence_srt_from_transcript_folder.mjs"),
        transcriptDir,
        `${normPrefix}.sentences`,
        baseVoicesDir,
      ],
      cwd: ROOT,
      env: sharedEnv,
      timeoutMs: scaleTimeout(70 * 60 * 1000, audioSeconds, 1.4),
      label: "diarize-speakers",
    });
  }, {
    skipWhen: () => speakerCheckpointValid(),
  });

  await stage("auto-assign-speakers-from-callouts", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/auto_assign_speakers_from_callouts.mjs"),
        transcriptDir,
        `${normPrefix}.sentences`,
        rosterPath,
        voicesWorkDir,
      ],
      cwd: ROOT,
      timeoutMs: 10 * 60 * 1000,
      label: "auto-assign-speakers-from-callouts",
    });
  }, {
    optional: true,
  });

  await stage("relabel-speakers", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/relabel_speaker_sentence_srt_from_transcript_folder.mjs"),
        transcriptDir,
        `${normPrefix}.sentences`,
        baseVoicesDir,
      ],
      cwd: ROOT,
      timeoutMs: 10 * 60 * 1000,
      label: "relabel-speakers",
    });
  }, {
    skipWhen: () => relabelCheckpointValid(),
  });

  await stage("sync-speaker-artifacts-to-global-voices", async () => {
    const result = syncSpeakerArtifactsToGlobal({ fromDir: voicesWorkDir, toDir: baseVoicesDir });
    log(`[full-pipeline] speaker artifacts copied: ${result.copied}`);
  }, {
    optional: true,
  });

  await stage("agenda-aware-wise-chunks", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/wise-chunk-grey-county-agenda-aware-from-transcript-folder.mjs"),
        transcriptDir,
        normPrefix,
      ],
      cwd: ROOT,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
        GREY_AGENDA_USE_LLM_RANGE: process.env.GREY_AGENDA_USE_LLM_RANGE || "1",
      },
      timeoutMs: scaleTimeout(50 * 60 * 1000, audioSeconds, 0.7),
      label: "agenda-aware-wise-chunks",
    });
  }, {
    skipWhen: () => isValidWiseSeries(agendaWiseSeries) && isValidAgendaMatches(agendaMatchesJson),
  });

  await stage("agenda-section-summaries", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/summarize_agenda_wise_sections_from_transcript_folder.mjs"),
        transcriptDir,
        normPrefix,
        focus,
      ],
      cwd: ROOT,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
      },
      timeoutMs: scaleTimeout(75 * 60 * 1000, audioSeconds, 0.9),
      label: "agenda-section-summaries",
    });
  }, {
    skipWhen: () => isValidAgendaSummaryJson(agendaSummaryJson),
  });

  await stage("whole-meeting-summary", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/summarize_whole_meeting_from_agenda_summary.mjs"),
        transcriptDir,
        normPrefix,
        focus,
      ],
      cwd: ROOT,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
      },
      timeoutMs: 35 * 60 * 1000,
      label: "whole-meeting-summary",
    });
  }, {
    skipWhen: () => isValidMeetingSummaryMd(meetingSummaryMd),
  });

  await stage("meeting-hook", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/generate_meeting_hook_from_transcript_folder.mjs"),
        transcriptDir,
        normPrefix,
        focus,
        jurisdiction,
        body,
      ],
      cwd: ROOT,
      env: {
        ...(ollamaHost ? { OLLAMA_HOST: ollamaHost } : {}),
      },
      timeoutMs: 15 * 60 * 1000,
      label: "meeting-hook",
    });
  }, {
    skipWhen: () => isValidHookTxt(meetingHookTxt),
  });

  const meetingJsonPath = path.join(meetingDir, "meeting.json");
  const meetingPayload = safeReadJson(meetingJsonPath, {})?.payload || {};
  const meetingUrl = String(meetingPayload?.meeting_url || "").trim();
  const payloadVideoDirect = Array.isArray(meetingPayload?.video_direct)
    ? meetingPayload.video_direct.find((x) => /^https?:\/\//iu.test(String(x || "")))
    : "";
  const payloadVideo = Array.isArray(meetingPayload?.video)
    ? meetingPayload.video.find((x) => /^https?:\/\//iu.test(String(x || "")))
    : "";
  const preferredVideo = String(payloadVideoDirect || payloadVideo || "");

  const hook = safeReadText(meetingHookTxt, "").trim();

  await stage("render-html", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/render_transcript_html_from_transcript_folder.mjs"),
        transcriptDir,
        htmlPath,
        jurisdiction,
        body,
        siteUrl,
        discussionUrl,
        meetingUrl,
        preferredVideo,
        hook,
      ],
      cwd: ROOT,
      timeoutMs: 10 * 60 * 1000,
      label: "render-html",
    });
  });

  await stage("draw-meeting-image", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/draw_meeting_cover_from_transcript_folder.mjs"),
        transcriptDir,
        normPrefix,
        process.env.GREY_DRAW_STYLE || DEFAULT_STYLE,
      ],
      cwd: ROOT,
      timeoutMs: 45 * 60 * 1000,
      label: "draw-meeting-image",
    });
  }, {
    skipWhen: () => skipImage || existsFile(coverImagePath) || existsFile(coverImageStablePath),
    optional: true,
  });

  await stage("lemmy-payload", async () => {
    const summaryMd = safeReadText(meetingSummaryMd, "").trim();
    const dateInfo = deriveDateLongFromMeetingDir(path.basename(meetingDir));
    const dateLong = dateInfo.long;
    const hookTitle = hook || "Grey County Meeting Highlights";
    const title = `${hookTitle} — ${jurisdiction} ${body} Transcript — ${dateLong}`;

    const canonicalUrl = `${siteUrl.replace(/\/+$/u, "")}/transcripts/${slugify(jurisdiction)}/${slugify(body)}/${dateInfo.iso || "unknown-date"}`;
    const sourceLinks = [];
    if (meetingUrl) sourceLinks.push(`Official meeting page: ${meetingUrl}`);
    if (preferredVideo) sourceLinks.push(`Original video: ${preferredVideo}`);

    const bodyLines = [];
    if (summaryMd) bodyLines.push(summaryMd);
    bodyLines.push(`Read full transcript: ${canonicalUrl}`);
    if (sourceLinks.length) bodyLines.push(sourceLinks.join("\n"));
    if (discussionUrl) bodyLines.push(`HelpOS discussion: ${discussionUrl}`);

    const bodyMd = bodyLines.join("\n\n").trim();

    const payload = {
      title,
      body_markdown: bodyMd,
      transcript_url: canonicalUrl,
      local_transcript_html: htmlPath,
      local_cover_image: existsFile(coverImageStablePath) ? coverImageStablePath : (existsFile(coverImagePath) ? coverImagePath : ""),
      jurisdiction,
      body,
      date_iso: dateInfo.iso,
      hook: hookTitle,
      focus,
      source: {
        meeting_url: meetingUrl || "",
        video_url: preferredVideo,
      },
      discussion_url: discussionUrl || "",
      generated_at_utc: new Date().toISOString(),
    };

    fs.writeFileSync(lemmyPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(lemmyBodyPath, `${bodyMd}\n`, "utf8");
    log(`[full-pipeline] wrote: ${lemmyPayloadPath}`);
    log(`[full-pipeline] wrote: ${lemmyBodyPath}`);

    const submitCommand = String(process.env.GREY_LEMMY_POST_COMMAND || process.env.MEETING_POST_COMMAND || "").trim();
    if (!submitCommand) {
      log("[full-pipeline] submit skipped (set GREY_LEMMY_POST_COMMAND or MEETING_POST_COMMAND)");
      return;
    }

    log(`[full-pipeline] submit command: ${submitCommand}`);
    await runSubmitHook(submitCommand, lemmyPayloadPath);
  }, {
    skipWhen: () => skipLemmy || (existsFile(lemmyPayloadPath) && existsFile(lemmyBodyPath) && hasSuccessfulMeetingPublishResponse(transcriptDir)),
  });

  const reportPath = path.join(transcriptDir, `${normPrefix}.full-pipeline.report.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify({
    transcript_dir: transcriptDir,
    base_prefix: basePrefix,
    normalized_prefix: normPrefix,
    focus,
    jurisdiction,
    body,
    site_url: siteUrl,
    discussion_url: discussionUrl,
    voices_base_dir: baseVoicesDir,
    voices_work_dir: voicesWorkDir,
    audio_seconds: audioSeconds,
    stages: stageStatus,
    outputs: {
      normalized_plain: normalizedPlain,
      speaker_srt: speakerSrt,
      agenda_summary_json: agendaSummaryJson,
      meeting_summary_md: meetingSummaryMd,
      meeting_hook_txt: meetingHookTxt,
      html: htmlPath,
      image: existsFile(coverImageStablePath) ? coverImageStablePath : (existsFile(coverImagePath) ? coverImagePath : ""),
      lemmy_payload: lemmyPayloadPath,
    },
    generated_at_utc: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");

  log(`[full-pipeline] report: ${reportPath}`);
  log("[full-pipeline] complete");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
