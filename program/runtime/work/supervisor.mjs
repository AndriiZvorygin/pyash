import path from "node:path";

import { buildWorkTask, transitionWorkTask } from "./contract.mjs";
import {
  ackWorkTaskFail,
  ackWorkTaskSuccess,
  claimWorkTaskById,
  claimOldestRuntimeWorkTask,
  claimOldestWorkTask,
  enqueueWorkTask,
  queueDepth,
  writeWorkTaskRuntime
} from "./queue.mjs";
import {
  readWorkTaskStatus,
  writeWorkTaskStatus
} from "./status.mjs";
import { mergeWorkCheckpoint } from "./checkpoint.mjs";
import { emitWorkEvent } from "./observer.mjs";
import { diffStat } from "./report.mjs";
import { collectGitEvidence, prepareWorktree } from "./workspace.mjs";
import { integrateAcceptedWork } from "./integration.mjs";
import {
  classifyImplementationPass,
  deriveImplementationProgress,
  implementationProgressFields,
  summarizeImplementationProgress,
  extractCommitIds
} from "./progress.mjs";
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

export function parseImplementation(output) {
  const sections = sectionMap(output);
  const fallback = text(output);
  return {
    summary: firstSection(sections, ["SUMMARY", "IMPLEMENTATION SUMMARY"]) || fallback.slice(0, 1000),
    commit: extractCommitIds(fallback).at(-1) || "",
    reviewReady: /(?:REVIEW READY|READY FOR REVIEW):\s*(?:yes|true|truth|1)\b/iu.test(fallback),
    changedFiles: lines(firstSection(sections, ["CHANGED FILES", "FILES"])),
    fileChanges: [],
    tests: lines(firstSection(sections, ["TESTS", "TEST EVIDENCE"])),
    blockers: firstSection(sections, ["BLOCKERS", "BLOCKER"]),
    uncertainty: firstSection(sections, ["UNCERTAINTY", "NOTES"])
  };
}

export function parseConvergence(output) {
  const sections = sectionMap(output);
  const match = String(output ?? "").match(/DECISION:\s*(CONTINUE|SPLIT|BLOCK)\b/iu);
  return {
    decision: String(match?.[1] || "BLOCK").toUpperCase(),
    rationale: firstSection(sections, ["RATIONALE", "EXPLANATION", "SUMMARY"]) || text(output),
    correction: firstSection(sections, ["CORRECTION", "CORRECTIONS", "CONTINUE", "FOLLOW-UP", "FOLLOW UP"]),
    splitScope: firstSection(sections, ["SPLIT", "FOLLOW-UP", "FOLLOW UP"])
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
    "Prefer one substantial coherent roadmap increment or parity tranche over a micro-fix.",
    "Pyash-first policy: prefer implementing workflow logic, reusable verbs, modules, configuration, and tests in Pyash when Pyash can express them reasonably.",
    "Use JavaScript, C, shell, or another host language for interpreter/compiler/runtime substrate, backend parity, operating-system integration, or capabilities Pyash cannot yet express cleanly. State the architectural reason whenever host-language implementation is chosen.",
    "The work order must tell Luna what to change, how to test it, what evidence to report, and what remains for a later bounded wake."
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
    `Implementation pass: ${Number(checkpoint.implementation.passes || 0) + 1}`,
    "Continue from the existing worktree and persistent Luna thread. Do not redo completed work. Prefer Pyash workflow logic and modules when the language can express the change; explain any host-language choice in the final report.",
    `Repository: ${workspace.repository}`,
    `Worktree: ${workspace.worktreePath}`,
    "Do not push or merge. Report actual changed files and test commands/results. Include REVIEW READY: yes only when the acceptance criteria are sufficiently implemented for Sol to review; otherwise use REVIEW READY: no and state the next concrete checkpoint."
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

function promptConvergence(task, checkpoint, workspace) {
  const history = (checkpoint.implementation.passHistory || []).slice(-12).map((pass) => [
    `Pass ${pass.pass} at ${pass.at}: ${pass.material ? "MATERIAL" : "NO DELTA"}`,
    `  Reasons: ${(pass.materialReasons || []).join(", ") || pass.noDeltaReason || "none"}`,
    `  Summary: ${text(pass.summary).slice(0, 600)}`,
    `  Tests: ${(pass.tests || []).slice(0, 5).join("; ") || "none"}`
  ].join("\n")).join("\n");
  return [
    "You are Sol performing a focused convergence review for a technical Pyash task.",
    "Do not repeat the original broad correction. Inspect the accumulated evidence and choose exactly one:",
    "DECISION: CONTINUE, DECISION: SPLIT, or DECISION: BLOCK.",
    "CONTINUE means give Luna one narrower concrete correction that can be verified.",
    "SPLIT means preserve the completed portion and define substantial dependent follow-up work.",
    "BLOCK is allowed only for a genuine product, semantic, architectural, safety, policy, credential, or unavailable-required-external-system decision.",
    "A clean worktree, repeated tests, a revision count, or a client timeout alone is not a human decision.",
    "Use exact headings: DECISION:, RATIONALE:, and CORRECTION: (or FOLLOW-UP: when splitting).",
    `Task title: ${task.title}`,
    `Objective: ${task.promptText}`,
    `Acceptance criteria: ${task.acceptanceText}`,
    `Worktree: ${workspace.worktreePath}`,
    `Current Sol correction: ${checkpoint.review.revisionInstructions || "none"}`,
    "Accumulated implementation evidence:",
    history || "none recorded"
  ].join("\n");
}

function resultText(result) {
  return text(result?.text || result?.message || result?.output);
}

function isoText(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value ?? "");
}

function requestIdentity(task, phase) {
  const pass = phase === "implementation"
    ? task.checkpoint.implementation.passes
    : phase === "convergence-review"
      ? task.checkpoint.convergence.reviewCount
      : 0;
  return `pyash-${task.taskId}-${phase}-${task.checkpoint.revisionCount}-${task.checkpoint.resumeCount}-${pass}`;
}

function storedTurnResult(turn) {
  return {
    status: turn?.result?.status || "completed",
    text: turn?.result?.text || "",
    diff: turn?.result?.diff || "",
    fileChanges: Array.isArray(turn?.result?.fileChanges) ? turn.result.fileChanges : [],
    turn: turn?.result?.turn || {},
    turnId: turn?.turnId || "",
    requestIdentity: turn?.requestIdentity || ""
  };
}

function emptyTurn() {
  return {
    phase: "",
    role: "",
    threadId: "",
    turnId: "",
    requestIdentity: "",
    state: "",
    startedAt: "",
    completedAt: "",
    resultCaptured: false,
    ambiguity: "",
    result: { status: "", text: "", diff: "", fileChanges: [], turn: {} }
  };
}

export class AmbiguousWorkTurnError extends Error {
  constructor(message, { phase = "", requestIdentity: identity = "" } = {}) {
    super(String(message));
    this.name = "AmbiguousWorkTurnError";
    this.kind = "ambiguous";
    this.phase = phase;
    this.requestIdentity = identity;
  }
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
  taskId = "",
  workerTag = "sol-luna",
  roleConfig = {},
  appServerFactory = ({}) => spawnCodexAppServer({}),
  workspaceFactory = prepareWorktree,
  evidenceFactory = collectGitEvidence,
  baseRef = "",
  integrationBranch = "",
  integrateAccepted = false,
  pushIntegration = false,
  integrationRemotes = ["origin", "github"],
  maxRevisions = 3,
  maxNoProgressPasses = 2,
  maxImplementationPassesBetweenConvergence = 12,
  pauseAfterImplementation = false,
  reviewAfterImplementationPasses = 2,
  pyashFirstPolicy = true,
  executionPreflight = null,
  turnTimeoutMs = 300000,
  approvalPolicy = "never",
  threadSandbox = "workspace-write",
  turnSandboxPolicy = ({ worktreePath }) => ({
    type: "workspaceWrite",
    writableRoots: [worktreePath]
  }),
  onEvent = null,
  now = () => new Date()
} = {}) {
  const roleSettings = resolveWorkRoleConfig(roleConfig);
  const claimed = taskId
    ? await claimWorkTaskById(worldRoot, taskId, { workerTag, owner })
    : await claimOldestWorkTask(worldRoot, { workerTag, owner })
      || await claimOldestRuntimeWorkTask(worldRoot, { owner });
  if (!claimed) return { claimed: false, status: "idle", queue: await queueDepth(worldRoot) };

  const persisted = await readWorkTaskStatus(worldRoot, claimed.task.taskId);
  let task = buildWorkTask({
    ...claimed.task,
    ...(persisted || {}),
    checkpoint: persisted?.checkpoint || claimed.task.checkpoint,
    workSpec: persisted?.workSpec || claimed.task.workSpec
  });
  const historicalProgress = deriveImplementationProgress(task.checkpoint);
  if (!task.checkpoint.implementation.passHistory.length && historicalProgress.passHistory.length) {
    task = await writeWorkTaskStatus(worldRoot, {
      ...task,
      checkpoint: mergeWorkCheckpoint(task.checkpoint, {
        implementation: implementationProgressFields(historicalProgress)
      })
    });
    await writeWorkTaskRuntime(claimed.path, task);
  }
  const emit = (type, fields = {}) => emitWorkEvent(onEvent, type, {
    taskId: task.taskId,
    title: task.title,
    priority: task.priority,
    ...fields
  }, { now });
  const startedClients = [];
  let managerClient = null;
  let workerClient = null;

  await emit("selected", {
    reason: task.checkpoint.selectionReason || "selected by priority",
    status: task.status
  });

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
    if (task.status === "accepted") await ackWorkTaskSuccess(worldRoot, { runtimePath: claimed.path });
    await emit(task.status, {
      reason: task.checkpoint.blocker || task.message || task.result,
      explanation: task.checkpoint.review.explanation
    });
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
    const activeTurn = task.checkpoint.activeTurn;
    const turnPending = activeTurn.state === "started" || activeTurn.state === "awaiting-completion";
    const turnUncaptured = activeTurn.state === "completed" && activeTurn.resultCaptured === false;
    const status = kind === "usage-limited"
      ? "usage-limited"
      : kind === "infrastructure" || kind === "interrupted" || kind === "ambiguous" || turnPending || turnUncaptured
        ? "blocked"
        : "failed";
    const message = text(err?.message || err) || "supervisor failed";
    const atValue = nowValue(now);
    const at = typeof atValue?.toISOString === "function" ? atValue.toISOString() : String(atValue);
    const checkpoint = {
      interruption: {
        phase: task.status,
        at,
        reason: message,
        lastTurnId: activeTurn.turnId || ""
      },
      blocker: status === "blocked" ? message : task.checkpoint.blocker,
      activeTurn: status === "usage-limited"
        ? emptyTurn()
        : turnPending || turnUncaptured
          ? { ...activeTurn, state: turnUncaptured ? "completed" : "ambiguous", ambiguity: message }
          : task.checkpoint.activeTurn
    };
    if (err?.preflight) checkpoint.executionPreflight = {
      status: err.preflight.status || "blocked",
      check: err.preflight.check || "",
      reason: err.preflight.reason || message,
      observedAt: err.preflight.observedAt || at,
      worktree: err.preflight.worktree || task.checkpoint.workspace.worktreePath,
      threadSandbox: err.preflight.details?.threadSandbox || "",
      turnSandbox: err.preflight.details?.turnSandbox || ""
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
    await emit(status, { reason: message, phase: task.status });
    return {
      claimed: true,
      taskId: task.taskId,
      status,
      error: message,
      resumable: status === "usage-limited" || status === "blocked"
    };
  };

  let workspace;
  try {
    workspace = await workspaceFactory({
      repositoryRoot,
      worldRoot,
      taskId: task.taskId,
      baseRevision: task.checkpoint.workspace.baseRevision,
      worktreePath: task.checkpoint.workspace.worktreePath,
      baseRef
    });
    if (executionPreflight) {
      const preflight = await executionPreflight({
        repositoryRoot,
        worldRoot,
        taskId: task.taskId,
        worktreePath: workspace.worktreePath,
        threadSandbox,
        turnSandboxPolicy,
        roleConfig: roleSettings
      });
      if (!preflight?.ok) {
        const error = new Error(preflight?.reason || "execution preflight failed");
        error.kind = "infrastructure";
        error.preflight = preflight;
        throw error;
      }
      await save({
        executionPreflight: {
          status: preflight.status || "ready",
          check: preflight.check || "",
          reason: preflight.reason || "",
          observedAt: preflight.observedAt || "",
          worktree: preflight.worktree || workspace.worktreePath,
          threadSandbox,
          turnSandbox: turnSandboxPolicy?.type || "workspaceWrite"
        }
      });
    }
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

  async function executeTurn(phase, role, client, options) {
    const identity = requestIdentity(task, phase);
    const active = task.checkpoint.activeTurn;
    if (active.state && active.requestIdentity !== identity) {
      throw new AmbiguousWorkTurnError(
        `unresolved Codex turn ${active.requestIdentity || active.turnId || "without identity"}`,
        { phase: active.phase, requestIdentity: active.requestIdentity }
      );
    }
    if (active.requestIdentity === identity && active.state === "completed" && !active.resultCaptured) {
      return storedTurnResult(active);
    }
    if (active.requestIdentity === identity && active.state && active.state !== "completed") {
      throw new AmbiguousWorkTurnError(
        `Codex turn ${identity} may have completed before the checkpoint was written`,
        { phase, requestIdentity: identity }
      );
    }
    const startedAt = isoText(nowValue(now));
    await save({
      activeTurn: {
        ...emptyTurn(),
        phase,
        role,
        threadId: options.threadId,
        requestIdentity: identity,
        state: "started",
        startedAt
      },
      lastAction: `${phase} turn started`
    });
    let result;
    try {
      result = await runTurn(client, { ...options, requestIdentity: identity });
    } catch (err) {
      throw err;
    }
    const completedAt = isoText(nowValue(now));
    await save({
      activeTurn: {
        ...emptyTurn(),
        phase,
        role,
        threadId: options.threadId,
        turnId: result?.turnId || "",
        requestIdentity: identity,
        state: "completed",
        startedAt,
        completedAt,
        resultCaptured: false,
        result: {
          status: result?.status || "completed",
          text: resultText(result),
          diff: result?.diff || "",
          fileChanges: uniqueFileChanges(result?.fileChanges || []),
          turn: result?.turn || {}
        }
      },
      lastAction: `${phase} turn completed; result checkpointed`
    });
    return { ...result, requestIdentity: identity };
  }

  async function captureTurn(phase, patch = {}, fields = {}) {
    const active = task.checkpoint.activeTurn;
    if (!active || active.phase !== phase || active.state !== "completed") {
      throw new Error(`missing completed ${phase} turn checkpoint`);
    }
    const history = [
      ...task.checkpoint.turnHistory,
      { ...active, resultCaptured: true }
    ];
    await save({
      ...patch,
      activeTurn: emptyTurn(),
      turnHistory: history,
      lastAction: `${phase} result captured`
    }, fields);
  }

  function hasCapturedTurn(phase) {
    const identity = requestIdentity(task, phase);
    return task.checkpoint.turnHistory.some((entry) => (
      entry.requestIdentity === identity && entry.resultCaptured === true
    ));
  }

  async function doPlanning() {
    const { client, threadId } = await getManager();
    await emit("planning-started", {
      role: "manager",
      model: roleSettings.manager.model,
      threadId,
      phase: "planning"
    });
    const result = await executeTurn("planning", "manager", client, {
      threadId,
      cwd: workspace.worktreePath,
      model: roleSettings.manager.model,
      reasoningEffort: roleSettings.manager.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function"
        ? turnSandboxPolicy({ worktreePath: workspace.worktreePath })
        : turnSandboxPolicy,
      timeoutMs: turnTimeoutMs,
      input: [{ type: "text", text: promptPlan(task, workspace, roleSettings) }]
    });
    const plan = parsePlan(resultText(result));
    await captureTurn("planning", {
      plan,
      interruption: { phase: "", at: "", reason: "", lastTurnId: result?.turnId || "" }
    });
    await emit("plan-completed", {
      role: "manager",
      model: roleSettings.manager.model,
      threadId,
      phase: "planning",
      summary: plan.summary,
      workOrder: plan.workOrder,
      risks: plan.risks
    });
  }

  async function doImplementation(correction = "") {
    const { client, threadId } = await getWorker();
    await emit("implementation-started", {
      role: "worker",
      model: roleSettings.worker.model,
      threadId,
      phase: "implementation",
      worktree: workspace.worktreePath
    });
    const result = await executeTurn("implementation", "worker", client, {
      threadId,
      cwd: workspace.worktreePath,
      model: roleSettings.worker.model,
      reasoningEffort: roleSettings.worker.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function"
        ? turnSandboxPolicy({ worktreePath: workspace.worktreePath })
        : turnSandboxPolicy,
      timeoutMs: turnTimeoutMs,
      input: [{ type: "text", text: promptImplementation(task, task.checkpoint, workspace, correction) }]
    });
    const report = parseImplementation(resultText(result));
    const evidence = await evidenceFactory({ worktreePath: workspace.worktreePath });
    const changedFiles = [...new Set([
      ...report.changedFiles,
      ...changedFilesFromResult(result, workspace.worktreePath),
      ...(evidence?.changedFiles || [])
    ])];
    const pass = task.checkpoint.implementation.passHistory.filter((entry) => entry.state === "completed").length + 1;
    const progressEntry = classifyImplementationPass({
      pass,
      at: isoText(nowValue(now)),
      turn: {
        ...task.checkpoint.activeTurn,
        result: {
          text: resultText(result),
          diff: result?.diff || "",
          fileChanges: uniqueFileChanges(result?.fileChanges || [])
        }
      },
      report,
      evidence,
      previousHistory: task.checkpoint.implementation.passHistory.filter((entry) => entry.state === "completed"),
      baseRevision: workspace.baseRevision
    });
    const progress = summarizeImplementationProgress([
      ...task.checkpoint.implementation.passHistory,
      progressEntry
    ]);
    await captureTurn("implementation", {
      implementation: {
        ...report,
        commit: evidence?.revision && evidence.revision !== workspace.baseRevision
          ? evidence.revision
          : report.commit || "",
        passes: task.checkpoint.implementation.passes + 1,
        reviewReady: report.reviewReady,
        changedFiles,
        fileChanges: uniqueFileChanges(result?.fileChanges || []),
        diff: evidence?.diff || result?.diff || "",
        ...implementationProgressFields(progress)
      },
      interruption: { phase: "", at: "", reason: "", lastTurnId: result?.turnId || "" }
    }, { result: report.summary });
    await emit("implementation-completed", {
      role: "worker",
      model: roleSettings.worker.model,
      threadId,
      phase: "implementation",
      summary: report.summary,
      changedFiles,
      tests: report.tests,
      worktree: workspace.worktreePath
    });
    await emit("implementation-progress", {
      role: "worker",
      model: roleSettings.worker.model,
      phase: "implementation",
      pass: progressEntry.pass,
      material: progressEntry.material,
      materialReasons: progressEntry.materialReasons,
      consecutiveNoProgressPasses: progress.consecutiveNoProgressPasses,
      commitsProduced: progress.commitsProduced,
      lastMaterialProgressAt: progress.lastMaterialProgressAt
    });
    await emit("tests-reported", {
      role: "worker",
      model: roleSettings.worker.model,
      tests: report.tests,
      blockers: report.blockers
    });
    await emit("diff-collected", {
      role: "worker",
      changedFiles,
      diff: evidence?.diff || result?.diff || "",
      diffStat: diffStat(evidence?.diff || result?.diff || "", changedFiles)
    });
  }

  async function doReview() {
    const { client, threadId } = await getManager();
    await emit("review-started", {
      role: "manager",
      model: roleSettings.manager.model,
      threadId,
      phase: "review"
    });
    const result = await executeTurn("review", "manager", client, {
      threadId,
      cwd: workspace.worktreePath,
      model: roleSettings.manager.model,
      reasoningEffort: roleSettings.manager.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function"
        ? turnSandboxPolicy({ worktreePath: workspace.worktreePath })
        : turnSandboxPolicy,
      timeoutMs: turnTimeoutMs,
      input: [{ type: "text", text: promptReview(task, task.checkpoint, workspace) }]
    });
    const review = parseReview(resultText(result));
    await captureTurn("review", {
      review,
      interruption: { phase: "", at: "", reason: "", lastTurnId: result?.turnId || "" }
    }, { message: review.explanation, result: review.decision });
    await emit("review-completed", {
      role: "manager",
      model: roleSettings.manager.model,
      threadId,
      phase: "review",
      decision: review.decision,
      explanation: review.explanation,
      correction: review.revisionInstructions
    });
    return review;
  }

  async function doConvergenceReview() {
    const { client, threadId } = await getManager();
    const requestedAt = isoText(nowValue(now));
    await save({
      convergence: { status: "reviewing", requestedAt },
      lastAction: "focused Sol convergence review started"
    });
    await emit("convergence-review-started", {
      role: "manager",
      model: roleSettings.manager.model,
      threadId,
      phase: "convergence-review",
      consecutiveNoProgressPasses: task.checkpoint.implementation.consecutiveNoProgressPasses
    });
    const result = await executeTurn("convergence-review", "manager", client, {
      threadId,
      cwd: workspace.worktreePath,
      model: roleSettings.manager.model,
      reasoningEffort: roleSettings.manager.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function"
        ? turnSandboxPolicy({ worktreePath: workspace.worktreePath })
        : turnSandboxPolicy,
      timeoutMs: turnTimeoutMs,
      input: [{ type: "text", text: promptConvergence(task, task.checkpoint, workspace) }]
    });
    const convergence = parseConvergence(resultText(result));
    const reviewCount = task.checkpoint.convergence.reviewCount + 1;
    await captureTurn("convergence-review", {
      convergence: {
        status: convergence.decision === "BLOCK" ? "blocked" : convergence.decision === "SPLIT" ? "split" : "continued",
        reviewCount,
        requestedAt,
        reviewedAt: isoText(nowValue(now)),
        decision: convergence.decision,
        rationale: convergence.rationale,
        correction: convergence.correction
      },
      review: convergence.decision === "CONTINUE"
        ? { revisionInstructions: convergence.correction }
        : {},
      interruption: { phase: "", at: "", reason: "", lastTurnId: result?.turnId || "" }
    }, { message: convergence.rationale });
    await emit("convergence-review-completed", {
      role: "manager",
      model: roleSettings.manager.model,
      threadId,
      phase: "convergence-review",
      decision: convergence.decision,
      explanation: convergence.rationale,
      correction: convergence.correction
    });
    return convergence;
  }

  async function splitFollowUp(convergence) {
    const suffix = `follow-up-${task.checkpoint.convergence.reviewCount}`;
    const followUpTaskId = `${task.taskId}-${suffix}`;
    if (await readWorkTaskStatus(worldRoot, followUpTaskId)) return followUpTaskId;
    await enqueueWorkTask(worldRoot, {
      taskId: followUpTaskId,
      owner: task.owner,
      kind: task.kind,
      title: `${task.title}: follow-up`,
      priority: task.priority,
      promptText: convergence.correction || `Continue the remaining boundary from ${task.title}.`,
      acceptanceText: task.acceptanceText,
      contextText: [
        task.contextText,
        `Split from ${task.taskId}. Preserve the completed portion in ${workspace.worktreePath}.`,
        `Sol rationale: ${convergence.rationale}`
      ].filter(Boolean).join("\n"),
      workSpec: {
        ...task.workSpec,
        granularity: "substantial",
        followUpOf: task.taskId,
        splitFromConvergence: task.checkpoint.convergence.reviewCount
      }
    });
    return followUpTaskId;
  }

  async function finish(status, message) {
    if (status === "accepted" && integrateAccepted && integrationBranch) {
      try {
        const integration = await integrateAcceptedWork({
          repositoryRoot,
          worktreePath: workspace.worktreePath,
          baseRevision: workspace.baseRevision,
          branch: integrationBranch,
          push: pushIntegration,
          pushRemotes: integrationRemotes,
          now
        });
        task = await save({ integration });
      } catch (error) {
        const reason = `automation branch integration blocked: ${text(error?.message || error)}`;
        task = await move("blocked", { message: reason, error: reason });
        task = await save({
          blocker: reason,
          integration: { status: "blocked", error: reason },
          lastAction: "blocked during automation branch integration"
        });
        await emit("blocked", { reason, phase: "integration", worktree: workspace.worktreePath });
        return { claimed: true, taskId: task.taskId, status: task.status, message: reason, queue: await queueDepth(worldRoot) };
      }
    }
    task = await move(status, { message, result: status });
    if (status === "blocked") {
      task = await save({
        blocker: message,
        lastAction: "blocked by Sol review"
      });
    }
    if (status === "accepted") {
      task = await save({ blocker: "" }, { error: "" });
      await ackWorkTaskSuccess(worldRoot, { runtimePath: claimed.path });
    }
    await emit(status, {
      decision: task.checkpoint.review.decision,
      explanation: task.checkpoint.review.explanation || message,
      reason: task.checkpoint.blocker || message,
      worktree: task.checkpoint.workspace.worktreePath
    });
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
      const implementation = task.checkpoint.implementation;
      const convergence = task.checkpoint.convergence;
      const lastConvergenceAt = Date.parse(convergence.reviewedAt || "");
      const passesSinceConvergence = implementation.passHistory.filter((entry) => {
        const at = Date.parse(entry.at || "");
        return !Number.isFinite(lastConvergenceAt) || (Number.isFinite(at) && at > lastConvergenceAt);
      }).length;
      const convergenceRequired = task.status === "revision"
        && (implementation.consecutiveNoProgressPasses >= Math.max(1, Number(maxNoProgressPasses) || 1)
          || (passesSinceConvergence >= Math.max(1, Number(maxImplementationPassesBetweenConvergence) || 1)
            && implementation.consecutiveNoProgressPasses > 0));
      if (convergenceRequired) {
        const reviewedAt = Date.parse(convergence.reviewedAt || "");
        const lastPassAt = Date.parse(implementation.passHistory.at(-1)?.at || "");
        const fresh = Number.isFinite(reviewedAt) && (!Number.isFinite(lastPassAt) || reviewedAt >= lastPassAt);
        const focused = fresh
          ? {
            decision: convergence.decision,
            rationale: convergence.rationale,
            correction: convergence.correction
          }
          : await doConvergenceReview();
        if (focused.decision === "CONTINUE") {
          await save({
            convergence: { status: "applied" },
            implementation: { consecutiveNoProgressPasses: 0 },
            lastAction: "focused Sol correction accepted; resuming Luna"
          });
          correction = focused.correction;
          await move("implementing", { message: "focused Sol correction" });
          continue;
        }
        if (focused.decision === "SPLIT") {
          const followUpTaskId = convergence.splitTaskIds[0] || await splitFollowUp(focused);
          await save({
            convergence: { status: "split", splitTaskIds: [followUpTaskId] },
            blocker: `technical scope split; follow-up task queued: ${followUpTaskId}`,
            lastAction: "scope split after convergence review"
          }, {
            workSpec: { ...task.workSpec, lifecycle: "split-parent", splitFollowUpTaskId: followUpTaskId }
          });
          task = await move("blocked", {
            message: `technical scope split; follow-up task queued: ${followUpTaskId}`,
            error: ""
          });
          await emit("split", {
            phase: "convergence-review",
            reason: focused.rationale,
            followUpTaskId
          });
          return { claimed: true, taskId: task.taskId, status: task.status, queue: await queueDepth(worldRoot) };
        }
        return await finish("blocked", focused.rationale || "Sol identified a genuine decision blocker");
      }
      if (task.status === "revision") {
        correction = task.checkpoint.review.revisionInstructions;
        await move("implementing", { message: "applying Sol revision request" });
      }
      if (task.status === "implementing") {
        if (!hasCapturedTurn("implementation")) await doImplementation(correction);
        if (pauseAfterImplementation
          && !task.checkpoint.implementation.reviewReady
          && task.checkpoint.implementation.passes < Math.max(1, Number(reviewAfterImplementationPasses) || 1)) {
          const pauseAt = isoText(nowValue(now));
          await save({
            interruption: {
              phase: "implementing",
              at: pauseAt,
              reason: "implementation checkpoint; awaiting next background wake",
              lastTurnId: task.checkpoint.turnHistory.at(-1)?.turnId || ""
            },
            lastAction: "implementation checkpoint; awaiting next background wake"
          });
          await emit("budget-paused", {
            phase: "implementing",
            reason: "implementation checkpoint; awaiting next background wake",
            passes: task.checkpoint.implementation.passes,
            worktree: workspace.worktreePath
          });
          return {
            claimed: true,
            taskId: task.taskId,
            status: "implementing",
            message: "implementation checkpoint; awaiting next background wake",
            queue: await queueDepth(worldRoot)
          };
        }
        await move("reviewing");
      }
      if (task.status !== "reviewing") throw new Error(`supervisor cannot review status ${task.status}`);
      const review = hasCapturedTurn("review")
        ? task.checkpoint.review
        : await doReview();
      if (review.decision === "ACCEPT") return await finish("accepted", review.explanation);
      if (review.decision === "BLOCK") return await finish("blocked", review.explanation);
      if (task.checkpoint.revisionCount >= maxRevisions) {
        const continuationAt = isoText(nowValue(now));
        const continuationCount = task.checkpoint.continuationCount + 1;
        await save({
          continuationCount,
          interruption: {
            phase: "reviewing",
            at: continuationAt,
            reason: "concrete Sol correction remains; continuing on a later eligible wake",
            lastTurnId: task.checkpoint.turnHistory.at(-1)?.turnId || ""
          },
          lastAction: "technical revision checkpoint; continuing concrete Sol correction"
        });
        await move("revision", { message: "technical revision checkpoint; continuing concrete Sol correction" });
        await emit("revision-requested", {
          phase: "revision",
          correction: review.revisionInstructions,
          decision: review.decision,
          continuation: true,
          continuationCount,
          reason: "revision bound reached for this wake; concrete correction remains technical work"
        });
        return {
          claimed: true,
          taskId: task.taskId,
          status: "revision",
          message: "technical revision checkpoint; continuing concrete Sol correction",
          queue: await queueDepth(worldRoot)
        };
      }
      await emit("revision-requested", {
        phase: "revision",
        correction: review.revisionInstructions,
        decision: review.decision
      });
      if (task.checkpoint.lastAction !== "revision queued") {
        await save({
          revisionCount: task.checkpoint.revisionCount + 1,
          implementation: { passes: 0, reviewReady: false },
          lastAction: "revision queued"
        });
      }
      await move("revision", { message: review.explanation });
    }
  } catch (err) {
    return fail(err);
  } finally {
    for (const client of startedClients) await closeClient(client);
  }
}
