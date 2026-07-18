#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_ROOT,
  PYASH_ROOT,
  REPORTERS,
  ensureDir,
  reexecWithLock,
  runId,
  runProcess,
  torontoParts,
  writeJson,
  writePyaStatus,
} from "./watchdog-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const key = String(process.argv[2] || "").trim().toLowerCase();
const reporter = REPORTERS[key];
if (!reporter) {
  process.stderr.write("usage: run-nightly-refinery.mjs <andrii|owen|grey>\n");
  process.exit(2);
}

const marker = `REFINERY_NIGHTLY_LOCK_${key.toUpperCase()}`;
const reexecStatus = reexecWithLock({ lockPath: reporter.lock, marker, scriptPath });
if (reexecStatus !== null) {
  if (reexecStatus === 75) process.stderr.write(`[refinery-watchdog] ${key} nightly run skipped because its lock is held\n`);
  process.exit(reexecStatus);
}

const started = new Date();
const id = runId(`nightly-${key}`, started);
const day = torontoParts(started).day;
const artifactDir = ensureDir(path.join(ARTIFACT_ROOT, "nightly", day, id));
const logPath = path.join(artifactDir, "run.log");
const base = {
  run_id: id,
  reporter: key,
  artifact_dir: artifactDir,
  started_at_utc: started.toISOString(),
};
writeJson(path.join(artifactDir, "status.json"), { ...base, status: "running" });
writePyaStatus(path.join(artifactDir, "status.pya"), { ...base, status: "running" });

const result = await runProcess({
  cmd: reporter.runScript,
  args: ["--refresh"],
  cwd: reporter.house,
  timeoutMs: 10 * 60 * 60 * 1000,
  logPath,
  stream: true,
});
const text = `${result.stdout}\n${result.stderr}`;
const status = result.code === 0
  ? (/no unposted candidate found/iu.test(text) ? "healthy_no_candidate" : "completed")
  : (result.timedOut ? "timed_out" : "failed");
const final = {
  ...base,
  status,
  reason: result.code === 0 ? "nightly reporter command completed" : `nightly reporter command exited ${result.code}`,
  exit_code: result.code,
  signal: result.signal,
  finished_at_utc: new Date().toISOString(),
};
writeJson(path.join(artifactDir, "status.json"), final);
writePyaStatus(path.join(artifactDir, "status.pya"), final);
fs.writeFileSync(path.join(ARTIFACT_ROOT, `latest-${key}.txt`), `${artifactDir}\n`, "utf8");
process.stdout.write(`[refinery-watchdog] ${key} status=${status} artifact=${artifactDir}\n`);
process.exit(result.code);
