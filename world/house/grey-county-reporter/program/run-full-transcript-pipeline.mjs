#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUMMARY_FOCUS } from "./defaults.mjs";
import {
  buildGreyTranscriptArtifacts,
  existsArtifact,
  loadJsonArtifact,
  savePyaReportArtifact,
} from "./shared/artifact-contracts.mjs";
import { createStageRunner } from "./shared/stage-runner.mjs";
import { runQualityVerifiers } from "./shared/quality-verifiers.mjs";
import { GREY_ADAPTER } from "./writer-adapter-grey-county.mjs";
import { normalizePublishConfig } from "../../../../program/publisher-interface.mjs";
import { readPyaTextValues } from "../../../../command/pya_lookup.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE = path.resolve(PROGRAM_DIR, "..");
const ROOT = path.resolve(PROGRAM_DIR, "../../../..");
const SECRET_PATHS = [
  path.join(HOUSE, "configure/secret.pya"),
  path.join(ROOT, "configure/secret.pya"),
];
const SECRET_PATH = SECRET_PATHS.find((p) => fs.existsSync(p)) || SECRET_PATHS[0];
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

const SECRET_VALUES = readPyaTextValues(SECRET_PATH, [
  "speaker host",
  "speaker host root",
  "ollama host",
  "ai host",
  "relay local host",
]);

function resolveSpeakerHost() {
  const fromEnv = String(process.env.PYA_SPEAKER_HOST || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/u, "");
  return String(SECRET_VALUES["speaker host"] || "").trim().replace(/\/$/u, "");
}

function resolveSpeakerHostRoot() {
  const fromEnv = String(process.env.PYA_SPEAKER_HOST_ROOT || "").trim();
  if (fromEnv) return fromEnv;
  return String(SECRET_VALUES["speaker host root"] || "").trim();
}

function resolveOllamaHost() {
  const fromEnv = String(process.env.OLLAMA_HOST || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/u, "");
  const fromPya = String(SECRET_VALUES["ollama host"] || SECRET_VALUES["ai host"] || SECRET_VALUES["relay local host"] || "").trim();
  return fromPya.replace(/\/$/u, "");
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

  const artifacts = buildGreyTranscriptArtifacts({ transcriptDir, basePrefix });
  const normPrefix = artifacts.normalized_prefix;
  const force = /^(1|true|yes)$/iu.test(String(process.env.GREY_PIPELINE_FORCE || ""));
  const skipImage = /^(1|true|yes)$/iu.test(String(process.env.GREY_PIPELINE_SKIP_IMAGE || ""));
  const skipLemmy =
    /^(1|true|yes)$/iu.test(String(process.env.GREY_PIPELINE_SKIP_LEMMY || "")) ||
    /^(1|true|yes)$/iu.test(String(process.env.PIPELINE_SKIP_POST || ""));

  const baseTimingSrt = artifacts.base_timing_srt;
  const basePlain = artifacts.base_plain_txt;
  const baseMerged = artifacts.base_merged_srt;

  const normalizedPlain = artifacts.normalized_plain_txt;
  const normalizedMeta = artifacts.normalized_meta_json;
  const normalizedSentenceMerged = artifacts.normalized_sentence_merged_srt;
  const timedSentenceMerged = path.join(transcriptDir, `${basePrefix}.sentences.merged.srt`);
  const speakerJson = artifacts.speaker_json;
  const speakerSrt = artifacts.speaker_srt;
  const autoAssignReport = artifacts.autoassign_report_json;
  const agendaWiseSeries = artifacts.agenda_wise_series_pya;
  const agendaMatchesJson = artifacts.agenda_matches_json;
  const agendaSummaryJson = artifacts.agenda_summary_json;
  const meetingSummaryMd = artifacts.meeting_summary_md;
  const meetingHookTxt = artifacts.meeting_hook_txt;
  const htmlPath = artifacts.transcript_html;
  const coverImagePath = artifacts.cover_image;
  const coverImageStablePath = artifacts.cover_image_stable;
  const lemmyPayloadPath = artifacts.lemmy_payload_json;
  const lemmyBodyPath = artifacts.lemmy_post_md;

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
  let qualityVerifier = {
    checks: {},
    issues: [],
    summary: { has_error: false, has_warn: false, issue_count: 0 },
  };
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const meetingId = String(loadJsonArtifact(path.join(meetingDir, "meeting.json"), {})?.payload?.meeting_id || "").trim();
  const stageRunner = createStageRunner({
    log,
    force,
    writer: GREY_ADAPTER.writer_id,
    source: GREY_ADAPTER.source_id,
    meetingId,
    runId,
  });

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

  async function stage(name, fn, opts = {}) {
    const record = await stageRunner.runStage(name, fn, opts);
    const legacy = { stage: name, status: record.status };
    if (record.duration_ms > 0) legacy.duration_ms = record.duration_ms;
    if (record.status === "warn" && record.error) legacy.error = record.error;
    stageStatus.push(legacy);
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
    inputArtifacts: [audioPath],
    outputArtifacts: [baseMerged, baseTimingSrt, basePlain],
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
    inputArtifacts: [basePlain, baseTimingSrt],
    outputArtifacts: [normalizedPlain, normalizedMeta],
  });

  await stage("merge-normalized-sentence-srt", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/sentence_srt_from_timing_srt.mjs"),
        baseTimingSrt,
        timedSentenceMerged,
      ],
      cwd: ROOT,
      timeoutMs: 5 * 60 * 1000,
      label: "merge-normalized-sentence-srt",
    });
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/apply_string_replacement_map_to_srt.mjs"),
        timedSentenceMerged,
        normalizedMeta,
        normalizedSentenceMerged,
      ],
      cwd: ROOT,
      timeoutMs: 5 * 60 * 1000,
      label: "apply-normalize-replacements-to-sentence-srt",
    });
  }, {
    skipWhen: () => existsFile(normalizedSentenceMerged),
    inputArtifacts: [baseTimingSrt, normalizedMeta],
    outputArtifacts: [timedSentenceMerged, normalizedSentenceMerged],
  });

  await stage("diarize-speakers", async () => {
    const sharedEnv = {
      PYA_SPEAKER_ISOLATE_VOICES: process.env.PYA_SPEAKER_ISOLATE_VOICES || "0",
      PYA_SPEAKER_WORKING_VOICES_DIR: voicesWorkDir,
      PYA_SPEAKER_RESEED_VOICES: process.env.PYA_SPEAKER_RESEED_VOICES || "0",
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
    inputArtifacts: [normalizedSentenceMerged],
    outputArtifacts: [speakerJson, speakerSrt],
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
      env: {
        PYA_AUTOASSIGN_OVERWRITE_EXISTING: "0",
      },
      timeoutMs: 10 * 60 * 1000,
      label: "auto-assign-speakers-from-callouts",
    });
  }, {
    optional: true,
    inputArtifacts: [speakerJson, rosterPath],
    outputArtifacts: [autoAssignReport],
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
    inputArtifacts: [speakerJson, autoAssignReport],
    outputArtifacts: [speakerSrt, speakerJson],
  });

  await stage("sync-speaker-artifacts-to-global-voices", async () => {
    const result = syncSpeakerArtifactsToGlobal({ fromDir: voicesWorkDir, toDir: baseVoicesDir });
    log(`[full-pipeline] speaker artifacts copied: ${result.copied}`);
  }, {
    optional: true,
    outputArtifacts: [baseVoicesDir],
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
    inputArtifacts: [speakerSrt],
    outputArtifacts: [agendaWiseSeries, agendaMatchesJson],
  });

  await stage("agenda-section-summaries", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/summarize-agenda-wise-sections-from-transcript-folder.mjs"),
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
    inputArtifacts: [agendaWiseSeries, agendaMatchesJson],
    outputArtifacts: [agendaSummaryJson],
  });

  await stage("whole-meeting-summary", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/summarize-whole-meeting-from-agenda-summary.mjs"),
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
    inputArtifacts: [agendaSummaryJson],
    outputArtifacts: [meetingSummaryMd],
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
    inputArtifacts: [meetingSummaryMd],
    outputArtifacts: [meetingHookTxt],
  });

  await stage("quality-verifiers", async () => {
    const mode = String(process.env.AGENDA_SUMMARY_TIME_MODE || "standard").trim().toLowerCase();
    qualityVerifier = runQualityVerifiers({
      meetingSummaryMdPath: meetingSummaryMd,
      agendaSummaryJsonPath: agendaSummaryJson,
      mode,
      writer: GREY_ADAPTER.writer_id,
      source: GREY_ADAPTER.source_id,
      jurisdiction,
      body,
    });
    const notes = (qualityVerifier.issues || [])
      .map((x) => `[${x.level}] ${x.check}:${x.code}${x.detail ? ` ${x.detail}` : ""}`)
      .join(" | ");
    return {
      validation_flags: {
        required_sections_ok: Boolean(qualityVerifier?.checks?.required_sections?.ok),
        truncation_ok: Boolean(qualityVerifier?.checks?.truncation?.ok),
        tense_ok: Boolean(qualityVerifier?.checks?.tense?.ok),
        identity_scoping_ok: Boolean(qualityVerifier?.checks?.identity_scoping?.ok),
        verifier_has_error: Boolean(qualityVerifier?.summary?.has_error),
        verifier_has_warn: Boolean(qualityVerifier?.summary?.has_warn),
      },
      notes,
    };
  }, {
    inputArtifacts: [agendaSummaryJson, meetingSummaryMd],
    outputArtifacts: [agendaSummaryJson, meetingSummaryMd],
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
  }, {
    inputArtifacts: [speakerSrt, meetingHookTxt],
    outputArtifacts: [htmlPath],
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
    inputArtifacts: [meetingSummaryMd, meetingHookTxt],
    outputArtifacts: [coverImagePath, coverImageStablePath],
  });

  let publishStatus = {
    mode: "skip",
    command_source_env: "",
    dry_run: false,
    community_name: "",
  };

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

    const publishCfg = normalizePublishConfig({
      env: process.env,
      adapter: GREY_ADAPTER,
      fallbackCommand: "",
    });
    publishStatus = {
      mode: "skip",
      command_source_env: publishCfg.command_source_env || "",
      dry_run: Boolean(publishCfg.dry_run),
      community_name: publishCfg.community_name || "",
    };
    const submitCommand = String(publishCfg.command || "").trim();
    if (!submitCommand) {
      log("[full-pipeline] submit skipped (set GREY_LEMMY_POST_COMMAND or MEETING_POST_COMMAND)");
      publishStatus.mode = "skip_no_command";
      return;
    }

    log(`[full-pipeline] submit command: ${submitCommand}`);
    await runSubmitHook(submitCommand, lemmyPayloadPath);
    publishStatus.mode = publishCfg.dry_run ? "dry_run" : "submitted";
  }, {
    skipWhen: () => skipLemmy || (existsFile(lemmyPayloadPath) && existsFile(lemmyBodyPath) && hasSuccessfulMeetingPublishResponse(transcriptDir)),
    inputArtifacts: [meetingSummaryMd, meetingHookTxt, htmlPath],
    outputArtifacts: [lemmyPayloadPath, lemmyBodyPath],
    validationFlags: {
      skip_post: skipLemmy,
    },
  });

  const reportPath = artifacts.full_pipeline_report_pya;
  const legacyReportJsonPath = path.join(transcriptDir, `${normPrefix}.full-pipeline.report.json`);
  savePyaReportArtifact(reportPath, {
    report_version: "phase1-stage-report-v1",
    writer: GREY_ADAPTER.writer_id,
    source: GREY_ADAPTER.source_id,
    meeting_id: meetingId || "",
    run_id: runId,
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
    stage_runs: stageRunner.getStageRuns(),
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
    validation_flags: {
      has_cover_image: existsArtifact(coverImageStablePath) || existsArtifact(coverImagePath),
      has_publish_response: hasSuccessfulMeetingPublishResponse(transcriptDir),
      speaker_checkpoint_valid: speakerCheckpointValid(),
      relabel_checkpoint_valid: relabelCheckpointValid(),
      required_sections_ok: Boolean(qualityVerifier?.checks?.required_sections?.ok),
      truncation_ok: Boolean(qualityVerifier?.checks?.truncation?.ok),
      tense_ok: Boolean(qualityVerifier?.checks?.tense?.ok),
      identity_scoping_ok: Boolean(qualityVerifier?.checks?.identity_scoping?.ok),
      verifier_has_error: Boolean(qualityVerifier?.summary?.has_error),
      verifier_has_warn: Boolean(qualityVerifier?.summary?.has_warn),
      publish_mode: publishStatus.mode,
      publish_dry_run: Boolean(publishStatus.dry_run),
      publish_has_command: Boolean(publishStatus.command_source_env || publishStatus.mode === "submitted" || publishStatus.mode === "dry_run"),
    },
    publish: publishStatus,
    verifier_results: qualityVerifier,
    generated_at_utc: new Date().toISOString(),
  });
  if (existsFile(legacyReportJsonPath)) fs.unlinkSync(legacyReportJsonPath);

  log(`[full-pipeline] report: ${reportPath}`);
  log("[full-pipeline] complete");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
