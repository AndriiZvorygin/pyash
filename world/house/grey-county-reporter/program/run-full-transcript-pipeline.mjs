#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUMMARY_FOCUS } from "./defaults.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE = path.resolve(PROGRAM_DIR, "..");
const ROOT = path.resolve(PROGRAM_DIR, "../../../..");
const DEFAULT_SITE = "https://helpos.ca";
const DEFAULT_FOCUS = DEFAULT_SUMMARY_FOCUS;

function usage() {
  return [
    "Usage: node program/run-full-transcript-pipeline.mjs <transcript_dir> [base_prefix] [focus] [jurisdiction] [body] [site_url] [discussion_url]",
    "Example: node ... artifacts/grey-county/meetings/<meeting>/transcript meeting-qwen-auto \"the newsworthy juicy and unusual bits through a distributist lens\" \"Grey County\" \"County Council\" \"https://helpos.ca\" \"\"",
  ].join("\n");
}

function existsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`directory not found: ${dirPath}`);
}

function resolveReporterPath(inputPath) {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const fromCwd = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(HOUSE, inputPath);
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
    long: dt.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }),
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

async function stage(name, fn, { skipWhen = null } = {}) {
  if (typeof skipWhen === "function" && skipWhen()) {
    process.stdout.write(`[full-pipeline] skip ${name} (checkpoint exists)\n`);
    return;
  }
  process.stdout.write(`[full-pipeline] start ${name}\n`);
  const t0 = Date.now();
  await fn();
  const ms = Date.now() - t0;
  process.stdout.write(`[full-pipeline] done ${name} in ${(ms / 1000).toFixed(1)}s\n`);
}

async function main() {
  const transcriptDirArg = process.argv[2];
  const basePrefix = process.argv[3] || "meeting-qwen-auto";
  const focus = process.argv[4] || DEFAULT_FOCUS;
  const jurisdiction = process.argv[5] || "Grey County";
  const body = process.argv[6] || "County Council";
  const siteUrl = process.argv[7] || DEFAULT_SITE;
  const discussionUrl = process.argv[8] || "";
  const skipImage = /^(1|true|yes)$/iu.test(String(process.env.GREY_PIPELINE_SKIP_IMAGE || ""));

  if (!transcriptDirArg) {
    process.stdout.write(`${usage()}\n`);
    process.exit(2);
  }

  const transcriptDir = resolveReporterPath(transcriptDirArg);
  ensureDir(transcriptDir);

  const normPrefix = `${basePrefix}-normalized`;
  const baseTimingSrt = path.join(transcriptDir, `${basePrefix}.timing.srt`);
  const basePlain = path.join(transcriptDir, `${basePrefix}.plain.txt`);
  const baseMerged = path.join(transcriptDir, `${basePrefix}.merged.srt`);
  const normalizedPlain = path.join(transcriptDir, `${normPrefix}.plain.txt`);
  const normalizedMeta = path.join(transcriptDir, `${normPrefix}.normalize.metadata.json`);
  const normalizedSentenceMerged = path.join(transcriptDir, `${normPrefix}.sentences.merged.srt`);
  const meetingSummaryMd = path.join(transcriptDir, `${normPrefix}.meeting-summary.md`);
  const meetingHookTxt = path.join(transcriptDir, `${normPrefix}.meeting-hook.txt`);
  const htmlPath = path.join(transcriptDir, "transcript-page.html");
  const coverImagePath = path.join(transcriptDir, `${normPrefix}.meeting-cover.png`);
  const coverImageStablePath = path.join(transcriptDir, "meeting-cover.png");
  const lemmyPayloadPath = path.join(transcriptDir, `${normPrefix}.lemmy-post.json`);
  const lemmyBodyPath = path.join(transcriptDir, `${normPrefix}.lemmy-post.md`);

  await stage("transcribe+merge", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/transcribe-and-merge-qwen-from-transcript-folder.mjs"),
        transcriptDir,
        basePrefix,
      ],
      cwd: ROOT,
      timeoutMs: 2 * 60 * 60 * 1000,
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
      timeoutMs: 90 * 60 * 1000,
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
      timeoutMs: 25 * 60 * 1000,
      label: "merge-normalized-sentence-srt",
    });
  }, {
    skipWhen: () => existsFile(normalizedSentenceMerged),
  });

  const meetingDir = path.dirname(transcriptDir);
  const meetingPayload = safeReadJson(path.join(meetingDir, "meeting.json"), {})?.payload || {};
  const sourceUrl = String(meetingPayload?.meeting_url || "");
  const videoUrl =
    (Array.isArray(meetingPayload?.video_direct) ? meetingPayload.video_direct.find((x) => /^https?:\/\//iu.test(String(x || ""))) : "") ||
    (Array.isArray(meetingPayload?.video) ? meetingPayload.video.find((x) => /^https?:\/\//iu.test(String(x || ""))) : "") ||
    "";

  await stage("shared-transcript-pipeline", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(HOUSE, "program/run-shared-transcript-pipeline-from-folder.mjs"),
        transcriptDir,
        basePrefix,
        focus,
        jurisdiction,
        body,
        siteUrl,
        discussionUrl,
        sourceUrl,
        videoUrl,
      ],
      cwd: ROOT,
      timeoutMs: 4 * 60 * 60 * 1000,
      label: "shared-transcript-pipeline",
    });
  });

  await stage("draw-meeting-cover", async () => {
    await runWithStreaming({
      cmd: "node",
      args: [
        path.join(ROOT, "command/draw_meeting_cover_from_transcript_folder.mjs"),
        transcriptDir,
        normPrefix,
        process.env.GREY_DRAW_STYLE || "",
      ],
      cwd: ROOT,
      timeoutMs: 45 * 60 * 1000,
      label: "draw-meeting-cover",
    });
  }, {
    skipWhen: () => skipImage || existsFile(coverImageStablePath) || existsFile(coverImagePath),
  });

  await stage("lemmy-payload", async () => {
    const summaryMd = safeReadText(meetingSummaryMd, "").trim();
    const hook = safeReadText(meetingHookTxt, "").trim();
    const dateInfo = deriveDateLongFromMeetingDir(path.basename(meetingDir));
    const canonicalUrl = `${siteUrl.replace(/\/+$/u, "")}/transcripts/${slugify(jurisdiction)}/${slugify(body)}/${dateInfo.iso || "unknown-date"}`;
    const title = `${hook || "Grey County Meeting Highlights"} - ${jurisdiction} ${body} Transcript - ${dateInfo.long}`;

    const bodyParts = [];
    if (summaryMd) bodyParts.push(summaryMd);
    bodyParts.push(`Read full transcript: ${canonicalUrl}`);
    if (sourceUrl) bodyParts.push(`Official meeting page: ${sourceUrl}`);
    if (videoUrl) bodyParts.push(`Original video: ${videoUrl}`);
    if (discussionUrl) bodyParts.push(`HelpOS discussion: ${discussionUrl}`);

    const bodyMarkdown = bodyParts.join("\n\n").trim();
    const payload = {
      title,
      body_markdown: bodyMarkdown,
      transcript_url: canonicalUrl,
      local_transcript_html: htmlPath,
      local_cover_image: existsFile(coverImageStablePath) ? coverImageStablePath : (existsFile(coverImagePath) ? coverImagePath : ""),
      jurisdiction,
      body,
      date_iso: dateInfo.iso,
      hook: hook || "Grey County Meeting Highlights",
      focus,
      source: {
        meeting_url: sourceUrl,
        video_url: videoUrl,
      },
      discussion_url: discussionUrl,
      generated_at_utc: new Date().toISOString(),
    };

    fs.writeFileSync(lemmyPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(lemmyBodyPath, `${bodyMarkdown}\n`, "utf8");
    process.stdout.write(`[full-pipeline] wrote: ${lemmyPayloadPath}\n`);
    process.stdout.write(`[full-pipeline] wrote: ${lemmyBodyPath}\n`);

    const submitCommand = String(
      process.env.GREY_LEMMY_POST_COMMAND || process.env.MEETING_POST_COMMAND || "",
    ).trim();
    if (!submitCommand) {
      process.stdout.write("[full-pipeline] submit skipped (set GREY_LEMMY_POST_COMMAND or MEETING_POST_COMMAND)\n");
      return;
    }
    process.stdout.write(`[full-pipeline] submit command: ${submitCommand}\n`);
    await runSubmitHook(submitCommand, lemmyPayloadPath);
  });

  process.stdout.write(`[full-pipeline] transcript_dir: ${transcriptDir}\n`);
  process.stdout.write(`[full-pipeline] html: ${htmlPath}\n`);
  process.stdout.write(`[full-pipeline] lemmy_payload: ${lemmyPayloadPath}\n`);
  process.stdout.write("[full-pipeline] complete\n");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
