#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GREY_ADAPTER } from "./writer-adapter-grey-county.mjs";
import { buildRunNextConfig } from "./shared/writer-adapter-interface.mjs";
import { applyPublishEnvNormalization } from "../../../../program/publisher-interface.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE_ROOT = path.resolve(PROGRAM_DIR, "..");
const PYASH_ROOT = path.resolve(PROGRAM_DIR, "../../../..");

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
  const basePrefix = process.argv[2] || GREY_ADAPTER.defaults.base_prefix;
  const focus = process.argv[3] || GREY_ADAPTER.defaults.focus;
  const jurisdiction = process.argv[4] || GREY_ADAPTER.defaults.jurisdiction;
  const body = process.argv[5] || GREY_ADAPTER.defaults.body;
  const siteUrl = process.argv[6] || GREY_ADAPTER.defaults.site_url;
  const discussionUrl = process.argv[7] || GREY_ADAPTER.defaults.discussion_url;
  const execMxid = process.argv[8] || process.env.GREY_EXEC_MXID || GREY_ADAPTER.defaults.exec_mxid;

  const sendDmPath = path.join(PROGRAM_DIR, "send-executive-dm.mjs");
  const sendDmCmd = fs.existsSync(sendDmPath) ? ["node", sendDmPath] : [];

  const cfg = buildRunNextConfig(GREY_ADAPTER, {
    basePrefix,
    focus,
    jurisdiction,
    body,
    siteUrl,
    discussionUrl,
    execMxid,
    timezone: process.env.GREY_TIMEZONE || GREY_ADAPTER.defaults.timezone,
    extra: {
      send_dm_cmd: sendDmCmd,
      community_name: process.env.MEETING_PUBLISH_COMMUNITY_NAME || process.env.GREY_COMMUNITY_NAME || GREY_ADAPTER.defaults.community_name,
      require_upcoming_supporting_docs: process.env.GREY_REQUIRE_UPCOMING_SUPPORTING_DOCS || "0",
    },
  });

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
    const normalized = applyPublishEnvNormalization({
      env,
      adapter: GREY_ADAPTER,
      fallbackCommand: `node ${path.join(PROGRAM_DIR, "publish-meeting-to-helpos-from-payload.mjs")}`,
    });
    Object.assign(env, normalized.env);
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
