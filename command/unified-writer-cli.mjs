#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPyaTextValues } from "./pya_lookup.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYASH_ROOT = path.resolve(HERE, "..");

const WRITER_MAP = {
  grey: {
    adapterFile: path.join(PYASH_ROOT, "world/house/grey-county-reporter/program/writer-adapter-grey-county.mjs"),
    adapterExport: "GREY_ADAPTER",
    nextStoryScript: path.join(PYASH_ROOT, "world/house/grey-county-reporter/program/run-next-unposted-story.mjs"),
    publishScript: path.join(PYASH_ROOT, "world/house/grey-county-reporter/program/publish-meeting-to-helpos-from-payload.mjs"),
    envPrefix: "GREY",
    defaultCommunity: "grey-county-council",
  },
  owen: {
    adapterFile: path.join(PYASH_ROOT, "world/house/owen-sound-reporter/program/writer-adapter-owen-sound.mjs"),
    adapterExport: "OWEN_ADAPTER",
    nextStoryScript: path.join(PYASH_ROOT, "world/house/owen-sound-reporter/program/run-next-unposted-story.mjs"),
    publishScript: path.join(PYASH_ROOT, "world/house/owen-sound-reporter/program/publish-meeting-to-helpos-from-payload.mjs"),
    envPrefix: "OWEN",
    defaultCommunity: "owen-sound-council",
  },
  andrii: {
    adapterFile: path.join(PYASH_ROOT, "world/house/andrii-youtube-reporter/program/writer-adapter-andrii-youtube.mjs"),
    adapterExport: "ANDRII_ADAPTER",
    nextStoryScript: path.join(PYASH_ROOT, "world/house/andrii-youtube-reporter/program/run-next-unposted-story.mjs"),
    publishScript: path.join(PYASH_ROOT, "world/house/andrii-youtube-reporter/program/publish-meeting-to-andrii-from-payload.mjs"),
    envPrefix: "ANDRII",
    defaultCommunity: "andrii-zvorygin",
  },
};

function usage() {
  return [
    "Usage: node command/unified-writer-cli.mjs <command> --writer <grey|owen|andrii> [options]",
    "",
    "Commands:",
    "  list          list meeting workspaces and current stage",
    "  next          pick next unposted candidate and run pipeline",
    "  pick-next     alias of next",
    "  run           run selected meeting by --meeting <selector>",
    "  rerun-stage   rerun a specific stage for --meeting <selector>",
    "  verify        rerun verification-oriented path for --meeting",
    "  publish       run publish-oriented path for --meeting",
    "  inspect       print report/artifact paths for --meeting",
    "",
    "Common flags:",
    "  --writer <id>             writer adapter id (grey|owen|andrii)",
    "  --meeting <selector>      index, 8-char id prefix, full id/url, or folder fragment",
    "  --refresh                 force monthly refresh",
    "  --pick-only               select candidate only (no pipeline)",
    "  --diarize-only            run only transcript diarization stages",
    "  --list                    alias for command list",
    "  --stage <name>            for rerun-stage: prep|full|image|verify|publish",
    "  --force <stage>           repeatable; prep|full|image",
    "  --skip <stage>            repeatable; prep|full|image",
    "  --post                    enable posting",
    "  --post-ref <id|url>       force publish UPDATE target",
    "  --no-post                 disable posting",
    "  --dry-run                 publish dry run",
    "  --help                    show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    command: "",
    writer: "",
    meeting: "",
    refresh: false,
    pickOnly: false,
    diarizeOnly: false,
    list: false,
    stage: "",
    force: new Set(),
    skip: new Set(),
    post: undefined,
    postRef: "",
    dryRun: false,
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith("-")) {
    out.command = args.shift();
  }

  while (args.length) {
    const a = args.shift();
    if (a === "--writer") out.writer = String(args.shift() || "").trim().toLowerCase();
    else if (a === "--meeting") out.meeting = String(args.shift() || "").trim();
    else if (a === "--refresh") out.refresh = true;
    else if (a === "--pick-only") out.pickOnly = true;
    else if (a === "--diarize-only") out.diarizeOnly = true;
    else if (a === "--list") out.list = true;
    else if (a === "--stage") out.stage = String(args.shift() || "").trim().toLowerCase();
    else if (a === "--force") out.force.add(String(args.shift() || "").trim().toLowerCase());
    else if (a === "--skip") out.skip.add(String(args.shift() || "").trim().toLowerCase());
    else if (a === "--post") out.post = true;
    else if (a === "--post-ref") out.postRef = String(args.shift() || "").trim();
    else if (a === "--no-post") out.post = false;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }

  if (!out.command) out.command = out.list ? "list" : "next";
  if (out.command === "pick-next") out.command = "next";
  if (out.list) out.command = "list";
  return out;
}

function parseDotEnvText(src) {
  const out = {};
  for (const raw of String(src || "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    if (!k) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function readEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseDotEnvText(fs.readFileSync(filePath, "utf8"));
}

function loadSecretFallbacks(adapterHouseRoot) {
  const paths = [
    path.join(adapterHouseRoot, "configure", "secret.pya"),
    path.join(PYASH_ROOT, "configure", "secret.pya"),
  ];
  const out = {};
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const values = readPyaTextValues(p, [
      "meeting publish auth token",
      "meeting publish community name",
      "meeting publish site url",
      "grey county reporter username",
      "grey county reporter password",
      "owen sound reporter username",
      "owen sound reporter password",
      "andrii zvorygin reporter username",
      "andrii zvorygin reporter password",
    ]);
    for (const [k, v] of Object.entries(values)) {
      const text = String(v || "").trim();
      if (!text || /^REPLACE_/iu.test(text)) continue;
      if (!out[k]) out[k] = text;
    }
  }
  return out;
}

function runWithStreaming({ cmd, args, cwd, env, label, timeoutMs = 8 * 60 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const t = String(chunk || "");
      stdout += t;
      process.stdout.write(t);
    });
    child.stderr.on("data", (chunk) => {
      const t = String(chunk || "");
      stderr += t;
      process.stderr.write(t);
    });

    const timer = setTimeout(() => child.kill("SIGKILL"), Math.max(10_000, Number(timeoutMs) || 10_000));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${label} failed (code=${code ?? "null"} signal=${signal ?? ""})\n${stderr || stdout}`.trim()));
    });
  });
}

function inferFolder(row) {
  const payload = row.payload || {};
  const day = String(row.since || "").slice(0, 10) || "unknown-day";
  const id = String(payload.meeting_id || "unknown-id");
  const slug = String(payload.meeting_name || "meeting")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "meeting";
  return `${day}_${slug}_${id.slice(0, 8)}`;
}

function parseSeriesLine(line) {
  const m = line.match(/^su name (.+?) since date (\S+) until date (\S+) ob text "(.+)" ya$/u);
  if (!m) return null;
  const [, suName, since, until, escapedJson] = m;
  let payload = null;
  try {
    payload = JSON.parse(JSON.parse(`"${escapedJson}"`));
  } catch {
    return null;
  }
  return { suName, since, until, payload };
}

function loadAllMeetings(monthlyDir) {
  if (!fs.existsSync(monthlyDir)) return [];
  const files = fs.readdirSync(monthlyDir)
    .filter((n) => n.endsWith(".events.series.pya"))
    .map((n) => path.join(monthlyDir, n))
    .sort();
  const rows = [];
  for (const filePath of files) {
    for (const raw of fs.readFileSync(filePath, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line.includes(" since date ")) continue;
      const row = parseSeriesLine(line);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function findPipelineReportPath(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return "";
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.full-pipeline.report.pya`);
  if (fs.existsSync(direct)) return direct;
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith(".full-pipeline.report.pya"))
    .sort();
  return files.length ? path.join(transcriptDir, files[files.length - 1]) : "";
}

function findPublishResponsePath(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return "";
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.meeting-publish.response.json`);
  if (fs.existsSync(direct)) return direct;
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith(".meeting-publish.response.json"))
    .sort();
  return files.length ? path.join(transcriptDir, files[files.length - 1]) : "";
}

function findAgendaPublishResponsePath(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return "";
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.agenda-publish.response.json`);
  if (fs.existsSync(direct)) return direct;
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith(".agenda-publish.response.json"))
    .sort();
  return files.length ? path.join(transcriptDir, files[files.length - 1]) : "";
}

function findLemmyPayloadPath(transcriptDir, basePrefix) {
  if (!fs.existsSync(transcriptDir)) return "";
  const direct = path.join(transcriptDir, `${basePrefix}-normalized.lemmy-post.json`);
  if (fs.existsSync(direct)) return direct;
  const files = fs.readdirSync(transcriptDir)
    .filter((n) => n.endsWith(".lemmy-post.json"))
    .sort();
  return files.length ? path.join(transcriptDir, files[files.length - 1]) : "";
}

function readPayloadContentType(payloadPath) {
  if (!payloadPath || !fs.existsSync(payloadPath)) return "";
  try {
    const json = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    return String(json?.content_type || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function parsePostedFromResponse(respPath) {
  if (!respPath || !fs.existsSync(respPath)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(respPath, "utf8"));
    const transcriptUrl = String(json?.transcript_url || "").trim();
    return Boolean(/\/transcripts\//iu.test(transcriptUrl) && !json?.error);
  } catch {
    return false;
  }
}

function parseAgendaPostedFromResponse(respPath) {
  if (!respPath || !fs.existsSync(respPath)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(respPath, "utf8"));
    const agendaUrl = String(json?.agenda_url || "").trim();
    return Boolean(/\/agendas\//iu.test(agendaUrl) && !json?.error);
  } catch {
    return false;
  }
}

function localMeetingState(meetingDir, basePrefix) {
  const transcriptDir = path.join(meetingDir, "transcript");
  const publishPath = findPublishResponsePath(transcriptDir, basePrefix);
  const agendaPublishPath = findAgendaPublishResponsePath(transcriptDir, basePrefix);
  const payloadPath = findLemmyPayloadPath(transcriptDir, basePrefix);
  const payloadContentType = readPayloadContentType(payloadPath);
  const meetingPublishTranscriptPosted = parsePostedFromResponse(publishPath);
  const agendaPublishPosted = parseAgendaPostedFromResponse(agendaPublishPath);
  const transcriptPosted = meetingPublishTranscriptPosted;
  const agendaPosted = agendaPublishPosted || (!meetingPublishTranscriptPosted && payloadContentType === "agenda");
  const reportPath = findPipelineReportPath(transcriptDir, basePrefix);
  let stage = "new";
  if (transcriptPosted) stage = "transcript-published";
  else if (agendaPosted) stage = "agenda-published";
  else if (reportPath) stage = "pipeline-done";
  else if (fs.existsSync(path.join(transcriptDir, `${basePrefix}-normalized.sentences.speaker.sentence.srt`))) stage = "speaker-labeled";
  else if (fs.existsSync(path.join(transcriptDir, `${basePrefix}-normalized.sentences.merged.srt`))) stage = "transcribed";
  else if ([".opus", ".wav", ".mp3", ".m4a"].some((ext) => fs.existsSync(path.join(transcriptDir, `meeting-audio${ext}`)))) stage = "audio-ready";
  else if (fs.existsSync(path.join(meetingDir, "source")) || fs.existsSync(path.join(meetingDir, "converted"))) stage = "workspace-prepped";
  return { stage, transcriptDir, reportPath, publishPath };
}

function resolveMeetingSelector(meetingsDir, selector) {
  const sel = String(selector || "").trim();
  if (!sel) return "";
  const dirs = fs.existsSync(meetingsDir)
    ? fs.readdirSync(meetingsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  let i = 0;
  for (const base of dirs) {
    const dir = path.join(meetingsDir, base);
    const meetingJson = path.join(dir, "meeting.json");
    const pickJson = path.join(dir, "next-story.pick.json");
    let meetingId = "";
    let meetingUrl = "";
    if (fs.existsSync(meetingJson)) {
      try {
        const j = JSON.parse(fs.readFileSync(meetingJson, "utf8"));
        meetingId = String(j?.payload?.meeting_id || "");
        meetingUrl = String(j?.payload?.meeting_url || "");
      } catch {
        // ignore
      }
    }
    if ((!meetingId || !meetingUrl) && fs.existsSync(pickJson)) {
      try {
        const j = JSON.parse(fs.readFileSync(pickJson, "utf8"));
        meetingId = meetingId || String(j?.meeting_id || "");
        meetingUrl = meetingUrl || String(j?.meeting_url || "");
      } catch {
        // ignore
      }
    }
    const id8 = meetingId ? meetingId.slice(0, 8) : "";
    const baseTail = String(base).split("_").filter(Boolean).pop() || "";
    const inferred = /^[A-Za-z0-9_-]{8,}$/u.test(baseTail) ? baseTail : "";
    const ref = meetingUrl || meetingId || id8 || inferred || base;
    if (/^\d+$/u.test(sel) && i === Number(sel)) return ref;
    if (id8 && id8 === sel) return ref;
    if (meetingId && meetingId.startsWith(sel)) return ref;
    if (inferred && inferred.startsWith(sel)) return ref;
    if (base.includes(sel)) return ref;
    if (meetingId && meetingId === sel) return ref;
    if (meetingUrl && meetingUrl === sel) return meetingUrl;
  }
  return "";
}

async function loadAdapter(writerKey) {
  const w = WRITER_MAP[writerKey];
  if (!w) throw new Error(`unknown writer: ${writerKey}`);
  const mod = await import(pathToFileURL(w.adapterFile).href);
  const adapter = mod[w.adapterExport];
  if (!adapter) throw new Error(`writer adapter export missing: ${w.adapterExport}`);
  return { map: w, adapter };
}

function buildRuntimeEnv({ writerKey, map, adapter, args }) {
  const env = { ...process.env };
  const envPrefix = map.envPrefix;

  env.PYA_COMMAND_TIMEOUT_MS = env.PYA_COMMAND_TIMEOUT_MS || "28800000";

  const skipRefresh = args.refresh ? "0" : "1";
  env.NEXT_STORY_SKIP_REFRESH = skipRefresh;
  env[`${envPrefix}_SKIP_MONTHLY_REFRESH`] = skipRefresh;

  const pickOnly = args.pickOnly ? "1" : "0";
  env.NEXT_STORY_PICK_ONLY = pickOnly;
  env[`${envPrefix}_NEXT_STORY_PICK_ONLY`] = pickOnly;

  const diarizeOnly = args.diarizeOnly ? "1" : "0";
  env.NEXT_STORY_DIARIZE_ONLY = diarizeOnly;
  env[`${envPrefix}_NEXT_STORY_DIARIZE_ONLY`] = diarizeOnly;

  const normalizeStage = (s) => String(s || "").trim().toLowerCase();
  for (const st of args.force) {
    const stage = normalizeStage(st);
    if (stage === "prep") env[`${envPrefix}_PREP_FORCE`] = "1";
    if (stage === "full") env[`${envPrefix}_PIPELINE_FORCE`] = "1";
    if (stage === "image") env[`${envPrefix}_PIPELINE_SKIP_IMAGE`] = "0";
  }
  for (const st of args.skip) {
    const stage = normalizeStage(st);
    if (stage === "prep") env[`${envPrefix}_PIPELINE_SKIP_PREP`] = "1";
    if (stage === "full") env[`${envPrefix}_PIPELINE_SKIP_FULL`] = "1";
    if (stage === "image") env[`${envPrefix}_PIPELINE_SKIP_IMAGE`] = "1";
  }

  const envFiles = [
    path.join(adapter.house_root, ".env"),
    path.join(PYASH_ROOT, ".env"),
    path.join(PYASH_ROOT, "world/house/owen-sound-reporter/.env"),
  ];
  const secretFallback = loadSecretFallbacks(adapter.house_root);
  if (!env.MEETING_PUBLISH_AUTH_TOKEN) {
    for (const f of envFiles) {
      const parsed = readEnvFile(f);
      const token = String(parsed.MEETING_PUBLISH_AUTH_TOKEN || "").trim();
      if (token) {
        env.MEETING_PUBLISH_AUTH_TOKEN = token;
        break;
      }
    }
    if (!env.MEETING_PUBLISH_AUTH_TOKEN) {
      const token = String(secretFallback["meeting publish auth token"] || "").trim();
      if (token) env.MEETING_PUBLISH_AUTH_TOKEN = token;
    }
  }

  env.MEETING_PUBLISH_COMMUNITY_NAME =
    env.MEETING_PUBLISH_COMMUNITY_NAME
    || env[`${envPrefix}_COMMUNITY_NAME`]
    || String(secretFallback["meeting publish community name"] || "").trim()
    || adapter.publish?.community_name
    || map.defaultCommunity;
  env.MEETING_PUBLISH_SITE_URL =
    env.MEETING_PUBLISH_SITE_URL
    || String(secretFallback["meeting publish site url"] || "").trim()
    || env.MEETING_PUBLISH_SITE_URL;

  if (writerKey === "grey") {
    env.GREY_COUNTY_REPORTER_USERNAME =
      env.GREY_COUNTY_REPORTER_USERNAME
      || String(secretFallback["grey county reporter username"] || "").trim()
      || env.GREY_COUNTY_REPORTER_USERNAME;
    env.GREY_COUNTY_REPORTER_PASSWORD =
      env.GREY_COUNTY_REPORTER_PASSWORD
      || String(secretFallback["grey county reporter password"] || "").trim()
      || env.GREY_COUNTY_REPORTER_PASSWORD;
  }
  if (writerKey === "owen") {
    env.OWEN_SOUND_REPORTER_USERNAME =
      env.OWEN_SOUND_REPORTER_USERNAME
      || String(secretFallback["owen sound reporter username"] || "").trim()
      || env.OWEN_SOUND_REPORTER_USERNAME;
    env.OWEN_SOUND_REPORTER_PASSWORD =
      env.OWEN_SOUND_REPORTER_PASSWORD
      || String(secretFallback["owen sound reporter password"] || "").trim()
      || env.OWEN_SOUND_REPORTER_PASSWORD;
  }

  const allowPost = args.post === true;
  const forceNoPost = args.post === false || args.dryRun;
  if (allowPost) {
    env[`${envPrefix}_AUTOPUBLISH`] = "1";
    env.PIPELINE_SKIP_POST = "0";
    env.PIPELINE_FORCE_POST = "1";
    env[`${envPrefix}_PIPELINE_FORCE_POST`] = "1";
    const envCmdKey = `${envPrefix}_LEMMY_POST_COMMAND`;
    const fallback = `node ${map.publishScript}`;
    env[envCmdKey] = env[envCmdKey] || fallback;
    env.MEETING_POST_COMMAND = env.MEETING_POST_COMMAND || env[envCmdKey];
  } else if (forceNoPost) {
    env[`${envPrefix}_AUTOPUBLISH`] = "0";
    env.PIPELINE_SKIP_POST = "1";
  }
  if (args.dryRun) env.MEETING_PUBLISH_DRY_RUN = "1";
  if (args.postRef) {
    env.MEETING_PUBLISH_POST_REF = args.postRef;
    env.AGENDA_PUBLISH_POST_REF = args.postRef;
  }

  return env;
}

function printMeetingList(adapter) {
  const meetingsDir = path.join(adapter.house_root, "artifacts", adapter.artifacts_slug, "meetings");
  const basePrefix = adapter.defaults?.base_prefix || "meeting-qwen-auto";
  let youtubeKnownIds = null;
  let youtubeKnownId8 = null;
  if (String(adapter?.source_id || "") === "youtube-live") {
    const rows = loadAllMeetings(path.join(adapter.house_root, "artifacts", adapter.artifacts_slug, "monthly"));
    youtubeKnownIds = new Set(
      rows
        .map((r) => String(r?.payload?.meeting_id || "").trim())
        .filter((id) => /^[A-Za-z0-9_-]{11}$/u.test(id)),
    );
    youtubeKnownId8 = new Set(Array.from(youtubeKnownIds).map((id) => id.slice(0, 8)));
  }
  if (!fs.existsSync(meetingsDir)) {
    process.stdout.write(`No meetings directory: ${meetingsDir}\n`);
    return;
  }
  const dirs = fs.readdirSync(meetingsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  let i = 0;
  for (const base of dirs) {
    const dir = path.join(meetingsDir, base);
    const state = localMeetingState(dir, basePrefix);
    const meetingJson = path.join(dir, "meeting.json");
    let ref = base;
    let meetingId = "";
    let sourceId = "";
    if (fs.existsSync(meetingJson)) {
      try {
        const j = JSON.parse(fs.readFileSync(meetingJson, "utf8"));
        const id = String(j?.payload?.meeting_id || "");
        const url = String(j?.payload?.meeting_url || "");
        sourceId = String(j?.payload?.source || "");
        meetingId = id;
        ref = (id && id.slice(0, 8)) || url || ref;
      } catch {
        // ignore
      }
    }
    if (String(adapter?.source_id || "") === "youtube-live") {
      if (sourceId === "youtube-live" && meetingId && !/^[A-Za-z0-9_-]{11}$/u.test(meetingId)) continue;
      if (!meetingId) {
        const tail = String(base).split("_").filter(Boolean).pop() || "";
        if (tail && !/^[A-Za-z0-9_-]{11}$/u.test(tail)) continue;
      }
      const tail8 = String(base).split("_").filter(Boolean).pop() || "";
      const id = String(meetingId || "").trim();
      const id8 = id ? id.slice(0, 8) : "";
      const inKnown = (youtubeKnownIds && id && youtubeKnownIds.has(id))
        || (youtubeKnownId8 && id8 && youtubeKnownId8.has(id8))
        || (youtubeKnownId8 && tail8 && youtubeKnownId8.has(tail8));
      if (!inKnown) continue;
    }
    i += 1;
    process.stdout.write(`${String(i).padStart(3, " ")}  ${base.padEnd(40, " ")}  ${state.stage.padEnd(14, " ")}  ${ref}\n`);
  }
}

function printInspect(adapter, selector) {
  const meetingsDir = path.join(adapter.house_root, "artifacts", adapter.artifacts_slug, "meetings");
  const basePrefix = adapter.defaults?.base_prefix || "meeting-qwen-auto";
  const ref = resolveMeetingSelector(meetingsDir, selector);
  if (!ref) throw new Error(`no meeting matched selector: ${selector}`);

  const rows = loadAllMeetings(path.join(adapter.house_root, "artifacts", adapter.artifacts_slug, "monthly"));
  const row = rows.find((r) => {
    const id = String(r?.payload?.meeting_id || "").toLowerCase();
    const id8 = id.slice(0, 8);
    const url = String(r?.payload?.meeting_url || "").toLowerCase();
    const want = String(ref || "").toLowerCase();
    return want === id || want === id8 || want === url;
  });

  let meetingDir = "";
  if (row) meetingDir = path.join(meetingsDir, inferFolder(row));
  if (!meetingDir || !fs.existsSync(meetingDir)) {
    const dirs = fs.readdirSync(meetingsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const byFrag = dirs.find((d) => d.includes(String(selector || "")));
    if (byFrag) meetingDir = path.join(meetingsDir, byFrag);
  }
  if (!meetingDir || !fs.existsSync(meetingDir)) throw new Error(`meeting workspace not found for selector: ${selector}`);

  const state = localMeetingState(meetingDir, basePrefix);
  process.stdout.write(`writer: ${adapter.writer_id}\n`);
  process.stdout.write(`meeting_ref: ${ref}\n`);
  process.stdout.write(`meeting_dir: ${meetingDir}\n`);
  process.stdout.write(`transcript_dir: ${state.transcriptDir}\n`);
  process.stdout.write(`stage: ${state.stage}\n`);
  process.stdout.write(`run_report: ${state.reportPath || ""}\n`);
  process.stdout.write(`publish_response: ${state.publishPath || ""}\n`);
}

async function runMain() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.writer) throw new Error("--writer is required");
  const { map, adapter } = await loadAdapter(args.writer);
  const env = buildRuntimeEnv({ writerKey: args.writer, map, adapter, args });

  process.stdout.write(`[operator] writer=${adapter.writer_id} source=${adapter.source_id}\n`);
  process.stdout.write(`[operator] command=${args.command} meeting=${args.meeting || "(auto)"} post=${args.post === true ? "on" : args.post === false ? "off" : "default"} dry_run=${args.dryRun ? "on" : "off"}\n`);

  if (args.command === "list") {
    printMeetingList(adapter);
    return;
  }

  if (args.command === "inspect") {
    if (!args.meeting) throw new Error("inspect requires --meeting");
    printInspect(adapter, args.meeting);
    return;
  }

  if (args.command === "next") {
    await runWithStreaming({
      cmd: "node",
      args: [map.nextStoryScript],
      cwd: adapter.house_root,
      env,
      label: "next",
    });
    return;
  }

  const meetingsDir = path.join(adapter.house_root, "artifacts", adapter.artifacts_slug, "meetings");
  const meetingRef = resolveMeetingSelector(meetingsDir, args.meeting);
  if (!meetingRef) throw new Error(`no meeting matched selector: ${args.meeting}`);

  if (args.command === "verify") {
    env[`${map.envPrefix}_PIPELINE_SKIP_PREP`] = "1";
    env[`${map.envPrefix}_PIPELINE_SKIP_IMAGE`] = "1";
    env.PIPELINE_SKIP_POST = "1";
  }

  if (args.command === "publish") {
    env[`${map.envPrefix}_PIPELINE_SKIP_PREP`] = "1";
    env[`${map.envPrefix}_PIPELINE_SKIP_IMAGE`] = "1";
    env.PIPELINE_SKIP_POST = args.dryRun ? "1" : "0";
    if (!args.dryRun) {
      env.PIPELINE_FORCE_POST = "1";
      env[`${map.envPrefix}_PIPELINE_FORCE_POST`] = "1";
      env[`${map.envPrefix}_AUTOPUBLISH`] = "1";
      const envCmdKey = `${map.envPrefix}_LEMMY_POST_COMMAND`;
      env[envCmdKey] = env[envCmdKey] || `node ${map.publishScript}`;
      env.MEETING_POST_COMMAND = env.MEETING_POST_COMMAND || env[envCmdKey];
    }
  }

  if (args.command === "rerun-stage") {
    const stage = String(args.stage || "").toLowerCase();
    if (!stage) throw new Error("rerun-stage requires --stage");
    if (stage === "prep") {
      env[`${map.envPrefix}_PREP_FORCE`] = "1";
      env[`${map.envPrefix}_PIPELINE_SKIP_FULL`] = "1";
    } else if (stage === "full") {
      env[`${map.envPrefix}_PIPELINE_FORCE`] = "1";
      env[`${map.envPrefix}_PIPELINE_SKIP_PREP`] = "1";
    } else if (stage === "image") {
      env[`${map.envPrefix}_PIPELINE_SKIP_PREP`] = "1";
      env[`${map.envPrefix}_PIPELINE_SKIP_IMAGE`] = "0";
    } else if (stage === "verify") {
      env[`${map.envPrefix}_PIPELINE_SKIP_PREP`] = "1";
      env[`${map.envPrefix}_PIPELINE_SKIP_IMAGE`] = "1";
      env.PIPELINE_SKIP_POST = "1";
    } else if (stage === "publish") {
      env[`${map.envPrefix}_PIPELINE_SKIP_PREP`] = "1";
      env[`${map.envPrefix}_PIPELINE_SKIP_IMAGE`] = "1";
      env.PIPELINE_SKIP_POST = args.dryRun ? "1" : "0";
      if (!args.dryRun) {
        env.PIPELINE_FORCE_POST = "1";
        env[`${map.envPrefix}_PIPELINE_FORCE_POST`] = "1";
        env[`${map.envPrefix}_AUTOPUBLISH`] = "1";
        const envCmdKey = `${map.envPrefix}_LEMMY_POST_COMMAND`;
        env[envCmdKey] = env[envCmdKey] || `node ${map.publishScript}`;
        env.MEETING_POST_COMMAND = env.MEETING_POST_COMMAND || env[envCmdKey];
      }
    } else {
      throw new Error(`unsupported stage: ${stage}`);
    }
  }

  if (!["run", "rerun-stage", "verify", "publish"].includes(args.command)) {
    throw new Error(`unsupported command: ${args.command}`);
  }

  const runnerCmd = Array.isArray(adapter.run_meeting_from_ref_cmd) ? adapter.run_meeting_from_ref_cmd : [];
  if (!runnerCmd.length) throw new Error("writer adapter missing run_meeting_from_ref_cmd");

  await runWithStreaming({
    cmd: runnerCmd[0],
    args: [...runnerCmd.slice(1), meetingRef],
    cwd: adapter.house_root,
    env,
    label: `${args.command}-meeting`,
  });
}

runMain().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
