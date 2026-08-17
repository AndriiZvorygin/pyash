import { readWorkTaskStatus } from "./status.mjs";
import { deriveImplementationProgress } from "./progress.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function explicitText(value) {
  return text(value)
    .replace(/\n\s*(?:SUMMARY|PLAN SUMMARY|WORK ORDER|WORK OR|IMPLEMENTATION|STEPS|CHANGED FILES|FILES|TESTS|BLOCKERS|UNCERTAINTY):?[\s\S]*$/iu, "")
    .trim();
}

function changedFile(value) {
  const line = text(value);
  const link = line.match(/^\[([^\]]+)\]\([^)]*\)$/u);
  return text(link?.[1] || line).replace(/^`|`$/gu, "");
}

function compact(value, limit = 2400) {
  const body = text(value);
  if (body.length <= limit) return body;
  const cutoff = body.slice(0, Math.max(0, limit - 20));
  const boundary = cutoff.lastIndexOf("\n");
  const safe = boundary >= Math.floor(cutoff.length * 0.6) ? cutoff.slice(0, boundary) : cutoff;
  return `${safe.trimEnd()}\n... [truncated]`;
}

function indent(value, prefix = "  ", limit = 2400) {
  const body = compact(value, limit);
  return body ? body.split("\n").map((line) => `${prefix}${line}`).join("\n") : `${prefix}(none)`;
}

export function diffStat(diff, changedFiles = []) {
  const source = String(diff ?? "");
  let additions = 0;
  let deletions = 0;
  for (const line of source.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  const files = new Set(list(changedFiles));
  for (const line of source.split("\n")) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/u);
    if (match) files.add(match[2]);
  }
  if (!files.size && !additions && !deletions) return "no recorded changes";
  return `${files.size} file${files.size === 1 ? "" : "s"} changed, +${additions} -${deletions}`;
}

function taskFields(task) {
  const checkpoint = task?.checkpoint || {};
  return { task, checkpoint };
}

export function renderWorkTaskReport(task) {
  const { task: current, checkpoint } = taskFields(task);
  if (!current) return "PYASH BACKGROUND WORK REPORT\n\nTask state unavailable.";
  const implementation = checkpoint.implementation || {};
  const review = checkpoint.review || {};
  const workspace = checkpoint.workspace || {};
  const manager = checkpoint.manager || {};
  const worker = checkpoint.worker || {};
  const progress = deriveImplementationProgress(checkpoint);
  const changedFiles = list(implementation.changedFiles)
    .map(changedFile)
    .filter((file) => file && !/^commit\s*:/iu.test(file));
  const tests = list(implementation.tests);
  const decision = text(review.decision || (current.status === "accepted" ? "ACCEPT" : ""));
  const lines = [
    "PYASH BACKGROUND WORK REPORT",
    "",
    `Task: ${text(current.title) || "(untitled)"}`,
    `Task ID: ${text(current.taskId)}`,
    `Priority: ${current.priority}`,
    `Result: ${text(current.status).toUpperCase()}`,
    "",
    "Manager:",
    `  ${text(manager.model) || "(unknown)"}`,
    "",
    "Worker:",
    `  ${text(worker.model) || "(unknown)"}`,
    "",
    "Sol plan:",
    indent(explicitText(checkpoint.plan?.summary || checkpoint.plan?.workOrder), "  ", 1200),
    "",
    "Sol work order:",
    indent(explicitText(checkpoint.plan?.workOrder), "  ", 1800),
    "",
    "Luna implementation:",
    indent(explicitText(implementation.summary), "  ", 1200),
    "",
    `Implementation passes: ${progress.implementationPasses}`,
    `Material-progress passes: ${progress.materialProgressPasses}`,
    `No-delta passes: ${progress.noProgressPasses}`,
    `Commits produced: ${progress.commitsProduced}`,
    `Acceptance checks closed: ${progress.acceptanceChecksClosed}`,
    `Last material progress: ${progress.lastMaterialProgressAt || "not recorded"}`,
    "",
    "Changed files:"
  ];
  lines.push(changedFiles.length ? changedFiles.map((file) => `  ${file}`).join("\n") : "  (none recorded)");
  lines.push("", "Tests:");
  lines.push(tests.length ? tests.map((test) => `  ${test}`).join("\n") : "  (none recorded)");
  lines.push("", "Sol review:");
  lines.push(`  ${decision || "(not completed)"}`);
  lines.push(indent(review.explanation, "  ", 1800));
  if (review.revisionInstructions) {
    lines.push("", "Revision instructions:", indent(review.revisionInstructions, "  ", 1800));
  }
  lines.push("", `Diff: ${diffStat(implementation.diff, changedFiles)}`);
  lines.push(`Worktree: ${text(workspace.worktreePath) || "(not created)"}`);
  if (text(implementation.commit)) lines.push(`Commit: ${text(implementation.commit)}`);
  if (text(checkpoint.integration?.branch)) {
    lines.push(`Automation branch: ${text(checkpoint.integration.branch)}`);
    lines.push(`Integration: ${text(checkpoint.integration.status) || "pending"}`);
  }
  lines.push(`Started: ${text(current.startedAt) || "(not started)"}`);
  lines.push(`Finished: ${text(current.finishedAt) || text(checkpoint.interruption?.at) || "(in progress)"}`);
  const operatorNote = current.error
    || (["blocked", "failed", "usage-limited"].includes(current.status) ? checkpoint.blocker || current.message : "");
  if (operatorNote) {
    lines.push("", "Operator note:", indent(current.error || checkpoint.blocker || current.message, "  ", 1800));
  }
  return `${lines.join("\n")}\n`;
}

export function renderWorkDeferredReport({ result = {}, capacity = {} } = {}) {
  return [
    "PYASH BACKGROUND WORK REPORT",
    "",
    "Result: DEFERRED",
    `Reason: ${text(result.reason) || "background work deferred"}`,
    `Codex usage: ${capacity.usedPercent == null ? "unknown" : `${capacity.usedPercent}% used`}`,
    capacity.remainingPercent == null ? "Remaining capacity: unknown" : `Remaining capacity: ${capacity.remainingPercent}%`,
    `Eligible tasks: ${Number(result.eligible) || 0}`,
    `Next reset: ${text(capacity.resetAt) || "unknown"}`,
    ""
  ].join("\n");
}

export function renderWorkIdleReport({ result = {}, capacity = {} } = {}) {
  return [
    "PYASH BACKGROUND WORK REPORT",
    "",
    "Result: IDLE",
    `Reason: ${text(result.reason) || "no eligible work"}`,
    `Eligible tasks: ${Number(result.eligible) || 0}`,
    `Codex usage: ${capacity.usedPercent == null ? "unknown" : `${capacity.usedPercent}% used`}`,
    `Next reset: ${text(capacity.resetAt) || "unknown"}`,
    ""
  ].join("\n");
}

export function renderWorkDryRunReport({ inspection = {}, policy = {} } = {}) {
  const capacity = inspection.capacity || {};
  const weekly = capacity.weekly || {};
  const pacing = inspection.admission?.pacing || {};
  const selected = inspection.selected || inspection.curation?.proposed?.[0] || null;
  const percent = (value) => value == null ? "unknown" : `${Math.round(Number(value) * 10) / 10}%`;
  return [
    "PYASH BACKGROUND DRY RUN",
    "",
    "Weekly capacity:",
    `  Reset: ${text(weekly.resetAt) || "unknown"}`,
    `  Window start: ${text(weekly.windowStartAt) || "unknown"}`,
    `  Used: ${percent(weekly.usedPercent)}`,
    `  Remaining: ${percent(weekly.remainingPercent)}`,
    `  Observed: ${text(weekly.observedAt || capacity.observedAt) || "unknown"}`,
    "",
    "Pacing:",
    `  Week elapsed: ${pacing.elapsedFraction == null ? "unknown" : percent(pacing.elapsedFraction * 100)}`,
    `  Allowed used by now: ${percent(pacing.allowedUsedPercent)}`,
    `  Minimum remaining: ${percent(pacing.minimumRemainingPercent)}`,
    `  Actual used: ${percent(pacing.actualUsedPercent)}`,
    `  Pacing headroom: ${percent(pacing.headroomPercent)}`,
    `  Final reserve: ${percent(policy.reservePercent ?? 15)}`,
    "",
    "Next task:",
    selected ? `  ${selected.taskId} [priority ${selected.priority}] ${selected.title}` : "  (none)",
    inspection.curation?.proposed?.length
      ? `  Curated candidates: ${inspection.curation.proposed.map((item) => item.taskId).join(", ")}`
      : "",
    "",
    `Would admit: ${inspection.admission?.admit ? "yes" : "no"}`,
    `Reason: ${text(inspection.admission?.reason) || "unknown"}`,
    ""
  ].join("\n");
}

export async function readAndRenderWorkTaskReport(worldRoot, taskId) {
  const task = await readWorkTaskStatus(worldRoot, taskId);
  if (!task) throw new Error(`work task not found: ${taskId}`);
  return renderWorkTaskReport(task);
}
