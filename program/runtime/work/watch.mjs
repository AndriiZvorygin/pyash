import { diffStat } from "./report.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function time(at) {
  const date = new Date(at);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("en-CA", { hour12: false })
    : "--:--:--";
}

function lines(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function compact(value, limit = 1800) {
  const body = text(value);
  if (body.length <= limit) return body;
  return `${body.slice(0, Math.max(0, limit - 20)).trimEnd()}\n... [truncated]`;
}

function block(label, value) {
  const body = compact(value);
  return [`${label}`, ...(body ? body.split("\n").map((line) => `    ${line}`) : ["    (none)"])];
}

export function renderWorkEvent(event) {
  const prefix = `[${time(event?.at)}]`;
  const type = text(event?.type).toUpperCase();
  const title = text(event?.title || event?.taskId);
  switch (event?.type) {
    case "capacity": {
      const usage = event.capacity?.usedPercent == null ? "unknown" : `${event.capacity.usedPercent}%`;
      const decision = event.admitted ? "background work admitted" : text(event.reason || "background work deferred");
      return [`${prefix} CAPACITY   Codex usage ${usage}, ${decision}`];
    }
    case "deferred":
      return [`${prefix} DEFERRED   ${text(event.reason) || "background work deferred"}`];
    case "selected":
      return [`${prefix} SELECT     ${title} [priority ${event.priority}]`, `  ${text(event.reason) || "selected by priority"}`];
    case "planning-started":
      return [`${prefix} SOL        Planning ${title}...`, `  model: ${text(event.model) || "unknown"}`];
    case "plan-completed":
      return [`${prefix} SOL PLAN`, ...block("  summary:", event.summary), ...block("  work order:", event.workOrder)];
    case "implementation-started":
      return [`${prefix} LUNA       Implementing ${title}...`, `  model: ${text(event.model) || "unknown"}`, `  worktree: ${text(event.worktree) || "unknown"}`];
    case "implementation-completed":
      return [`${prefix} LUNA DONE`, ...block("  summary:", event.summary)];
    case "tests-reported":
      return [`${prefix} TESTS`, ...(lines(event.tests).length ? lines(event.tests).map((item) => `  ${item}`) : ["  (none reported)"])];
    case "diff-collected":
      return [`${prefix} DIFF       ${event.diffStat || diffStat(event.diff, event.changedFiles)}`, ...(lines(event.changedFiles).length ? lines(event.changedFiles).map((item) => `  ${item}`) : [])];
    case "review-started":
      return [`${prefix} SOL        Reviewing ${title}...`, `  model: ${text(event.model) || "unknown"}`];
    case "review-completed":
      return [`${prefix} SOL REVIEW ${text(event.decision) || "UNKNOWN"}`, ...block("  rationale:", event.explanation)];
    case "revision-requested":
      return [`${prefix} REVISION   Sol requested another pass`, ...block("  correction:", event.correction)];
    case "accepted":
      return [`${prefix} ACCEPTED   ${title}`, ...block("  rationale:", event.explanation)];
    case "blocked":
      return [`${prefix} BLOCKED    ${title}`, ...block("  reason:", event.reason)];
    case "usage-limited":
      return [`${prefix} USAGE      ${title}`, ...block("  reason:", event.reason)];
    case "failed":
      return [`${prefix} FAILED     ${title}`, ...block("  reason:", event.reason)];
    default:
      return [`${prefix} ${type.padEnd(10, " ")} ${text(event?.message || "")}`.trimEnd()];
  }
}

export function createWorkWatchRenderer({ write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  return async (event) => {
    for (const line of renderWorkEvent(event)) write(line);
  };
}
