#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "../../../../program/library/pya_config.mjs";
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
const FIXTURE_ENV = [
  "PYA_MIND_RESPONSE",
  "PYA_HEAR_FIXTURE",
  "PYA_PIPER_FIXTURE",
  "PYA_GPU_HOUSEKEEPER_FIXTURE",
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

export function shouldInvokeCodexRecovery(inspection) {
  return ["stopped", "stalled", "lock_conflict"].includes(inspection?.state);
}

function pyaText(value) {
  return String(value ?? "").replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"").replace(/[\r\n]+/gu, " ").trim();
}

function incidentPya(inspection, checkedAt) {
  const facts = {
    "checked at": checkedAt,
    "run id": inspection.runId,
    "state": inspection.state,
    "process id": inspection.processId ?? "",
    "active process": inspection.active ? "true" : "false",
    "live lock conflict": inspection.conflictingLiveLock ? "true" : "false",
    "last activity file": inspection.lastActivityFile,
    "last activity at": inspection.lastActivityAt,
    "idle milliseconds": inspection.idleMs ?? "unknown",
    "remaining senses": inspection.remainingSenseCount ?? "unknown",
    "artifact directory": inspection.artifactDirectory,
    "lock path": inspection.lockPath,
  };
  for (const [name, value] of [
    ["codex exit code", inspection.codexExitCode],
    ["codex signal", inspection.codexSignal],
    ["codex timed out", inspection.codexTimedOut],
    ["codex error", inspection.codexError],
    ["codex status", inspection.codexStatus],
    ["root cause", inspection.rootCause],
    ["diagnosis", inspection.diagnosis],
    ["resume action", inspection.resumeAction],
  ]) {
    if (value !== undefined && value !== "") facts[name] = value;
  }
  return `${Object.entries(facts).map(([name, value]) => `exists su name ${name} ob text "${pyaText(value)}" be text ya`).join("\n")}\n`;
}

function recoveryPrompt(incidentPath, artifactDir) {
  return [
    "You are the unattended recovery operator for one active Pyash WordNet compound-sense sweep.",
    `Read the durable conversation context at ${path.join(HOUSE_ROOT, "conduct", "wordnet-sweep-recovery.pya")} and incident ${incidentPath}.`,
    `Target run id: ${SWEEP_RUN_ID}. Target artifacts: ${SWEEP_ROOT}. Newspaper: ${path.join(PYASH_ROOT, "newspaper", `${SWEEP_RUN_ID}.pya`)}.`,
    "First read AGENTS.md, skills/pyash-refinery-runner/SKILL.md, and skills/pyash-gpu-management/SKILL.md. Inspect current process, lock, the latest worklist/progress, recent logs, Housekeeper queue/job evidence, and memory before changing anything.",
    "If the run is active and has recent durable progress or an active Housekeeper duty, report healthy and do not start, stop, or duplicate it.",
    `If it is complete, report complete. If it stopped or is demonstrably stalled, identify the cause from evidence. Make only the smallest general fix required, add or run a focused regression test, then resume this exact run with \`node ${path.relative(PYASH_ROOT, path.join(PROGRAM_DIR, "resume-wordnet-sweep.mjs"))}\` from the repository root. This entry point reads the run id from the durable .pya context and passes it explicitly to the existing refinery API.`,
    `Launch recovery so it survives the Codex process. Prefer a transient systemd user service when the user manager is available: use a stable unit name derived from the run id, set WorkingDirectory to ${PYASH_ROOT}, append stdout and stderr to ${path.relative(PYASH_ROOT, path.join(SWEEP_ROOT, "sweep-supervised.log"))}, and run the existing resume entry point with every PYA_*_FIXTURE variable and PYA_MIND_RESPONSE unset. Do not rely on a nohup child of the Codex shell. Keep a supervisor alive until the sweep exits only when systemd user services are unavailable. Capture the service main PID and verify it owns the sweep lock and begins producing durable artifacts after the Codex process exits. Do not wait for the multi-day sweep to finish.`,
    "In addition to the explicit unset list in the launch command, remove any other PYA_*_FIXTURE variables from the recovery environment. Inference must go through GPU Housekeeper; never call Ollama or a provider directly.",
    "Do not delete, truncate, rewrite, or regenerate accepted ledgers, progress, translation, composition, candidate, checkpoint, or newspaper evidence. Do not launch another run id. Do not kill any unrelated process. If an exact sweep process is wedged, determine whether a Housekeeper duty is still running before using a graceful stop and resume.",
    "Preserve unrelated dirty files. Keep changes within the sweep implementation and focused tests. Do not perform vocabulary edits, broad refactors, or destructive Git operations. Follow the repository contribution instructions for any code change.",
    "After recovery, independently verify the sweep process owns the lock and has started or resumed. Return the required JSON status and precise evidence in the supplied schema. If credentials, provider access, or safe recovery are unavailable, report blocked with the exact reason.",
    `Codex incident evidence is under ${artifactDir}.`,
  ].join("\n");
}

export function buildCodexEnvironment(source = process.env) {
  const env = { ...source };
  for (const name of FIXTURE_ENV) delete env[name];
  for (const name of Object.keys(env)) {
    if (name === "PYA_MIND_RESPONSE" || /^PYA_.*FIXTURE$/u.test(name)) delete env[name];
  }
  env.PATH = [path.dirname(process.execPath), String(source.PATH || "")].filter(Boolean).join(path.delimiter);
  return env;
}

function codexPath() {
  const candidates = [
    process.env.CODEX_BIN,
    "/home/htaf/.nvm/versions/node/v24.22.1/bin/codex",
    "/home/htaf/.local/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "codex";
}

export function buildRecoveryCodexArgs({ prompt, outputPath, schemaPath = path.join(PROGRAM_DIR, "wordnet-sweep-result.schema.json") }) {
  return [
    "exec",
    "--model", "gpt-6-luna",
    "--config", 'model_reasoning_effort="xhigh"',
    "--sandbox", "danger-full-access",
    "--config", 'approval_policy="never"',
    "--json",
    "--cd", PYASH_ROOT,
    "--output-schema", schemaPath,
    "--output-last-message", outputPath,
    prompt,
  ];
}

function runCodex({ args, logPath, timeoutMs = 8 * 60 * 60 * 1000 }) {
  return new Promise((resolve) => {
    const child = spawn(codexPath(), args, {
      cwd: PYASH_ROOT,
      env: buildCodexEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = fs.createWriteStream(logPath, { flags: "a" });
    let timedOut = false;
    let forceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      forceTimer.unref();
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => log.write(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      log.end();
      resolve({ code: 1, signal: "", timedOut, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      log.end();
      resolve({ code: code ?? 1, signal: signal ?? "", timedOut, error: "" });
    });
  });
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

async function run() {
  if (process.argv.includes("--locked")) return runLocked();
  process.exitCode = acquireWatchdogLock();
}

async function runLocked() {
  const checkedAt = new Date();
  const inspection = await inspectWordnetSweep({ nowMs: checkedAt.getTime() });
  const timestamp = checkedAt.toISOString().replace(/[-:.]/gu, "");
  const artifactDir = path.join(ARTIFACT_ROOT, `${timestamp}-${inspection.state}`);
  if (!shouldInvokeCodexRecovery(inspection)) {
    await recordStatus(artifactDir, inspection.state, inspection);
    return;
  }

  await fsp.mkdir(artifactDir, { recursive: true });
  const incidentPath = path.join(artifactDir, "incident.pya");
  const promptPath = path.join(artifactDir, "codex-prompt.txt");
  const outputPath = path.join(artifactDir, "codex-result.json");
  const logPath = path.join(artifactDir, "codex.jsonl");
  await fsp.writeFile(incidentPath, incidentPya(inspection, checkedAt.toISOString()), "utf8");
  const prompt = recoveryPrompt(incidentPath, artifactDir);
  await fsp.writeFile(promptPath, `${prompt}\n`, "utf8");
  const codex = await runCodex({
    args: buildRecoveryCodexArgs({ prompt, outputPath }),
    logPath,
  });

  let result = null;
  try {
    result = JSON.parse(await fsp.readFile(outputPath, "utf8"));
  } catch {}
  const after = await inspectWordnetSweep();
  const recovered = after.state === "healthy" || after.state === "complete";
  const finalState = codex.code === 0 && recovered ? after.state : "recovery_failed";
  await recordStatus(path.join(artifactDir, "final"), finalState, {
    ...after,
    state: finalState,
    codexExitCode: codex.code,
    codexSignal: codex.signal,
    codexTimedOut: codex.timedOut,
    codexError: codex.error,
    codexStatus: result?.status ?? "missing-result",
    rootCause: result?.root_cause ?? "",
    diagnosis: (result?.diagnosis ?? []).join("; "),
    resumeAction: result?.resume_action ?? "",
  });
  if (finalState === "recovery_failed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
