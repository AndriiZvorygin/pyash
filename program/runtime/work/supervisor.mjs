import path from "node:path";

import { buildWorkTask, transitionWorkTask } from "./contract.mjs";
import {
  ackWorkTaskFail,
  ackWorkTaskSuccess,
  claimOldestRuntimeWorkTask,
  claimOldestWorkTask,
  queueDepth,
  writeWorkTaskRuntime
} from "./queue.mjs";
import {
  readWorkTaskStatus,
  writeWorkTaskStatus
} from "./status.mjs";
import { mergeWorkCheckpoint } from "./checkpoint.mjs";
import { collectGitEvidence, prepareWorktree } from "./workspace.mjs";
import {
  resumeCodexThread,
  runCodexTurn,
  spawnCodexAppServer,
  startCodexThread,
  threadIdFromResponse
} from "../codex/app_server.mjs";

export const DEFAULT_WORK_ROLE_CONFIG = Object.freeze({
  manager: Object.freeze({ model: "gpt-5.6-sol", reasoningEffort: "high" }),
  worker: Object.freeze({ model: "gpt-5.6-luna", reasoningEffort: "high" })
});

function text(value) {
  return String(value ?? "").trim();
}

function envValue(env, key, fallback) {
  const value = text(env?.[key]);
  return value || fallback;
}

export function resolveWorkRoleConfig(input = {}, env = process.env) {
  return {
    manager: {
      model: text(input.manager?.model) || envValue(env, "PYA_MANAGER_MODEL", DEFAULT_WORK_ROLE_CONFIG.manager.model),
      reasoningEffort: text(input.manager?.reasoningEffort)
        || envValue(env, "PYA_MANAGER_REASONING_EFFORT", DEFAULT_WORK_ROLE_CONFIG.manager.reasoningEffort)
    },
    worker: {
      model: text(input.worker?.model) || envValue(env, "PYA_WORKER_MODEL", DEFAULT_WORK_ROLE_CONFIG.worker.model),
      reasoningEffort: text(input.worker?.reasoningEffort)
        || envValue(env, "PYA_WORKER_REASONING_EFFORT", DEFAULT_WORK_ROLE_CONFIG.worker.reasoningEffort)
    }
  };
}

function nowValue(now) {
  return typeof now === "function" ? now() : now || new Date();
}

function sectionMap(output) {
  const sections = {};
  let current = "_text";
  sections[current] = [];
  for (const line of String(output ?? "").split("\n")) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z _-]{1,40}):\s*(.*)$/u);
    if (match) {
      current = match[1].trim().toUpperCase();
      sections[current] = [match[2]];
    } else {
      sections[current] ||= [];
      sections[current].push(line);
    }
  }
  return Object.fromEntries(Object.entries(sections).map(([key, values]) => [
    key,
    values.join("\n").trim()
  ]));
}

function firstSection(sections, names) {
  for (const name of names) {
    const value = text(sections[String(name).toUpperCase()]);
    if (value) return value;
  }
  return "";
}

function parsePlan(output) {
  const sections = sectionMap(output);
  const fallback = text(output);
  return {
    summary: firstSection(sections, ["SUMMARY", "PLAN SUMMARY"]) || fallback.slice(0, 1000),
    workOrder: firstSection(sections, ["WORK ORDER", "IMPLEMENTATION", "STEPS"]) || fallback,
    risks: firstSection(sections, ["RISKS", "RISK"])
  };
}

function lines(value) {
  return String(value ?? "").split(/\n|,/u)
    .map((line) => line
      .replace(/^\s*[-*]\s*/u, "")
      .replace(/\s+only\.?\s*$/iu, "")
      .replace(/^`|`$/gu, "")
      .trim())
    .filter((line) => !/^(none|n\/a|no files?)\.?$/iu.test(line))
    .filter(Boolean);
}

function parseImplementation(output) {
  const sections = sectionMap(output);
  const fallback = text(output);
  return {
    summary: firstSection(sections, ["SUMMARY", "IMPLEMENTATION SUMMARY"]) || fallback.slice(0, 1000),
    changedFiles: lines(firstSection(sections, ["CHANGED FILES", "FILES"])),
    tests: lines(firstSection(sections, ["TESTS", "TEST EVIDENCE"])),
    blockers: firstSection(sections, ["BLOCKERS", "BLOCKER"]),
    uncertainty: firstSection(sections, ["UNCERTAINTY", "NOTES"])
  };
}

export function parseReview(output) {
  const sections = sectionMap(output);
  const match = String(output ?? "").match(/\b(ACCEPT|REVISE|BLOCK)\b/i);
  return {
    decision: String(match?.[1] || "BLOCK").toUpperCase(),
    explanation: firstSection(sections, ["RATIONALE", "EXPLANATION", "SUMMARY"]) || text(output),
    revisionInstructions: firstSection(sections, ["CORRECTION", "CORRECTIONS", "REVISION", "REVISION INSTRUCTIONS"])
  };
}

function promptPlan(task, workspace, roles) {
  return [
    "You are Sol, the Pyash manager and architect.",
    "Produce a bounded implementation work order for Luna. Do not edit files.",
    "Use these exact headings: SUMMARY:, WORK ORDER:, RISKS:.",
    `Task title: ${task.title}`,
    `Objective: ${task.promptText}`,
    `Context: ${task.contextText || "none"}`,
    `Acceptance criteria: ${task.acceptanceText}`,
    `Repository: ${workspace.repository}`,
    `Assigned worktree: ${workspace.worktreePath}`,
    `Worker role model: ${roles.worker.model}`,
    "The work order must tell Luna what to change, how to test it, and what evidence to report."
  ].join("\n");
}

function promptImplementation(task, checkpoint, workspace, correction = "") {
  return [
    "You are Luna, the Pyash implementation worker.",
    "Implement the bounded work order in the assigned worktree. Run the relevant tests.",
    "Use these exact headings in your final report: SUMMARY:, CHANGED FILES:, TESTS:, BLOCKERS:, UNCERTAINTY:.",
    `Task title: ${task.title}`,
    `Objective: ${task.promptText}`,
    `Acceptance criteria: ${task.acceptanceText}`,
    `Context: ${task.contextText || "none"}`,
    `Sol work order: ${checkpoint.plan.workOrder}`,
    `Sol risks: ${checkpoint.plan.risks || "none reported"}`,
    correction ? `Sol correction request: ${correction}` : "",
    `Repository: ${workspace.repository}`,
    `Worktree: ${workspace.worktreePath}`,
    "Do not push or merge. Report actual changed files and test commands/results."
  ].filter(Boolean).join("\n");
}

function promptReview(task, checkpoint, workspace) {
  return [
    "You are Sol reviewing Luna's implementation in the Pyash worktree.",
    "Return exactly one decision using the heading DECISION: ACCEPT, DECISION: REVISE, or DECISION: BLOCK.",
    "Also provide RATIONALE: and, when revising, CORRECTION:.",
    `Original objective: ${task.promptText}`,
    `Acceptance criteria: ${task.acceptanceText}`,
    `Work order you approved: ${checkpoint.plan.workOrder}`,
    `Luna summary: ${checkpoint.implementation.summary}`,
    `Changed files: ${checkpoint.implementation.changedFiles.join(", ") || "none reported"}`,
    `Tests: ${checkpoint.implementation.tests.join("; ") || "none reported"}`,
    `Diff evidence:\n${checkpoint.implementation.diff.slice(0, 60000)}`,
    `Worktree: ${workspace.worktreePath}`
  ].join("\n");
}

function resultText(result) {
  return text(result?.text || result?.message || result?.output);
}

async function closeClient(client) {
  try {
    await client?.close?.();
  } catch {}
}

async function runTurn(client, options) {
  if (typeof client?.runTurn === "function") return client.runTurn(options);
  return runCodexTurn(client, options);
}

async function openRoleThread(client, {
  role,
  threadId,
  workspace,
  roleConfig,
  approvalPolicy,
  threadSandbox
}) {
  const options = {
    cwd: workspace.worktreePath,
    model: roleConfig.model,
    reasoningEffort: roleConfig.reasoningEffort,
    approvalPolicy,
    sandbox: threadSandbox
  };
  if (threadId) {
    if (typeof client?.resumeThread === "function") {
      await client.resumeThread({ threadId, ...options });
    } else {
      await resumeCodexThread(client, threadId, options);
    }
    return threadId;
  }
  const started = typeof client?.startThread === "function"
    ? await client.startThread({ role, ...options })
    : await startCodexThread(client, options);
  const id = threadIdFromResponse(started);
  if (!id) throw new Error(`${role} thread start returned no thread id`);
  return id;
}

function changedFilesFromResult(result, worktreePath) {
  return (result?.fileChanges || [])
    .map((entry) => text(entry?.path || entry?.file || entry?.filename))
    .map((file) => path.isAbsolute(file) ? path.relative(worktreePath, file) : file)
    .filter(Boolean);
}

function uniqueFileChanges(changes) {
  const seen = new Set();
  return (Array.isArray(changes) ? changes : []).filter((change) => {
    const key = JSON.stringify(change);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runWorkSupervisorOnce({
  worldRoot,
  repositoryRoot = process.cwd(),
  owner = "",
  workerTag = "sol-luna",
  roleConfig = {},
  appServerFactory = ({}) => spawnCodexAppServer({}),
  workspaceFactory = prepareWorktree,
  evidenceFactory = collectGitEvidence,
  maxRevisions = 1,
  approvalPolicy = "never",
  threadSandbox = "workspace-write",
  turnSandboxPolicy = ({ worktreePath }) => ({
    type: "workspaceWrite",
    writableRoots: [worktreePath]
  }),
  now = () => new Date()
} = {}) {
  const roleSettings = resolveWorkRoleConfig(roleConfig);
  const claimed = await claimOldestWorkTask(worldRoot, { workerTag, owner })
    || await claimOldestRuntimeWorkTask(worldRoot, { owner });
  if (!claimed) return { claimed: false, status: "idle", queue: await queueDepth(worldRoot) };

  const persisted = await readWorkTaskStatus(worldRoot, claimed.task.taskId);
  let task = buildWorkTask({
    ...claimed.task,
    ...(persisted || {}),
    checkpoint: persisted?.checkpoint || claimed.task.checkpoint,
    workSpec: persisted?.workSpec || claimed.task.workSpec
  });
  const startedClients = [];
  let managerClient = null;
  let workerClient = null;

  const save = async (checkpointPatch = {}, fields = {}) => {
    task = await writeWorkTaskStatus(worldRoot, {
      ...task,
      ...fields,
      checkpoint: mergeWorkCheckpoint(task.checkpoint, checkpointPatch)
    });
    await writeWorkTaskRuntime(claimed.path, task);
    return task;
  };

  if (task.status === "accepted" || task.status === "blocked") {
    await ackWorkTaskSuccess(worldRoot, { runtimePath: claimed.path });
    return {
      claimed: true,
      taskId: task.taskId,
      status: task.status,
      queue: await queueDepth(worldRoot)
    };
  }

  if (task.status === "failed") {
    await ackWorkTaskFail(worldRoot, {
      runtimePath: claimed.path,
      retryCount: task.retryCount,
      retryMax: task.retryMax
    });
    return {
      claimed: true,
      taskId: task.taskId,
      status: task.status,
      queue: await queueDepth(worldRoot)
    };
  }

  const move = async (status, options = {}) => {
    task = transitionWorkTask(task, status, { ...options, now: nowValue(now) });
    await writeWorkTaskStatus(worldRoot, task);
    await writeWorkTaskRuntime(claimed.path, task);
    return task;
  };

  const fail = async (err) => {
    const kind = err?.kind || "failed";
    const status = kind === "usage-limited" ? "usage-limited" : kind === "interrupted" ? "blocked" : "failed";
    const message = text(err?.message || err) || "supervisor failed";
    const atValue = nowValue(now);
    const at = typeof atValue?.toISOString === "function" ? atValue.toISOString() : String(atValue);
    const checkpoint = {
      interruption: {
        phase: task.status,
        at,
        reason: message,
        lastTurnId: ""
      }
    };
    if (task.status !== status) task = transitionWorkTask(task, status, { now: atValue, message, error: message });
    await save(checkpoint, { error: message, message });
    if (status === "failed") {
      await ackWorkTaskFail(worldRoot, {
        runtimePath: claimed.path,
        retryCount: task.retryCount,
        retryMax: task.retryMax
      });
    }
    return {
      claimed: true,
      taskId: task.taskId,
      status,
      error: message,
      resumable: status === "usage-limited"
    };
  };

  let workspace;
  try {
    workspace = await workspaceFactory({
      repositoryRoot,
      worldRoot,
      taskId: task.taskId,
      baseRevision: task.checkpoint.workspace.baseRevision
    });
    await save({
      workspace,
      manager: {
        model: roleSettings.manager.model,
        reasoningEffort: roleSettings.manager.reasoningEffort,
        threadId: task.checkpoint.manager.threadId
      },
      worker: {
        model: roleSettings.worker.model,
        reasoningEffort: roleSettings.worker.reasoningEffort,
        threadId: task.checkpoint.worker.threadId
      }
    });
  } catch (err) {
    return fail(err);
  }

  async function getClient(role, config, existingThreadId) {
    const client = await appServerFactory({
      role,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      cwd: workspace.worktreePath,
      threadId: existingThreadId,
      approvalPolicy
    });
    startedClients.push(client);
    return client;
  }

  async function getManager() {
    if (!managerClient) managerClient = await getClient("manager", roleSettings.manager, task.checkpoint.manager.threadId);
    const threadId = await openRoleThread(managerClient, {
      role: "manager",
      threadId: task.checkpoint.manager.threadId,
      workspace,
      roleConfig: roleSettings.manager,
      approvalPolicy,
      threadSandbox
    });
    if (threadId !== task.checkpoint.manager.threadId) {
      await save({ manager: { threadId }, interruption: { phase: "", at: "", reason: "", lastTurnId: "" } }, { solThreadId: threadId });
    }
    return { client: managerClient, threadId };
  }

  async function getWorker() {
    if (!workerClient) workerClient = await getClient("worker", roleSettings.worker, task.checkpoint.worker.threadId);
    const threadId = await openRoleThread(workerClient, {
      role: "worker",
      threadId: task.checkpoint.worker.threadId,
      workspace,
      roleConfig: roleSettings.worker,
      approvalPolicy,
      threadSandbox
    });
    if (threadId !== task.checkpoint.worker.threadId) {
      await save({ worker: { threadId }, interruption: { phase: "", at: "", reason: "", lastTurnId: "" } }, { lunaThreadId: threadId });
    }
    return { client: workerClient, threadId };
  }

  async function doPlanning() {
    const { client, threadId } = await getManager();
    const result = await runTurn(client, {
      threadId,
      cwd: workspace.worktreePath,
      model: roleSettings.manager.model,
      reasoningEffort: roleSettings.manager.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function"
        ? turnSandboxPolicy({ worktreePath: workspace.worktreePath })
        : turnSandboxPolicy,
      input: [{ type: "text", text: promptPlan(task, workspace, roleSettings) }]
    });
    const plan = parsePlan(resultText(result));
    await save({
      plan,
      interruption: { phase: "", at: "", reason: "", lastTurnId: result?.turnId || "" }
    });
  }

  async function doImplementation(correction = "") {
    const { client, threadId } = await getWorker();
    const result = await runTurn(client, {
      threadId,
      cwd: workspace.worktreePath,
      model: roleSettings.worker.model,
      reasoningEffort: roleSettings.worker.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function"
        ? turnSandboxPolicy({ worktreePath: workspace.worktreePath })
        : turnSandboxPolicy,
      input: [{ type: "text", text: promptImplementation(task, task.checkpoint, workspace, correction) }]
    });
    const report = parseImplementation(resultText(result));
    const evidence = await evidenceFactory({ worktreePath: workspace.worktreePath });
    const changedFiles = [...new Set([
      ...report.changedFiles,
      ...changedFilesFromResult(result, workspace.worktreePath),
      ...(evidence?.changedFiles || [])
    ])];
    await save({
      implementation: {
        ...report,
        changedFiles,
        fileChanges: uniqueFileChanges(result?.fileChanges || []),
        diff: evidence?.diff || result?.diff || ""
      },
      interruption: { phase: "", at: "", reason: "", lastTurnId: result?.turnId || "" }
    }, { result: report.summary });
  }

  async function doReview() {
    const { client, threadId } = await getManager();
    const result = await runTurn(client, {
      threadId,
      cwd: workspace.worktreePath,
      model: roleSettings.manager.model,
      reasoningEffort: roleSettings.manager.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function"
        ? turnSandboxPolicy({ worktreePath: workspace.worktreePath })
        : turnSandboxPolicy,
      input: [{ type: "text", text: promptReview(task, task.checkpoint, workspace) }]
    });
    const review = parseReview(resultText(result));
    await save({
      review,
      interruption: { phase: "", at: "", reason: "", lastTurnId: result?.turnId || "" }
    }, { message: review.explanation, result: review.decision });
    return review;
  }

  async function finish(status, message) {
    task = await move(status, { message, result: status });
    await ackWorkTaskSuccess(worldRoot, { runtimePath: claimed.path });
    return { claimed: true, taskId: task.taskId, status: task.status, message, queue: await queueDepth(worldRoot) };
  }

  try {
    if (task.status === "usage-limited") {
      task = await move(task.previousStatus || "planning", { message: "resuming after usage limit" });
    }
    if (task.status === "ready") await move("planning");
    if (task.status === "planning") {
      if (!task.checkpoint.plan.workOrder) await doPlanning();
      await move("implementing");
    }
    let correction = "";
    while (true) {
      if (task.status === "revision") {
        correction = task.checkpoint.review.revisionInstructions;
        await move("implementing", { message: "applying Sol revision request" });
      }
      if (task.status === "implementing") {
        await doImplementation(correction);
        await move("reviewing");
      }
      if (task.status !== "reviewing") throw new Error(`supervisor cannot review status ${task.status}`);
      const review = await doReview();
      if (review.decision === "ACCEPT") return await finish("accepted", review.explanation);
      if (review.decision === "BLOCK") return await finish("blocked", review.explanation);
      if (task.checkpoint.revisionCount >= maxRevisions) {
        return await finish("blocked", "revision limit reached: " + review.explanation);
      }
      await save({ revisionCount: task.checkpoint.revisionCount + 1 });
      await move("revision", { message: review.explanation });
    }
  } catch (err) {
    return fail(err);
  } finally {
    for (const client of startedClients) await closeClient(client);
  }
}
