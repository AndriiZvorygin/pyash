import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig, readFlagValue } from "./run_pya_helpers.mjs";
import { resolveAgentHouse, ensureAgentDirs } from "../program/agent/session.mjs";
import { createScheduler, loadSchedulePolicyWithGlobal } from "../program/agent/scheduler.mjs";
import { resolveWorldRoot } from "../program/library/world.mjs";
import { worldNewspaperLogPath } from "../program/agent/newspaper_log.mjs";

const HEARTBEAT_JOB_NAME = "heartbeat";
const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";
const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your agent house.
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: ${HEARTBEAT_OK_TOKEN}`;

function isHeartbeatEmpty(content) {
  if (!content) return true;
  const skipPatterns = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("<!--")) continue;
    if (skipPatterns.has(line)) continue;
    return false;
  }
  return true;
}

function normalizeOk(text) {
  return String(text ?? "").toUpperCase().replace(/[_\s]+/g, "");
}

function sanitizeName(raw, fallback = "value") {
  const text = String(raw ?? "").trim().toLowerCase();
  const cleaned = text.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function buildCallSentence({ job, prompt, outName }) {
  const sentence = {
    mood: "do",
    be: "write",
    ob: { text: prompt },
    for: { name: job.agentName },
    to: { name: outName },
    fromtext: { name: `session name ${job.laneName}` },
    with: job.withCase ?? { wo: "tools" }
  };
  return sentence;
}

async function runScheduledMindJob({ job, heartbeatPath }) {
  const isHeartbeat = job.jobName === HEARTBEAT_JOB_NAME;
  let prompt = job.prompt;
  if (isHeartbeat) {
    let content = "";
    try {
      content = await fs.readFile(heartbeatPath, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") return { status: "skipped", reason: "missing_heartbeat" };
      throw err;
    }
    if (isHeartbeatEmpty(content)) return { status: "skipped", reason: "empty_heartbeat" };
    prompt = HEARTBEAT_PROMPT;
  }
  if (!prompt || !prompt.trim()) return { status: "skipped", reason: "empty_prompt" };

  const outName = `${sanitizeName(job.jobName, "job")}_out`;
  const sentence = buildCallSentence({ job, prompt, outName });
  const result = await interpret(sentence);
  const responseText = result?.ob?.text ?? "";
  if (isHeartbeat) {
    const ok = normalizeOk(responseText).includes(normalizeOk(HEARTBEAT_OK_TOKEN));
    return { status: ok ? "heartbeat_ok" : "heartbeat_done", responseText };
  }
  return { status: "ok", responseText };
}

async function initializeRuntime({ cwd, agentName }) {
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) {
    registerSignatureHandler(sig);
  }
  await loadDefaultConfig({ cwd, interpretFn: interpret, entryPath: cwd });
  if (!remember(agentName)) {
    await interpret(parse(`exists su name ${agentName} be mind ya`));
  }
}

function usage() {
  return "Usage: node command/heartbeat.mjs --agent <name> [--once] [--job <job-name>]";
}

async function main() {
  const args = process.argv.slice(2);
  const agentName = readFlagValue(args, "--agent") ?? readFlagValue(args, "-a");
  if (!agentName) {
    console.error(usage());
    process.exit(1);
  }
  const once = args.includes("--once");
  const jobFilter = readFlagValue(args, "--job");

  await initializeRuntime({ cwd: process.cwd(), agentName });
  const worldRoot = resolveWorldRoot({ rememberFn: remember }) ?? path.resolve(process.cwd(), "world");
  const agentHouse = resolveAgentHouse({ mindName: agentName, rememberFn: null });
  await ensureAgentDirs(agentHouse);
  const heartbeatPath = path.join(agentHouse, "HEARTBEAT.md");
  const telemetryPath = worldNewspaperLogPath({ worldRoot, name: "calendar" });

  let jobs = await loadSchedulePolicyWithGlobal({ worldRoot, agentHouse, agentName });
  if (!jobs.length) {
    console.error(`no calendar jobs configured for ${agentName}`);
    process.exit(1);
  }
  if (jobFilter) {
    jobs = jobs.filter(job => job.jobName === jobFilter);
    if (!jobs.length) {
      console.error(`Unknown job: ${jobFilter}`);
      process.exit(1);
    }
  }

  const scheduler = createScheduler({
    jobs,
    telemetryPath,
    runJob: async (job) => runScheduledMindJob({ job, heartbeatPath }),
    onError: (err) => {
      console.error(`[scheduler error] ${String(err?.message ?? err)}`);
    }
  });

  if (once) {
    const results = await scheduler.runNow({ jobName: jobFilter ?? null });
    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      const result = results[i];
      if (result?.skipped) {
        console.log(`${job.jobName}: skipped (${result.reason})`);
      } else if (result?.result?.status) {
        console.log(`${job.jobName}: ${result.result.status}`);
      } else if (result?.error) {
        console.log(`${job.jobName}: error`);
      } else {
        console.log(`${job.jobName}: completed`);
      }
    }
    await scheduler.flushTelemetry();
    return;
  }

  console.log(`scheduler running for ${agentName} (${jobs.length} job(s))`);
  for (const job of jobs) {
    const minutes = (job.intervalMs / 60000).toFixed(2);
    console.log(`job ${job.jobName}: every ${minutes} minute(s), lane=${job.laneName}`);
  }
  await scheduler.runNow({ jobName: jobFilter ?? null });
  scheduler.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
