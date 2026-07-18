import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPyaTextValues } from "../../../../command/pya_lookup.mjs";

const PROGRAM_DIR = path.dirname(fileURLToPath(import.meta.url));
export const HOUSE_ROOT = path.resolve(PROGRAM_DIR, "..");
export const PYASH_ROOT = path.resolve(HOUSE_ROOT, "../../..");
export const ARTIFACT_ROOT = path.join(HOUSE_ROOT, "artifacts");
export const WATCHDOG_LOCK = "/tmp/refinery-watchdog.lock";
export const PIPELINE_LOCK = "/tmp/municipal-reporter-pipeline.lock";

export const REPORTERS = Object.freeze({
  andrii: Object.freeze({
    key: "andrii",
    label: "Andrii YouTube",
    house: path.join(PYASH_ROOT, "world/house/andrii-youtube-reporter"),
    runScript: path.join(PYASH_ROOT, "world/house/andrii-youtube-reporter/run-next-story.sh"),
    lock: "/tmp/andrii-youtube-reporter.cron.lock",
    adapterFile: path.join(PYASH_ROOT, "world/house/andrii-youtube-reporter/program/writer-adapter-andrii-youtube.mjs"),
    adapterExport: "ANDRII_ADAPTER",
    envPrefix: "ANDRII",
  }),
  owen: Object.freeze({
    key: "owen",
    label: "Owen Sound",
    house: path.join(PYASH_ROOT, "world/house/owen-sound-reporter"),
    runScript: path.join(PYASH_ROOT, "world/house/owen-sound-reporter/run-next-story.sh"),
    lock: "/tmp/owen-sound-reporter.cron.lock",
    adapterFile: path.join(PYASH_ROOT, "world/house/owen-sound-reporter/program/writer-adapter-owen-sound.mjs"),
    adapterExport: "OWEN_ADAPTER",
    envPrefix: "OWEN",
  }),
  grey: Object.freeze({
    key: "grey",
    label: "Grey County",
    house: path.join(PYASH_ROOT, "world/house/grey-county-reporter"),
    runScript: path.join(PYASH_ROOT, "world/house/grey-county-reporter/run-next-story.sh"),
    lock: "/tmp/grey-county-reporter.cron.lock",
    adapterFile: path.join(PYASH_ROOT, "world/house/grey-county-reporter/program/writer-adapter-grey-county.mjs"),
    adapterExport: "GREY_ADAPTER",
    envPrefix: "GREY",
  }),
});

export function torontoParts(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
    hour: Number(values.hour),
  };
}

export function runId(prefix = "watchdog", date = new Date()) {
  return `${date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z")}-${prefix}`;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

function pyaText(value) {
  return String(value ?? "").replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/[\r\n]+/gu, " ").trim();
}

export function writePyaStatus(filePath, status) {
  const lines = [
    `exists su name run id ob text "${pyaText(status.run_id)}" be text ya`,
    `exists su name status ob text "${pyaText(status.status)}" be text ya`,
    `exists su name started utc ob text "${pyaText(status.started_at_utc)}" be text ya`,
    `exists su name finished utc ob text "${pyaText(status.finished_at_utc)}" be text ya`,
  ];
  if (status.reporter) lines.push(`exists su name reporter ob text "${pyaText(status.reporter)}" be text ya`);
  if (status.reason) lines.push(`exists su name reason ob text "${pyaText(status.reason)}" be text ya`);
  if (status.artifact_dir) lines.push(`exists su name artifact directory ob text "${pyaText(status.artifact_dir)}" be text ya`);
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${lines.join("\n")}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

export function writeRecoveryState(filePath, state) {
  const lines = [
    `exists su name run id ob text "${pyaText(state.run_id)}" be text ya`,
    `exists su name recovery status ob text "${pyaText(state.status)}" be text ya`,
    `exists su name launched utc ob text "${pyaText(state.launched_at_utc)}" be text ya`,
    `exists su name finished utc ob text "${pyaText(state.finished_at_utc)}" be text ya`,
    `exists su name recovery reporters ob text "${pyaText((state.reporters || []).join(","))}" be text ya`,
    `exists su name artifact directory ob text "${pyaText(state.artifact_dir)}" be text ya`,
  ];
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${lines.join("\n")}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

export function readRecoveryState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const values = readPyaTextValues(filePath, [
    "run id",
    "recovery status",
    "launched utc",
    "finished utc",
    "recovery reporters",
    "artifact directory",
  ]);
  return {
    run_id: String(values["run id"] || ""),
    status: String(values["recovery status"] || ""),
    launched_at_utc: String(values["launched utc"] || ""),
    finished_at_utc: String(values["finished utc"] || ""),
    reporters: String(values["recovery reporters"] || "").split(",").filter(Boolean),
    artifact_dir: String(values["artifact directory"] || ""),
  };
}

export function runProcess({ cmd, args = [], cwd = PYASH_ROOT, env = {}, timeoutMs = 10 * 60 * 60 * 1000, logPath = "", stream = true }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const log = logPath ? fs.createWriteStream(logPath, { flags: "a" }) : null;
    const receive = (kind, chunk) => {
      const text = String(chunk ?? "");
      if (kind === "stdout") stdout += text;
      else stderr += text;
      if (stream) (kind === "stdout" ? process.stdout : process.stderr).write(text);
      log?.write(text);
    };
    child.stdout.on("data", (chunk) => receive("stdout", chunk));
    child.stderr.on("data", (chunk) => receive("stderr", chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(10_000, Number(timeoutMs) || 10_000));
    child.on("error", (error) => {
      clearTimeout(timer);
      log?.end();
      resolve({ code: 1, signal: "", stdout, stderr: `${stderr}${error.stack || error.message}\n`, timedOut });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      log?.end();
      resolve({ code: code ?? 1, signal: signal ?? "", stdout, stderr, timedOut });
    });
  });
}

export function isLockHeld(lockPath) {
  ensureDir(path.dirname(lockPath));
  const result = spawnSync("flock", ["-n", lockPath, "true"], { stdio: "ignore" });
  return result.status !== 0;
}

export function reexecWithLock({ lockPath, marker, scriptPath, args = process.argv.slice(2) }) {
  if (process.env[marker] === "1") return null;
  const result = spawnSync("flock", ["-n", "-E", "75", lockPath, process.execPath, scriptPath, ...args], {
    cwd: PYASH_ROOT,
    env: { ...process.env, [marker]: "1" },
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function findFreshPick(meetingsDir, startedMs) {
  if (!fs.existsSync(meetingsDir)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(meetingsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pickPath = path.join(meetingsDir, entry.name, "next-story.pick.json");
    if (!fs.existsSync(pickPath)) continue;
    const stat = fs.statSync(pickPath);
    if (stat.mtimeMs < startedMs - 2000) continue;
    try {
      const value = JSON.parse(fs.readFileSync(pickPath, "utf8"));
      const generatedMs = Date.parse(String(value.generated_at_utc || ""));
      if (Number.isFinite(generatedMs) && generatedMs >= startedMs - 2000) {
        candidates.push({ ...value, pick_path: pickPath, generated_ms: generatedMs });
      }
    } catch {
      // A malformed fresh pick is reported as a probe error below.
    }
  }
  candidates.sort((a, b) => b.generated_ms - a.generated_ms);
  return candidates[0] ?? null;
}

export function classifyProbe({ active = false, exitCode = 0, candidate = null, error = "" } = {}) {
  if (active) return { state: "active", needs_repair: false, reason: "reporter or shared pipeline lock is held" };
  if (exitCode !== 0 || error) return { state: "probe_error", needs_repair: true, reason: error || `candidate probe exited ${exitCode}` };
  if (candidate) return { state: "unposted_candidate", needs_repair: true, reason: "an eligible candidate remains unpublished" };
  return { state: "healthy_no_candidate", needs_repair: false, reason: "no eligible unpublished candidate remains" };
}

export async function probeReporter(reporter, { refresh = true, logPath = "", stream = false } = {}) {
  if (!reporter) throw new Error("reporter configuration is required");
  if (isLockHeld(reporter.lock) || isLockHeld(PIPELINE_LOCK)) {
    return { reporter: reporter.key, label: reporter.label, ...classifyProbe({ active: true }) };
  }

  const [{ buildRunNextConfig }, adapterModule] = await Promise.all([
    import(pathToFileURL(path.join(PYASH_ROOT, "program/library/reporter_shared/writer-adapter-interface.mjs")).href),
    import(pathToFileURL(reporter.adapterFile).href),
  ]);
  const adapter = adapterModule[reporter.adapterExport];
  if (!adapter) throw new Error(`missing adapter export ${reporter.adapterExport}`);
  const config = buildRunNextConfig(adapter, {
    basePrefix: adapter.defaults.base_prefix,
    focus: adapter.defaults.focus,
    jurisdiction: adapter.defaults.jurisdiction,
    body: adapter.defaults.body,
    siteUrl: adapter.defaults.site_url,
    discussionUrl: adapter.defaults.discussion_url,
    execMxid: adapter.defaults.exec_mxid,
    timezone: adapter.defaults.timezone,
    extra: { send_dm_cmd: [] },
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `refinery-watchdog-${reporter.key}-`));
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const startedMs = Date.now();
  const env = {
    NEXT_STORY_PICK_ONLY: "1",
    NEXT_STORY_SKIP_REFRESH: refresh ? "0" : "1",
    [`${reporter.envPrefix}_NEXT_STORY_PICK_ONLY`]: "1",
    [`${reporter.envPrefix}_SKIP_MONTHLY_REFRESH`]: refresh ? "0" : "1",
  };
  const result = await runProcess({
    cmd: process.execPath,
    args: [path.join(PYASH_ROOT, "command/run_next_unposted_story.mjs"), configPath],
    cwd: PYASH_ROOT,
    env,
    timeoutMs: 12 * 60 * 1000,
    logPath,
    stream,
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
  const meetingsDir = path.join(adapter.house_root, "artifacts", adapter.artifacts_slug, "meetings");
  const candidate = result.code === 0 ? findFreshPick(meetingsDir, startedMs) : null;
  const classified = classifyProbe({
    exitCode: result.code,
    candidate,
    error: result.timedOut ? "candidate probe timed out" : "",
  });
  return {
    reporter: reporter.key,
    label: reporter.label,
    ...classified,
    candidate,
    exit_code: result.code,
    log_tail: `${result.stdout}\n${result.stderr}`.trim().slice(-8000),
  };
}

export function shouldLaunchRecovery({ failures = [], active = false, alreadyLaunched = false } = {}) {
  return failures.length > 0 && !active && !alreadyLaunched;
}

export function buildCodexPrompt({ incidentPath, reporters, artifactDir }) {
  const keys = reporters.map((item) => item.reporter).join(", ");
  return [
    "You are repairing failed scheduled reporter refineries in the Pyash repository.",
    `Affected reporters: ${keys}.`,
    `Machine-readable incident: ${incidentPath}`,
    `Artifact directory: ${artifactDir}`,
    "",
    "Before acting, read /home/htaf/pyash/AGENTS.md, /home/htaf/pyash/skills/reporter-refinery-recovery/SKILL.md, and its linked runbook completely.",
    "Diagnose from the incident evidence, reproduce narrowly, implement the general pipeline fix, run targeted tests, and then rerun only the affected reporter entry points to publish or update the missing work.",
    "Use qwen3.5:9b exclusively for local reporter-pipeline LLM work. Do not configure, invoke, or add references to any other local model.",
    "Do not create meeting-specific, date-specific, page-specific, or agenda-item-specific exceptions. Do not replace LLM transcript segmentation, prose generation, or summaries with regexes, opening fragments, first-sentence extraction, or other deterministic prose fallbacks.",
    "Respect the shared municipal reporter pipeline lock, do not overlap GPU-heavy work, preserve unrelated dirty-worktree changes, do not commit or push, do not use destructive Git commands, and never print credentials.",
    "Structured eScribe HTML remains authoritative for agenda identity and attachment ownership. Transcript segmentation must follow the complete meeting chronology, including public forum and revisited items. Whole-meeting output must cover the complete meeting rather than early items or one deputation.",
    "A substantive item may publish only with non-empty generated summaries; empty or timed-out generation stays retryable. Verify the remote publication after rerunning.",
    "If safe completion requires user judgment, unavailable credentials, or external authority, stop and return needs_human with a precise explanation.",
    "Return only the JSON object required by the supplied output schema.",
  ].join("\n");
}

export function mergeManagedCrontab(existing, { nodeBin = process.execPath } = {}) {
  const start = "# refinery-watchdog managed:start";
  const end = "# refinery-watchdog managed:end";
  const lines = String(existing || "").split(/\r?\n/u);
  const kept = [];
  let managed = false;
  for (const line of lines) {
    if (line.trim() === start) { managed = true; continue; }
    if (line.trim() === end) { managed = false; continue; }
    if (managed) continue;
    if (/world\/house\/(andrii-youtube-reporter|owen-sound-reporter|grey-county-reporter).*run-next-story\.sh --refresh/u.test(line)) continue;
    kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const entry = (minute, hour, program, suffix = "") => `${minute} ${hour} * * * cd ${PYASH_ROOT} && ${nodeBin} ${path.join(PROGRAM_DIR, program)}${suffix} >> ${path.join(ARTIFACT_ROOT, "cron.log")} 2>&1`;
  const block = [
    start,
    entry("0", "2", "run-nightly-refinery.mjs", " andrii"),
    entry("0", "3", "run-nightly-refinery.mjs", " owen"),
    entry("0", "4", "run-nightly-refinery.mjs", " grey"),
    entry("0", "5,6", "run-watchdog.mjs"),
    end,
  ];
  return `${[...kept, ...(kept.length ? [""] : []), ...block].join("\n")}\n`;
}

export async function sendMatrixAlert(message, { stream = false } = {}) {
  const script = path.join(PYASH_ROOT, "world/house/grey-county-reporter/program/send-executive-dm.mjs");
  return runProcess({
    cmd: process.execPath,
    args: [script, String(message || "").slice(0, 12000)],
    cwd: PYASH_ROOT,
    timeoutMs: 2 * 60 * 1000,
    stream,
  });
}

export function resolveCodexBin() {
  const candidates = [
    process.env.CODEX_BIN,
    "/home/htaf/.nvm/versions/node/v24.13.0/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "codex";
}

export function buildCodexExecArgs({ prompt, schemaPath, outputPath }) {
  return [
    "exec",
    "--full-auto",
    "--json",
    "-C", PYASH_ROOT,
    "--output-schema", schemaPath,
    "-o", outputPath,
    prompt,
  ];
}
