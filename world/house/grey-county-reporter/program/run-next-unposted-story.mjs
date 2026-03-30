#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUMMARY_FOCUS } from "./defaults.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE_ROOT = path.resolve(PROGRAM_DIR, "..");
const PYASH_ROOT = path.resolve(PROGRAM_DIR, "../../../..");

const DEFAULTS = {
  base_prefix: "meeting-qwen-auto",
  focus: DEFAULT_SUMMARY_FOCUS,
  jurisdiction: "Grey County",
  body: "auto",
  site_url: "https://helpos.ca",
  discussion_url: "",
  exec_mxid: "@andrii:matrix.liberit.ca",
  community_name: "grey-county-council",
  timezone: "America/Toronto",
};

function runWithStreaming({ cmd, args, cwd, env = {}, timeoutMs = 8 * 60 * 60 * 1000, label = "stage" }) {
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

async function main() {
  const basePrefix = process.argv[2] || DEFAULTS.base_prefix;
  const focus = process.argv[3] || DEFAULTS.focus;
  const jurisdiction = process.argv[4] || DEFAULTS.jurisdiction;
  const body = process.argv[5] || DEFAULTS.body;
  const siteUrl = process.argv[6] || DEFAULTS.site_url;
  const discussionUrl = process.argv[7] || DEFAULTS.discussion_url;
  const execMxid = process.argv[8] || process.env.GREY_EXEC_MXID || DEFAULTS.exec_mxid;

  const sendDmPath = path.join(PROGRAM_DIR, "send-executive-dm.mjs");
  const sendDmCmd = fs.existsSync(sendDmPath) ? ["node", sendDmPath] : [];

  const cfg = {
    house_root: HOUSE_ROOT,
    monthly_dir: path.join(HOUSE_ROOT, "artifacts/grey-county/monthly"),
    meetings_dir: path.join(HOUSE_ROOT, "artifacts/grey-county/meetings"),
    refresh_calendar_cmd: ["node", path.join(PROGRAM_DIR, "extract-grey-county-calendar-monthly.mjs")],
    run_meeting_from_ref_cmd: ["node", path.join(PROGRAM_DIR, "run-grey-county-meeting-from-ref.mjs")],
    send_dm_cmd: sendDmCmd,
    base_prefix: basePrefix,
    focus,
    jurisdiction,
    body,
    site_url: siteUrl,
    discussion_url: discussionUrl,
    exec_mxid: execMxid,
    community_name: process.env.MEETING_PUBLISH_COMMUNITY_NAME || process.env.GREY_COMMUNITY_NAME || DEFAULTS.community_name,
    timezone: process.env.GREY_TIMEZONE || DEFAULTS.timezone,
    require_upcoming_supporting_docs: process.env.GREY_REQUIRE_UPCOMING_SUPPORTING_DOCS || "0",
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grey-next-story-"));
  const cfgPath = path.join(tempDir, "config.json");
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");

  const env = { ...process.env };
  const allowAutopublish = /^(1|true|yes)$/iu.test(String(env.GREY_AUTOPUBLISH || ""));
  if (!allowAutopublish) {
    env.PIPELINE_SKIP_POST = "1";
    delete env.GREY_LEMMY_POST_COMMAND;
    delete env.MEETING_POST_COMMAND;
  } else {
    env.PIPELINE_SKIP_POST = "0";
    if (!String(env.GREY_LEMMY_POST_COMMAND || "").trim()) {
      env.GREY_LEMMY_POST_COMMAND = `node ${path.join(PROGRAM_DIR, "publish-meeting-to-helpos-from-payload.mjs")}`;
    }
    if (!String(env.MEETING_POST_COMMAND || "").trim() && String(env.GREY_LEMMY_POST_COMMAND || "").trim()) {
      env.MEETING_POST_COMMAND = env.GREY_LEMMY_POST_COMMAND;
    }
  }

  await runWithStreaming({
    cmd: "node",
    args: [path.join(PYASH_ROOT, "command/run_next_unposted_story.mjs"), cfgPath],
    cwd: PYASH_ROOT,
    env,
    timeoutMs: 8 * 60 * 60 * 1000,
    label: "run-next-unposted-story",
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
