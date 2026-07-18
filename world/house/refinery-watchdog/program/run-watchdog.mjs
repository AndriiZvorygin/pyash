#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_ROOT,
  PIPELINE_LOCK,
  PYASH_ROOT,
  REPORTERS,
  WATCHDOG_LOCK,
  buildCodexExecArgs,
  buildCodexPrompt,
  ensureDir,
  isLockHeld,
  probeReporter,
  readRecoveryState,
  reexecWithLock,
  resolveCodexBin,
  runId,
  runProcess,
  sendMatrixAlert,
  shouldLaunchRecovery,
  torontoParts,
  writeJson,
  writePyaStatus,
  writeRecoveryState,
} from "./watchdog-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const reexecStatus = reexecWithLock({
  lockPath: WATCHDOG_LOCK,
  marker: "REFINERY_WATCHDOG_LOCK_HELD",
  scriptPath,
});
if (reexecStatus !== null) {
  if (reexecStatus === 75) process.stdout.write("[refinery-watchdog] another watchdog run is active; exiting\n");
  process.exit(reexecStatus === 75 ? 0 : reexecStatus);
}

const started = new Date();
const checkpoint = process.env.REFINERY_WATCHDOG_CHECKPOINT || (torontoParts(started).hour === 6 ? "0600" : "0500");
const day = torontoParts(started).day;
const id = runId(`checkpoint-${checkpoint}`, started);
const artifactDir = ensureDir(path.join(ARTIFACT_ROOT, "watchdog", day, id));
const incidentPath = path.join(artifactDir, "incident.json");
const recoveryStateDir = ensureDir(path.join(ARTIFACT_ROOT, "state"));
const recoveryStatePath = path.join(recoveryStateDir, `${day}.recovery.pya`);
const logPath = path.join(artifactDir, "watchdog.log");
const baseStatus = {
  run_id: id,
  status: "checking",
  artifact_dir: artifactDir,
  started_at_utc: started.toISOString(),
  checkpoint,
};
writeJson(path.join(artifactDir, "status.json"), baseStatus);
writePyaStatus(path.join(artifactDir, "status.pya"), baseStatus);

const recoveryState = readRecoveryState(recoveryStatePath);

const sharedActive = isLockHeld(PIPELINE_LOCK);
const reporterResults = [];
for (const reporter of Object.values(REPORTERS)) {
  if (sharedActive || isLockHeld(reporter.lock)) {
    reporterResults.push({
      reporter: reporter.key,
      label: reporter.label,
      state: "active",
      needs_repair: false,
      reason: sharedActive ? "shared municipal reporter pipeline lock is held" : "reporter nightly lock is held",
    });
    continue;
  }
  try {
    reporterResults.push(await probeReporter(reporter, {
      refresh: true,
      logPath,
      stream: true,
    }));
  } catch (error) {
    reporterResults.push({
      reporter: reporter.key,
      label: reporter.label,
      state: "probe_error",
      needs_repair: true,
      reason: String(error?.stack || error?.message || error),
    });
  }
}

const active = reporterResults.filter((item) => item.state === "active");
const failures = reporterResults.filter((item) => item.needs_repair);
const incident = {
  run_id: id,
  checkpoint,
  checked_at_utc: new Date().toISOString(),
  shared_pipeline_active: sharedActive,
  reporters: reporterResults,
  failures: failures.map((item) => item.reporter),
  active: active.map((item) => item.reporter),
  recovery_already_launched: Boolean(recoveryState?.launched_at_utc),
  artifact_dir: artifactDir,
};
writeJson(incidentPath, incident);

if (active.length) {
  const final = {
    ...baseStatus,
    status: "deferred_active",
    reason: `active reporters: ${active.map((item) => item.reporter).join(", ")}`,
    finished_at_utc: new Date().toISOString(),
  };
  writeJson(path.join(artifactDir, "status.json"), final);
  writePyaStatus(path.join(artifactDir, "status.pya"), final);
  if (checkpoint === "0600") {
    await sendMatrixAlert(`[refinery-watchdog] Still running at the 6:00 check; no repair was started to avoid overlapping GPU work. Active: ${active.map((item) => item.label).join(", ")}. Evidence: ${artifactDir}`);
  }
  process.exit(0);
}

if (!failures.length) {
  const final = {
    ...baseStatus,
    status: "healthy",
    reason: "all reporters have no eligible unpublished candidate",
    finished_at_utc: new Date().toISOString(),
  };
  writeJson(path.join(artifactDir, "status.json"), final);
  writePyaStatus(path.join(artifactDir, "status.pya"), final);
  process.stdout.write(`[refinery-watchdog] healthy artifact=${artifactDir}\n`);
  process.exit(0);
}

if (!shouldLaunchRecovery({ failures, active: false, alreadyLaunched: Boolean(recoveryState?.launched_at_utc) })) {
  const final = {
    ...baseStatus,
    status: "unresolved_deduplicated",
    reason: `recovery already launched for ${day}`,
    finished_at_utc: new Date().toISOString(),
  };
  writeJson(path.join(artifactDir, "status.json"), final);
  writePyaStatus(path.join(artifactDir, "status.pya"), final);
  if (checkpoint === "0600") {
    await sendMatrixAlert(`[refinery-watchdog] Unpublished work remains after today's recovery attempt: ${failures.map((item) => item.label).join(", ")}. Evidence: ${artifactDir}`);
  }
  process.exit(1);
}

const promptPath = path.join(artifactDir, "codex-prompt.txt");
const prompt = buildCodexPrompt({ incidentPath, reporters: failures, artifactDir });
fs.writeFileSync(promptPath, `${prompt}\n`, "utf8");
const codexFinalPath = path.join(artifactDir, "codex-final.json");
const codexLogPath = path.join(artifactDir, "codex.log");
const launchedState = {
  day,
  run_id: id,
  launched_at_utc: new Date().toISOString(),
  reporters: failures.map((item) => item.reporter),
  artifact_dir: artifactDir,
  status: "running",
};
writeRecoveryState(recoveryStatePath, launchedState);
await sendMatrixAlert(`[refinery-watchdog] Starting Codex recovery for ${failures.map((item) => item.label).join(", ")}. Evidence: ${artifactDir}`);

const codex = await runProcess({
  cmd: resolveCodexBin(),
  args: buildCodexExecArgs({
    prompt,
    schemaPath: path.join(path.dirname(scriptPath), "codex-result.schema.json"),
    outputPath: codexFinalPath,
  }),
  cwd: PYASH_ROOT,
  timeoutMs: 10 * 60 * 60 * 1000,
  logPath: codexLogPath,
  stream: true,
});

let codexResult = null;
try {
  codexResult = JSON.parse(fs.readFileSync(codexFinalPath, "utf8"));
} catch {
  codexResult = null;
}

const verification = [];
if (codex.code === 0 && codexResult?.status === "fixed") {
  for (const failed of failures) {
    verification.push(await probeReporter(REPORTERS[failed.reporter], { refresh: true, logPath, stream: true }));
  }
}
const remaining = verification.filter((item) => item.needs_repair || item.state === "active");
const fixed = codex.code === 0 && codexResult?.status === "fixed" && verification.length === failures.length && remaining.length === 0;
const status = fixed ? "fixed" : (codexResult?.status === "needs_human" ? "needs_human" : (codex.timedOut ? "timed_out" : "failed"));
const final = {
  ...baseStatus,
  status,
  reason: fixed ? "Codex recovery completed and independent candidate probes passed" : "Codex recovery did not produce independently verified healthy state",
  codex_exit_code: codex.code,
  codex_result: codexResult,
  verification,
  finished_at_utc: new Date().toISOString(),
};
writeJson(path.join(artifactDir, "status.json"), final);
writePyaStatus(path.join(artifactDir, "status.pya"), final);
writeRecoveryState(recoveryStatePath, { ...launchedState, status, finished_at_utc: final.finished_at_utc });

if (fixed) {
  await sendMatrixAlert(`[refinery-watchdog] Recovery verified for ${failures.map((item) => item.label).join(", ")}. Publications: ${(codexResult.publication_urls || []).join(", ") || "verified remotely"}. Evidence: ${artifactDir}`);
} else {
  await sendMatrixAlert(`[refinery-watchdog] Recovery requires attention. Status: ${status}. Reporters: ${failures.map((item) => item.label).join(", ")}. Evidence: ${artifactDir}`);
}
process.exit(fixed ? 0 : 1);
