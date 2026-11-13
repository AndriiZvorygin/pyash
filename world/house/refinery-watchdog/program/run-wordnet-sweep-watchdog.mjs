#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "../../../../program/library/pya_config.mjs";
import { createQueuedOllamaExecutor } from "../../../../program/runtime/criterion/ollama.mjs";
import { resolveConfiguredGpuHousekeeperUrl } from "../../../../program/runtime/gpu/configured-endpoints.mjs";
import { createGpuHousekeeperAdapter } from "../../../../program/runtime/gpu/housekeeper_adapter.mjs";
import {
  buildSweepPostRestartReviewIdentity,
  buildSweepPostRestartReviewPrompt,
  buildSweepRecoveryPrompt,
  buildSweepResumeCommand,
  mayResumeSweep,
  mayReviewRestartedSweep,
  isPostRestartReviewPending,
  parseSweepPostRestartReview,
  parseSweepRecoveryDecision,
  readSweepRecoveryConfig,
} from "./wordnet-sweep-recovery.mjs";
import { parse } from "../../../../program/understand/index.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOUSE_ROOT = path.resolve(PROGRAM_DIR, "..");
const PYASH_ROOT = path.resolve(HOUSE_ROOT, "../../..");
const ARTIFACT_ROOT = path.join(HOUSE_ROOT, "artifacts", "wordnet-sweep-watchdog");
const CONTEXT_PATH = path.join(HOUSE_ROOT, "conduct", "wordnet-sweep-recovery.pya");
const SWEEP_RUN_ID = String(readPyaTextValues(CONTEXT_PATH, ["WordNet sweep run id"])["WordNet sweep run id"] || "").trim();
if (!SWEEP_RUN_ID) throw new Error(`WordNet sweep run id is missing from ${CONTEXT_PATH}`);
const SWEEP_ROOT = path.join(PYASH_ROOT, "artifacts", SWEEP_RUN_ID);
const SWEEP_LOCK = path.join(PYASH_ROOT, "artifacts", ".wordnet-sense-compound-refinery.lock");
const WATCHDOG_LOCK = "/tmp/wordnet-sense-compound-watchdog.lock";
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;
const RECOVERY_TIMEOUT_MS = 3 * 60 * 1000;
const ACTIVITY_FILES = [
  "progress.pya",
  "worklist.pya",
  "sense-compound-decisions.pya",
  "sense-translations.pya",
  "translation-failures.pya",
  "component-compositions.pya",
  "component-mappings.pya",
  "compound-candidates.pya",
  "sweep-supervised.log",
];
function readLinuxProcess(pid) {
  try {
    const command = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    const cwd = fs.realpathSync(`/proc/${pid}/cwd`);
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const processState = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/u)[0] || "";
    return { alive: processState !== "Z" && processState !== "X", command, cwd, processState };
  } catch (error) {
    return { alive: error?.code !== "ENOENT" && error?.code !== "ESRCH", command: [], cwd: "" };
  }
}

function processMatchesSweep(processInfo, root) {
  if (!processInfo?.alive || path.resolve(processInfo.cwd || "") !== path.resolve(root)) return false;
  return (processInfo.command || []).some((part, index, all) => {
    const value = String(part || "");
    if (value.endsWith("command/wordnet_sense_compound_refinery.mjs")
      || value.endsWith("world/house/refinery-watchdog/program/resume-wordnet-sweep.mjs")) return true;
    return (value === "wordnet_sense_compound_refinery.mjs" || value === "resume-wordnet-sweep.mjs")
      && all.slice(0, index).some((prior) => String(prior).endsWith("/node"));
  });
}

async function latestActivity(root) {
  let latest = null;
  for (const filename of ACTIVITY_FILES) {
    try {
      const stat = await fsp.stat(path.join(root, filename));
      if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { file: filename, mtimeMs: stat.mtimeMs };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return latest;
}

async function remainingSenseCount(artifactDirectory) {
  let source;
  try {
    source = await fsp.readFile(path.join(artifactDirectory, "worklist.pya"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  for (const line of source.split(/\r?\n/u).slice(0, 40)) {
    let sentence;
    try {
      sentence = parse(line.trim());
    } catch {
      continue;
    }
    if (String(sentence?.su?.text || sentence?.su?.name || "").trim() !== "meta:remaining-sense-count") continue;
    const raw = String(sentence?.ob?.text ?? sentence?.ob?.num ?? "").trim();
    return /^\d+$/u.test(raw) ? Number(raw) : null;
  }
  return null;
}

export async function inspectWordnetSweep({
  repositoryRoot = PYASH_ROOT,
  artifactDirectory = path.join(repositoryRoot, "artifacts", SWEEP_RUN_ID),
  lockPath = path.join(repositoryRoot, "artifacts", ".wordnet-sense-compound-refinery.lock"),
  nowMs = Date.now(),
  staleAfterMs = STALE_AFTER_MS,
  readProcess = readLinuxProcess,
} = {}) {
  let lockPid = null;
  let lockMtimeMs = null;
  try {
    const [raw, stat] = await Promise.all([fsp.readFile(lockPath, "utf8"), fsp.stat(lockPath)]);
    lockPid = Number(raw.trim());
    lockMtimeMs = stat.mtimeMs;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const processInfo = Number.isSafeInteger(lockPid) && lockPid > 0 ? readProcess(lockPid) : null;
  const active = processMatchesSweep(processInfo, repositoryRoot);
  const conflictingLiveLock = Boolean(processInfo?.alive && !active);
  const activity = await latestActivity(artifactDirectory);
  const latestMtimeMs = Math.max(activity?.mtimeMs ?? 0, lockMtimeMs ?? 0);
  const idleMs = latestMtimeMs > 0 ? Math.max(0, nowMs - latestMtimeMs) : null;
  const remaining = await remainingSenseCount(artifactDirectory);

  let state;
  if (!active && !conflictingLiveLock && remaining === 0) state = "complete";
  else if (conflictingLiveLock) state = "lock_conflict";
  else if (active && idleMs !== null && idleMs <= staleAfterMs) state = "healthy";
  else if (active) state = "stalled";
  else state = "stopped";

  return {
    state,
    runId: SWEEP_RUN_ID,
    processId: lockPid,
    active,
    conflictingLiveLock,
    lastActivityFile: activity?.file ?? "",
    lastActivityAt: latestMtimeMs ? new Date(latestMtimeMs).toISOString() : "",
    idleMs,
    staleAfterMs,
    remainingSenseCount: remaining,
    artifactDirectory,
    lockPath,
  };
}

export function shouldInvokeRecovery(inspection) {
  return ["stopped", "stalled", "lock_conflict"].includes(inspection?.state);
}

function pyaText(value) {
  return String(value ?? "").replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"").replace(/[\r\n]+/gu, " ").trim();
}

export function pyaFacts(values) {
  const records = Object.entries(values).map(([name, value]) => {
    const sentence = `exists su name ${name} ob text "${pyaText(value)}" be text ya`;
    if (parse(sentence)?.su?.name !== name) {
      throw new Error(`wordnet sweep watchdog fact name does not round-trip through Pyash: ${name}`);
    }
    return sentence;
  });
  return `${records.join("\n")}\n`;
}

async function appendPyaFacts(filePath, values) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.appendFile(filePath, pyaFacts(values), "utf8");
}

async function readFileTail(filePath, maxBytes = 12_000) {
  let handle;
  try {
    handle = await fsp.open(filePath, "r");
    const stat = await handle.stat();
    const length = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    return buffer.toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readFileFromOffset(filePath, offset, maxBytes = 256_000) {
  let handle;
  try {
    handle = await fsp.open(filePath, "r");
    const stat = await handle.stat();
    const savedOffset = Math.max(0, Math.min(stat.size, Number(offset) || 0));
    const start = Math.max(savedOffset, stat.size - maxBytes);
    const length = Math.max(0, stat.size - start);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close();
  }
}

function latestBatchEvent(logTail) {
  const events = String(logTail ?? "").split(/\r?\n/u).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value?.event === "wordnet-sense-compound-batch-complete" ? [value] : [];
    } catch {
      return [];
    }
  });
  return events.at(-1) ?? null;
}

function batchEvidence(event) {
  if (!event) return "No completed batch event found in the recent sweep log.";
  return JSON.stringify({
    batchCount: event.batchCount,
    selectedSenseCount: event.selectedSenseCount,
    remainingSenseCount: event.remainingSenseCount,
    candidateCount: event.candidateCount,
    promotedSenseCount: event.promotedSenseCount,
    translationFailureCount: event.translationFailureCount,
    rolloverToFirstSubmissionMs: event.rolloverToFirstSubmissionMs,
  }, null, 2);
}

async function inspectHousekeeper(model) {
  const url = String(process.env.PYA_GPU_HOUSEKEEPER_URL || resolveConfiguredGpuHousekeeperUrl({ cwd: PYASH_ROOT })).trim();
  if (!url) throw new Error("configured GPU Housekeeper URL is missing");
  const adapter = createGpuHousekeeperAdapter({ baseUrl: url });
  const [health, queue, catalog] = await Promise.all([
    adapter.getHealth(),
    adapter.getQueue(),
    adapter.getOllamaModels(),
  ]);
  const models = Array.isArray(catalog) ? catalog : catalog?.models ?? [];
  const modelNames = models.map((entry) => typeof entry === "string" ? entry : entry?.name ?? entry?.model ?? "");
  const matchingSweepDuties = (Array.isArray(queue?.jobs) ? queue.jobs : [])
    .filter((job) => /^wordnet-sense-/u.test(String(job?.handleId ?? ""))
      && ["queued", "running", "pending", "active"].includes(String(job?.status ?? "").toLowerCase()))
    .map((job) => ({ handleId: String(job.handleId), status: String(job.status).toLowerCase() }));
  return {
    url,
    host: new URL(url).host,
    healthy: health?.status === "ok",
    queued: Number(queue?.queuedCount ?? queue?.queueDepth ?? 0),
    running: Number(queue?.runningCount ?? 0),
    activeSweepDuties: matchingSweepDuties.slice(0, 8),
    activeSweepDutyCount: matchingSweepDuties.length,
    modelAvailable: modelNames.includes(model),
    modelNames,
    error: "",
  };
}

async function submitRecoveryModel({ model, prompt, identity, operation = "wordnet-sweep-recovery" }) {
  const executor = createQueuedOllamaExecutor({
    root: PYASH_ROOT,
    runId: `wordnet-sweep-recovery-${SWEEP_RUN_ID}`,
    housekeeperUrl: process.env.PYA_GPU_HOUSEKEEPER_URL || resolveConfiguredGpuHousekeeperUrl({ cwd: PYASH_ROOT }),
    timeoutMs: RECOVERY_TIMEOUT_MS,
    pollMs: 250,
  });
  const result = await executor.executor({
    model,
    prompt,
    profile: "baseline",
    sampling: { format: "json", think: false, temperature: 0, top_p: 1, top_k: 0, num_predict: 1024, keep_alive: 300 },
    identity,
    operation,
  });
  return {
    text: result.text,
    handleId: result.request?.handleId ?? "",
    managedBy: result.metadata?.managedBy ?? "",
    startedAt: result.startedAt ?? "",
    finishedAt: result.finishedAt ?? "",
  };
}

async function persistModelTurn(directory, prefix, prompt, result) {
  await fsp.mkdir(directory, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(directory, `${prefix}-prompt.txt`), `${prompt}\n`, "utf8"),
    fsp.writeFile(path.join(directory, `${prefix}-response.txt`), `${result.text}\n`, "utf8"),
  ]);
}

async function pendingPostRestartReviews() {
  let entries;
  try {
    entries = await fsp.readdir(ARTIFACT_ROOT, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const pending = [];
  const fields = [
    "WordNet recovery review state",
    "WordNet recovery decision time",
    "WordNet recovery reason",
    "WordNet recovery restart verified time",
    "WordNet recovery restart remaining",
    "WordNet recovery restart log offset",
  ];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const incidentDirectory = path.join(ARTIFACT_ROOT, entry.name);
    const recoveryPath = path.join(incidentDirectory, "recovery-decision.pya");
    try {
      const values = readPyaTextValues(recoveryPath, fields);
      if (!isPostRestartReviewPending(values[fields[0]])) continue;
      pending.push({
        directory: incidentDirectory,
        failureEvidence: await fsp.readFile(path.join(incidentDirectory, "failure-evidence.txt"), "utf8").catch(() => ""),
        recovery: {
          reviewState: values[fields[0]],
          decisionAt: values[fields[1]],
          reason: values[fields[2]],
          restartVerifiedAt: values[fields[3]],
          remainingAtRestart: Number(values[fields[4]]) || null,
          logBytesAtRestart: Number(values[fields[5]]) || 0,
        },
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return pending;
}

async function runPendingPostRestartReview({ inspection, context, housekeeper }) {
  if (!inspection.active || inspection.state !== "healthy" || !housekeeper.healthy || !housekeeper.modelAvailable) return false;
  const pending = await pendingPostRestartReviews();
  for (const entry of pending) {
    const freshLog = await readFileFromOffset(
      path.join(SWEEP_ROOT, "sweep-supervised.log"),
      entry.recovery.logBytesAtRestart,
    );
    const event = latestBatchEvent(freshLog);
    if (!mayReviewRestartedSweep({ inspection, recovery: entry.recovery, latestBatchEvent: event })) continue;
    const prompt = buildSweepPostRestartReviewPrompt({
      inspection,
      context,
      recovery: entry.recovery,
      recentFailure: entry.failureEvidence,
      recentProgress: batchEvidence(event),
    });
    const attemptId = new Date().toISOString().replace(/[-:.]/gu, "");
    const attemptPrefix = `post-restart-review-${attemptId}`;
    await persistModelTurn(entry.directory, attemptPrefix, prompt, { text: "" });
    let responseReceived = false;
    try {
      const result = await submitRecoveryModel({
        model: context.model,
        prompt,
        identity: buildSweepPostRestartReviewIdentity({
          runId: inspection.runId,
          restartVerifiedAt: entry.recovery.restartVerifiedAt,
          attemptId,
        }),
        operation: "wordnet-sweep-post-restart-review",
      });
      responseReceived = true;
      await persistModelTurn(entry.directory, attemptPrefix, prompt, result);
      const review = parseSweepPostRestartReview(result.text);
      await appendPyaFacts(path.join(entry.directory, "post-restart-review.pya"), {
        "WordNet review attempt id": attemptId,
        "WordNet review run id": inspection.runId,
        "WordNet review model": context.model,
        "WordNet review Housekeeper host": housekeeper.host,
        "WordNet review Housekeeper handle": result.handleId,
        "WordNet review completion time": result.finishedAt || new Date().toISOString(),
        "WordNet review root cause": review.rootCause,
        "WordNet review confidence": review.confidence,
        "WordNet review evidence": review.evidence.join(" | "),
        "WordNet review fix plan": review.fixPlan,
        "WordNet review test plan": review.testPlan.join(" | "),
        "WordNet review state": "plan-recorded",
        "WordNet review coding turn state": "pending",
        "WordNet review coding turn artifact": "post-restart-review.pya",
      });
      await appendPyaFacts(path.join(entry.directory, "recovery-decision.pya"), {
        "WordNet recovery review state": "reviewed",
      });
      return "recorded";
    } catch (error) {
      const failurePath = path.join(entry.directory, `${attemptPrefix}-${responseReceived ? "parse-error" : "housekeeper-error"}.txt`);
      await fsp.writeFile(failurePath, `${error.message}\n`, "utf8");
      if (!responseReceived) {
        await fsp.writeFile(
          path.join(entry.directory, `${attemptPrefix}-response.txt`),
          `HOUSEKEEPER ERROR: ${error.message}\n`,
          "utf8",
        );
      }
      await appendPyaFacts(path.join(entry.directory, "recovery-decision.pya"), {
        "WordNet recovery review state": "retry-pending",
        "WordNet recovery review error": error.message,
      });
      return "retry-pending";
    }
  }
  return "none";
}

function incidentPya(inspection, checkedAt) {
  const facts = {
    "check time": checkedAt,
    "run id": inspection.runId,
    "state": inspection.state,
    "process id": inspection.processId ?? "",
    "active process": inspection.active ? "true" : "false",
    "live lock conflict": inspection.conflictingLiveLock ? "true" : "false",
    "last activity file": inspection.lastActivityFile,
    "last activity time": inspection.lastActivityAt,
    "idle milliseconds": inspection.idleMs ?? "unknown",
    "remaining senses": inspection.remainingSenseCount ?? "unknown",
    "artifact directory": inspection.artifactDirectory,
    "lock path": inspection.lockPath,
  };
  for (const [name, value] of [
    ["recovery model", inspection.recoveryModel],
    ["Housekeeper host", inspection.housekeeperHost],
    ["Housekeeper handle", inspection.housekeeperHandle],
    ["Housekeeper queued", inspection.housekeeperQueued],
    ["Housekeeper running", inspection.housekeeperRunning],
    ["recovery assessment", inspection.recoveryAssessment],
    ["recovery reason", inspection.recoveryReason],
    ["root cause", inspection.rootCause],
    ["fix plan", inspection.fixPlan],
    ["test plan", inspection.testPlan],
    ["recovery error", inspection.recoveryError],
    ["resume action", inspection.resumeAction],
  ]) {
    if (value !== undefined && value !== "") facts[name] = value;
  }
  return pyaFacts(facts);
}

function acquireWatchdogLock() {
  const result = spawnSync("flock", ["-n", "-E", "75", WATCHDOG_LOCK, process.execPath, fileURLToPath(import.meta.url), "--locked"], {
    cwd: PYASH_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status === 75) {
    process.stdout.write("[wordnet-sweep-watchdog] another check/recovery is active; skipping overlap\n");
    return 0;
  }
  return result.status ?? 1;
}

async function recordStatus(directory, state, details) {
  await fsp.mkdir(directory, { recursive: true });
  const content = incidentPya(details, new Date().toISOString());
  for (const target of [path.join(directory, "status.pya"), path.join(ARTIFACT_ROOT, "latest.pya")]) {
    const temporary = `${target}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, content, "utf8");
    await fsp.rename(temporary, target);
  }
  process.stdout.write(`[wordnet-sweep-watchdog] ${state} run=${SWEEP_RUN_ID} artifact=${directory}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForResumedSweep({ attempts = 45, pollMs = 1000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await inspectWordnetSweep();
    if (status.state === "healthy" && status.active) return status;
    if (status.state === "complete") return status;
    await delay(pollMs);
  }
  return inspectWordnetSweep();
}

async function startSameSweep(inspection, decision, housekeeper, context, artifactDirectory, checkedAt) {
  const sweepLogPath = path.join(SWEEP_ROOT, "sweep-supervised.log");
  let logBytesAtRestart = 0;
  try { logBytesAtRestart = (await fsp.stat(sweepLogPath)).size; } catch {}
  const resume = buildSweepResumeCommand({
    runId: inspection.runId,
    repositoryRoot: PYASH_ROOT,
    resumeEntryPoint: path.join(PROGRAM_DIR, "resume-wordnet-sweep.mjs"),
    artifactDirectory: SWEEP_ROOT,
    housekeeperUrl: housekeeper.url,
  });
  const existingSession = spawnSync("tmux", ["has-session", "-t", resume.sessionName], { cwd: PYASH_ROOT, encoding: "utf8" });
  if (existingSession.status === 0) {
    throw new Error(`persistent tmux session ${resume.sessionName} already exists; refusing duplicate resume`);
  }
  const launched = spawnSync("tmux", resume.tmuxArgs, { cwd: PYASH_ROOT, encoding: "utf8", timeout: 15_000 });
  if (launched.status !== 0) throw new Error(`tmux resume launch failed: ${(launched.stderr || launched.error?.message || "unknown tmux error").trim()}`);
  const after = await waitForResumedSweep();
  if (after.state !== "healthy" || !after.active) {
    throw new Error(`resume process did not acquire the sweep lock within the verification window (state=${after.state})`);
  }
  const decisionPath = path.join(artifactDirectory, "recovery-decision.pya");
  await appendPyaFacts(decisionPath, {
    "WordNet recovery state": "resume-verified",
    "WordNet recovery review state": "pending",
    "WordNet recovery decision time": checkedAt.toISOString(),
    "WordNet recovery restart verified time": new Date().toISOString(),
    "WordNet recovery restart remaining": after.remainingSenseCount,
    "WordNet recovery restart log offset": logBytesAtRestart,
    "WordNet recovery process id": after.processId,
    "WordNet recovery lock path": after.lockPath,
    "WordNet recovery tmux session": resume.sessionName,
    "WordNet recovery log path": resume.logPath,
    "WordNet recovery Housekeeper host": housekeeper.host,
    "WordNet recovery Housekeeper queued": housekeeper.queued,
    "WordNet recovery Housekeeper running": housekeeper.running,
    "WordNet recovery root cause hypothesis": decision.rootCauseHypothesis,
    "WordNet recovery fix plan": decision.fixPlan,
    "WordNet recovery test plan": decision.testPlan,
    "WordNet recovery verified process uses resume entry point": after.active ? "true" : "false",
    "WordNet recovery model": context.model,
  });
  return after;
}

async function writeRecoveryTurn({ artifactDirectory, inspection, context, housekeeper, failureEvidence }) {
  const resumeCommand = `node ${path.relative(PYASH_ROOT, path.join(PROGRAM_DIR, "resume-wordnet-sweep.mjs"))}`;
  const prompt = buildSweepRecoveryPrompt({
    inspection,
    context,
    housekeeper: { ...housekeeper, error: housekeeper.error || "" },
    recentFailure: failureEvidence,
    resumeCommand,
  });
  await fsp.writeFile(path.join(artifactDirectory, "spark-x-recovery-prompt.txt"), `${prompt}\n`, "utf8");
  const result = await submitRecoveryModel({
    model: context.model,
    prompt,
    identity: `recovery-${inspection.runId}-${path.basename(artifactDirectory)}`,
  });
  await fsp.writeFile(path.join(artifactDirectory, "spark-x-recovery-response.txt"), `${result.text}\n`, "utf8");
  const decision = parseSweepRecoveryDecision(result.text);
  await appendPyaFacts(path.join(artifactDirectory, "recovery-decision.pya"), {
    "WordNet recovery state": "decision-recorded",
    "WordNet recovery run id": inspection.runId,
    "WordNet recovery model": context.model,
    "WordNet recovery Housekeeper host": housekeeper.host,
    "WordNet recovery Housekeeper handle": result.handleId,
    "WordNet recovery managed by": result.managedBy,
    "WordNet recovery start time": result.startedAt,
    "WordNet recovery completion time": result.finishedAt,
    "WordNet recovery assessment": decision.assessment,
    "WordNet recovery action": decision.action,
    "WordNet recovery reason": decision.reason,
    "WordNet recovery root cause hypothesis": decision.rootCauseHypothesis,
    "WordNet recovery fix plan": decision.fixPlan,
    "WordNet recovery test plan": decision.testPlan,
    "WordNet recovery remaining at decision": inspection.remainingSenseCount,
    "WordNet recovery Housekeeper queued": housekeeper.queued,
    "WordNet recovery Housekeeper running": housekeeper.running,
  });
  return { decision, result, prompt };
}

async function runRecovery() {
  const checkedAt = new Date();
  const inspection = await inspectWordnetSweep({ nowMs: checkedAt.getTime() });
  const timestamp = checkedAt.toISOString().replace(/[-:.]/gu, "");
  const artifactDirectory = path.join(ARTIFACT_ROOT, `${timestamp}-${inspection.state}`);
  if (!shouldInvokeRecovery(inspection)) {
    const config = readSweepRecoveryConfig();
    let housekeeper;
    try {
      housekeeper = await inspectHousekeeper(config.model);
      const reviewState = await runPendingPostRestartReview({
        inspection,
        context: { ...config.context, model: config.model },
        housekeeper,
      });
      const status = reviewState === "recorded"
        ? "post_restart_review_recorded"
        : reviewState === "retry-pending" ? "post_restart_review_pending" : inspection.state;
      await recordStatus(artifactDirectory, status, {
        ...inspection,
        recoveryModel: reviewState !== "none" ? config.model : "",
        housekeeperHost: housekeeper.host,
        housekeeperHandle: "see per-incident post-restart-review.pya",
      });
    } catch (error) {
      await recordStatus(artifactDirectory, inspection.state, { ...inspection, recoveryError: error.message });
    }
    return;
  }

  await fsp.mkdir(artifactDirectory, { recursive: true });
  const incidentPath = path.join(artifactDirectory, "incident.pya");
  const failureEvidence = await readFileTail(path.join(SWEEP_ROOT, "sweep-supervised.log"));
  await Promise.all([
    fsp.writeFile(incidentPath, incidentPya(inspection, checkedAt.toISOString()), "utf8"),
    fsp.writeFile(path.join(artifactDirectory, "failure-evidence.txt"), `${failureEvidence}\n`, "utf8"),
  ]);

  const config = readSweepRecoveryConfig();
  try {
    const housekeeper = await inspectHousekeeper(config.model);
    if (!housekeeper.healthy || !housekeeper.modelAvailable) {
      throw new Error(`Housekeeper is not ready for ${config.model} (healthy=${housekeeper.healthy}, modelAvailable=${housekeeper.modelAvailable})`);
    }
    const context = { ...config.context, model: config.model };
    const { decision, result } = await writeRecoveryTurn({
      artifactDirectory,
      inspection,
      context,
      housekeeper,
      failureEvidence,
    });
    let after = await inspectWordnetSweep();
    let finalState = "recovery_wait";
    let recoveryError = "";
    let finalHousekeeper = housekeeper;
    if (mayResumeSweep({
      inspection,
      decision,
      housekeeperHealthy: housekeeper.healthy,
      housekeeperHasActiveSweepDuty: housekeeper.activeSweepDuties.length > 0,
    })) {
      const beforeLaunch = await inspectWordnetSweep();
      finalHousekeeper = await inspectHousekeeper(config.model);
      if (beforeLaunch.state !== "stopped"
        || beforeLaunch.remainingSenseCount !== inspection.remainingSenseCount
        || !finalHousekeeper.healthy
        || finalHousekeeper.activeSweepDuties.length > 0) {
        after = beforeLaunch;
        finalState = "recovery_decision_stale";
      } else {
        try {
          after = await startSameSweep(inspection, decision, finalHousekeeper, context, artifactDirectory, checkedAt);
          finalState = "recovery_resumed";
        } catch (error) {
          recoveryError = error.message;
          after = await inspectWordnetSweep();
          finalState = "recovery_failed";
        }
      }
    } else if (decision.action === "blocked" || inspection.state === "lock_conflict") {
      finalState = "recovery_blocked";
    }
    await recordStatus(path.join(artifactDirectory, "final"), finalState, {
      ...after,
      state: finalState,
      recoveryModel: config.model,
      housekeeperHost: finalHousekeeper.host,
      housekeeperHandle: result.handleId,
      housekeeperQueued: finalHousekeeper.queued,
      housekeeperRunning: finalHousekeeper.running,
      recoveryAssessment: decision.assessment,
      recoveryReason: decision.reason,
      rootCause: decision.rootCauseHypothesis,
      fixPlan: decision.fixPlan,
      testPlan: decision.testPlan,
      resumeAction: decision.action,
      recoveryError,
    });
    if (finalState === "recovery_failed") process.exitCode = 1;
  } catch (error) {
    await appendPyaFacts(path.join(artifactDirectory, "recovery-decision.pya"), {
      "WordNet recovery state": "recovery-failed",
      "WordNet recovery model": config.model,
      "WordNet recovery error": error.message,
    });
    await recordStatus(path.join(artifactDirectory, "final"), "recovery_failed", {
      ...inspection,
      state: "recovery_failed",
      recoveryModel: config.model,
      recoveryError: error.message,
    });
    process.exitCode = 1;
  }
}

async function run() {
  for (const name of Object.keys(process.env)) {
    if (name === "PYA_MIND_RESPONSE" || /^PYA_.*FIXTURE$/u.test(name)) delete process.env[name];
  }
  if (process.argv.includes("--locked")) return runLocked();
  process.exitCode = acquireWatchdogLock();
}

async function runLocked() {
  await runRecovery();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
