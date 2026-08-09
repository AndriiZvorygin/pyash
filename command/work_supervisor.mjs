#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { runWorkSupervisorOnce } from "../program/runtime/work/supervisor.mjs";
import {
  addWorkTask,
  blockWorkTask,
  failWorkTask,
  listWorkTasks,
  resumeWorkTask,
  showWorkTask
} from "../program/runtime/work/operator.mjs";
import {
  inspectWorkBackground,
  runWorkBackgroundContinuous,
  runWorkBackgroundOnce
} from "../program/runtime/work/runner.mjs";
import { DEFAULT_BACKGROUND_POLICY, admitBackgroundWork } from "../program/runtime/work/capacity.mjs";
import { readWorkSchedulerHealth } from "../program/runtime/work/health.mjs";
import { readAndRenderWorkTaskReport, renderWorkDryRunReport } from "../program/runtime/work/report.mjs";
import { createWorkWatchRenderer } from "../program/runtime/work/watch.mjs";
import { readWorkTaskStatus } from "../program/runtime/work/status.mjs";
import { curateWorkBacklog } from "../program/runtime/work/curator.mjs";
import { buildWorkDailyDigest } from "../program/runtime/work/digest.mjs";
import {
  defaultWorkEmailFrom,
  sendWorkReportNotification
} from "../program/runtime/work/notification.mjs";

function value(args, flag, fallback = "") {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}

function has(args, flag) {
  return args.includes(flag);
}

function truthy(value) {
  return /^(truth|true|yes|1|y)$/i.test(String(value ?? "").trim());
}

function jsonValue(args, flag, fallback = {}) {
  const raw = value(args, flag, "");
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    throw new Error(`${flag} must contain valid JSON`);
  }
}

function positive(valueText, fallback) {
  const parsed = Number(valueText);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function codexSandboxOptions(env = process.env) {
  const threadSandbox = String(env.PYA_CODEX_THREAD_SANDBOX || "").trim();
  const turnSandbox = String(env.PYA_CODEX_TURN_SANDBOX || "").trim();
  return {
    ...(threadSandbox ? { threadSandbox } : {}),
    ...(turnSandbox ? { turnSandboxPolicy: { type: turnSandbox } } : {})
  };
}

function emailOptions(args, env = process.env) {
  const requested = has(args, "--email-report");
  const recipient = value(args, "--email-report", env.PYA_WORK_EMAIL_REPORT || "");
  if (requested && !recipient) throw new Error("--email-report requires a recipient address");
  if (!recipient) return null;
  return {
    recipient,
    from: value(args, "--email-from", defaultWorkEmailFrom(env)),
    transport: env.PYA_WORK_MAIL_TRANSPORT || "auto",
    sendmailPath: env.PYA_WORK_SENDMAIL_PATH || "/usr/sbin/sendmail",
    dockerCommand: env.PYA_WORK_DOCKER_COMMAND || "docker",
    dockerContainer: env.PYA_WORK_MAIL_CONTAINER || "mailserver"
  };
}

async function notifyResult(result, { worldRoot, email } = {}) {
  if (!email || !result?.report) return result;
  const taskId = result.selected || result.taskId || "";
  const task = taskId ? await readWorkTaskStatus(worldRoot, taskId) : null;
  const notification = await sendWorkReportNotification({
    worldRoot,
    task,
    taskId,
    title: task?.title || (result.subject ? "daily improvement" : "background work"),
    status: task?.status || result.status || (result.reason === "no eligible work" ? "idle" : "deferred"),
    report: result.report,
    subjectOverride: result.subject || "",
    ...email
  });
  return { ...result, notification };
}

function notificationFailed(result) {
  if (Array.isArray(result)) return result.some((item) => item?.notification?.status === "failed");
  return result?.notification?.status === "failed";
}

function world(args) {
  return path.resolve(value(args, "--world", process.env.PYA_WORLD_ROOT || "world"));
}

function output(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (Array.isArray(result)) {
    for (const task of result) {
      const age = Number.isFinite(Date.parse(task.queuedAt))
        ? `${Math.max(0, Math.floor((Date.now() - Date.parse(task.queuedAt)) / 60000))}m`
        : "?";
      process.stdout.write(`${task.taskId}\t${task.status}\tpriority=${task.priority}\tage=${age}\t${task.title}\n`);
    }
    return;
  }
  if (result && typeof result === "object") {
    if (result.taskId && result.checkpoint) {
      const checkpoint = result.checkpoint;
      const fields = {
        "task id": result.taskId,
        title: result.title,
        status: result.status,
        priority: result.priority,
        "queued at": result.queuedAt,
        phase: checkpoint.interruption?.phase || result.status,
        "manager model": checkpoint.manager?.model,
        "worker model": checkpoint.worker?.model,
        worktree: checkpoint.workspace?.worktreePath,
        blocker: checkpoint.blocker,
        "last action": checkpoint.lastAction,
        revisions: checkpoint.revisionCount
      };
      for (const [key, item] of Object.entries(fields)) process.stdout.write(`${key}: ${item ?? ""}\n`);
      return;
    }
    for (const [key, item] of Object.entries(result)) {
      if (item == null || typeof item === "object") continue;
      process.stdout.write(`${key}: ${item}\n`);
    }
    return;
  }
  process.stdout.write(`${String(result ?? "")}\n`);
}

function printResult(result, asJson, watchOutput = false) {
  if (asJson) {
    output(result, true);
    return;
  }
  const items = Array.isArray(result) ? result : [result];
  if (items.some((item) => item?.report)) {
    for (const item of items) {
      if (!item?.report) continue;
      process.stdout.write(`${watchOutput ? "\n" : ""}${item.report}\n`);
      if (item.notification) {
        const detail = item.notification.error ? `: ${item.notification.error}` : "";
        process.stdout.write(`Notification: ${item.notification.status}${detail}\n`);
      }
    }
    return;
  }
  output(result, false);
}

function usage() {
  return [
    "Usage:",
    "  node command/work_supervisor.mjs add --title <text> --prompt <text> --acceptance <text> [--priority <n>] [--json]",
    "  node command/work_supervisor.mjs list [--active] [--json]",
    "  node command/work_supervisor.mjs show <task-id> [--json]",
    "  node command/work_supervisor.mjs run-next [--repository <path>] [--owner <name>] [--json]",
    "  node command/work_supervisor.mjs block <task-id> --reason <text> [--json]",
    "  node command/work_supervisor.mjs resume <task-id> --context <text> [--json]",
    "  node command/work_supervisor.mjs fail|cancel <task-id> [--reason <text>] [--json]",
    "  node command/work_supervisor.mjs background [--continuous] [--dry-run] [--watch] [--interval-ms <n>] [--reserve-percent <n>] [--json]",
    "  node command/work_supervisor.mjs report <task-id> [--email-report <address>] [--email-from <address>] [--json]",
    "  node command/work_supervisor.mjs digest [--since <ISO>] [--email-report <address>] [--email-from <address>] [--json]",
    "  node command/work_supervisor.mjs health [--json]",
    "",
    "Without a subcommand, the legacy one-shot supervisor behaviour is used."
  ].join("\n");
}

const args = process.argv.slice(2);
const knownActions = new Set(["add", "list", "show", "run-next", "block", "resume", "fail", "cancel", "background", "health", "report", "digest"]);
const action = knownActions.has(args[0]) ? args[0] : "run-next";
const asJson = has(args, "--json");
const watch = has(args, "--watch");
const worldRoot = world(args);
const observer = watch ? createWorkWatchRenderer() : null;

try {
  let result;
  if (args[0] === "--help" || args[0] === "help") {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (action === "add") {
    const title = value(args, "--title");
    const prompt = value(args, "--prompt");
    const acceptance = value(args, "--acceptance");
    if (!title || !prompt || !acceptance) throw new Error("add requires --title, --prompt, and --acceptance");
    const taskId = value(args, "--task-id", `work-${Date.now()}`);
    await addWorkTask(worldRoot, {
      taskId,
      owner: value(args, "--owner", process.env.PYA_WORK_OWNER || "background"),
      kind: value(args, "--kind", "roadmap"),
      title,
      promptText: prompt,
      acceptanceText: acceptance,
      contextText: value(args, "--context"),
      priority: Number(value(args, "--priority", "100")),
      retryMax: Number(value(args, "--retry-max", "1")),
      workSpec: jsonValue(args, "--work-spec")
    });
    result = await showWorkTask(worldRoot, taskId);
  } else if (action === "list") {
    result = await listWorkTasks(worldRoot, { includeTerminal: !has(args, "--active") });
  } else if (action === "show") {
    result = await showWorkTask(worldRoot, args[1]);
  } else if (action === "block") {
    result = await blockWorkTask(worldRoot, args[1], value(args, "--reason"));
  } else if (action === "resume") {
    result = await resumeWorkTask(worldRoot, args[1], value(args, "--context"));
  } else if (action === "fail" || action === "cancel") {
    result = await failWorkTask(worldRoot, args[1], value(args, "--reason", "cancelled by operator"));
  } else if (action === "health") {
    result = await readWorkSchedulerHealth(worldRoot);
  } else if (action === "report") {
    const report = await readAndRenderWorkTaskReport(worldRoot, args[1]);
    const email = emailOptions(args);
    result = email
      ? await notifyResult({ report, selected: args[1] }, { worldRoot, email })
      : report;
  } else if (action === "digest") {
    const policy = {
      ...DEFAULT_BACKGROUND_POLICY,
      reservePercent: Number(process.env.PYA_BACKGROUND_RESERVE_PERCENT || "15"),
      pacingDeadbandPercent: Number(process.env.PYA_BACKGROUND_PACING_DEADBAND_PERCENT || "1"),
      curationThreshold: Number(process.env.PYA_BACKGROUND_CURATION_THRESHOLD || "1"),
      curationMaxTasks: Number(process.env.PYA_BACKGROUND_CURATION_MAX_TASKS || "3")
    };
    const repositoryRoot = path.resolve(value(args, "--repository", process.cwd()));
    result = await buildWorkDailyDigest({
      worldRoot,
      repositoryRoot,
      owner: value(args, "--owner", process.env.PYA_WORK_OWNER || "background"),
      since: value(args, "--since"),
      policy,
      automationBranch: process.env.PYA_AUTOMATION_BRANCH || "automation/roadmap"
    });
    const email = emailOptions(args);
    if (email) result = await notifyResult(result, { worldRoot, email });
  } else if (action === "background") {
    const policy = {
      enabled: true,
      reservePercent: Number(value(args, "--reserve-percent", process.env.PYA_BACKGROUND_RESERVE_PERCENT || "15")),
      pacingDeadbandPercent: Number(process.env.PYA_BACKGROUND_PACING_DEADBAND_PERCENT || "1"),
      curationThreshold: Number(process.env.PYA_BACKGROUND_CURATION_THRESHOLD || "1"),
      curationMaxTasks: Number(process.env.PYA_BACKGROUND_CURATION_MAX_TASKS || "3")
    };
    if (has(args, "--dry-run")) {
      const repositoryRoot = path.resolve(value(args, "--repository", process.cwd()));
      const curation = await curateWorkBacklog({
        worldRoot,
        repositoryRoot,
        owner: value(args, "--owner", process.env.PYA_WORK_OWNER || "background"),
        threshold: policy.curationThreshold,
        maxTasks: policy.curationMaxTasks,
        dryRun: true
      });
      const inspection = await inspectWorkBackground({
        worldRoot,
        owner: value(args, "--owner", process.env.PYA_WORK_OWNER || "background"),
        policy,
        foregroundActive: truthy(process.env.PYA_FOREGROUND_CODEX_ACTIVE)
      });
      const dryEligible = inspection.eligible.length
        ? inspection.eligible
        : curation.proposed.map((candidate) => ({ task: {
          taskId: candidate.taskId,
          title: candidate.title,
          priority: candidate.priority,
          queuedAt: new Date().toISOString()
        } }));
      const dryAdmission = admitBackgroundWork({
        capacity: inspection.capacity,
        policy,
        foregroundActive: truthy(process.env.PYA_FOREGROUND_CODEX_ACTIVE),
        hasEligibleWork: dryEligible.length > 0
      });
      const inspected = {
        ...inspection,
        eligible: dryEligible,
        selected: dryEligible[0]?.task || null,
        admission: dryAdmission,
        curation
      };
      result = {
        ...inspected,
        curation,
        report: renderWorkDryRunReport({ inspection: inspected, policy })
      };
    } else {
      const repositoryRoot = path.resolve(value(args, "--repository", process.cwd()));
      const options = {
        worldRoot,
        owner: value(args, "--owner", process.env.PYA_WORK_OWNER || "background"),
        policy,
        repositoryRoot,
        curate: true,
        foregroundActive: truthy(process.env.PYA_FOREGROUND_CODEX_ACTIVE),
        onEvent: observer,
        supervisorOptions: {
          repositoryRoot,
          baseRef: process.env.PYA_AUTOMATION_BRANCH || "automation/roadmap",
          integrationBranch: process.env.PYA_AUTOMATION_BRANCH || "automation/roadmap",
          integrateAccepted: true,
          pushIntegration: true,
          pauseAfterImplementation: true,
          reviewAfterImplementationPasses: 2,
          pyashFirstPolicy: true,
          ...codexSandboxOptions()
        }
      };
      result = has(args, "--continuous")
        ? await runWorkBackgroundContinuous({
          ...options,
          intervalMs: positive(value(args, "--interval-ms", "60000"), 60000),
          maxTasksPerWake: positive(value(args, "--max-tasks", "1"), 1)
        })
        : await runWorkBackgroundOnce(options);
    }
  } else {
    result = await runWorkSupervisorOnce({
      worldRoot,
      repositoryRoot: path.resolve(value(args, "--repository", process.cwd())),
      owner: value(args, "--owner", process.env.PYA_WORK_OWNER || ""),
      ...codexSandboxOptions(),
      onEvent: observer
    });
  }
  printResult(result, asJson, watch);
  if (result?.status === "failed" || result?.error || notificationFailed(result)) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
}
