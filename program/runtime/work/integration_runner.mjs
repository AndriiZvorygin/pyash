import path from "node:path";

import { buildWorkTask, transitionWorkTask } from "./contract.mjs";
import {
  ackWorkTaskSuccess,
  claimWorkTaskById,
  queueDepth,
  writeWorkTaskRuntime
} from "./queue.mjs";
import { mergeWorkCheckpoint } from "./checkpoint.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "./status.mjs";
import { emitWorkEvent } from "./observer.mjs";
import { prepareWorktree, collectGitEvidence } from "./workspace.mjs";
import { integrateAcceptedWork } from "./integration.mjs";
import { classifyImplementationPass, summarizeImplementationProgress } from "./progress.mjs";
import {
  parseConvergence,
  parseImplementation,
  parseReview,
  resolveWorkRoleConfig
} from "./supervisor.mjs";
import {
  resumeCodexThread,
  runCodexTurn,
  spawnCodexAppServer,
  startCodexThread,
  threadIdFromResponse
} from "../codex/app_server.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function nowValue(now) {
  return typeof now === "function" ? now() : now || new Date();
}

function resultText(result) {
  return text(result?.text || result?.message || result?.output);
}

function uniqueChanges(changes) {
  const seen = new Set();
  return (Array.isArray(changes) ? changes : []).filter((change) => {
    const key = JSON.stringify(change);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function changedFilesFromResult(result, worktreePath) {
  return (result?.fileChanges || [])
    .map((entry) => text(entry?.path || entry?.file || entry?.filename))
    .map((file) => path.isAbsolute(file) ? path.relative(worktreePath, file) : file)
    .filter(Boolean);
}

function promptIntegration(task, checkpoint, workspace, branch, reconciliation) {
  return [
    "You are Luna, the Pyash implementation worker performing bounded integration reconciliation.",
    "Do not run git cherry-pick --continue and do not modify master.",
    "Work only in the assigned reconciliation worktree, which is based on the current automation branch.",
    "Reapply the semantic intent of the already reviewed task on top of this current baseline.",
    "Inspect the original task worktree, its commits, the current baseline, and the conflicting files before editing.",
    "Do not resurrect code that the current automation branch has intentionally superseded.",
    "Run the task's focused acceptance tests and relevant regression/parity tests, then create a task-local reconciliation commit when the result is ready for Sol review.",
    "Use these exact headings: SUMMARY:, CHANGED FILES:, TESTS:, BLOCKERS:, UNCERTAINTY:.",
    "Include REVIEW READY: yes only when the semantic capability and acceptance evidence are ready for review.",
    `Task title: ${task.title}`,
    `Original objective: ${task.promptText}`,
    `Acceptance criteria: ${task.acceptanceText}`,
    `Original context: ${task.contextText || "none"}`,
    `Original Sol work order: ${checkpoint.plan.workOrder || "not recorded"}`,
    `Original Sol risks: ${checkpoint.plan.risks || "none reported"}`,
    `Original task worktree: ${checkpoint.workspace.worktreePath || "not recorded"}`,
    `Original task base revision: ${checkpoint.workspace.baseRevision || "not recorded"}`,
    `Original task tip: ${reconciliation.taskCommit || checkpoint.implementation.commit || "not recorded"}`,
    `Current automation branch: ${branch}`,
    `Current reconciliation baseline: ${workspace.baseRevision}`,
    `Reconciliation attempt: ${reconciliation.attempts}`,
    `Reconciliation worktree: ${workspace.worktreePath}`,
    `Prior reconciliation correction: ${reconciliation.revisionInstructions || "none"}`,
    "Preserve the original task history as evidence. Report the semantic choices made for each conflict and any remaining uncertainty."
  ].join("\n");
}

function promptIntegrationReview(task, checkpoint, workspace, branch, reconciliation) {
  return [
    "You are Sol reviewing a reconciled Pyash roadmap task.",
    "This is an integration review, not a new planning turn.",
    "Return exactly one decision using DECISION: ACCEPT, DECISION: REVISE, or DECISION: BLOCK.",
    "Also provide RATIONALE: and, when revising, CORRECTION:.",
    "BLOCK is allowed only for a genuine semantic incompatibility, product/architecture/safety/policy choice, or required external condition. A Git conflict alone is not a blocker.",
    `Original objective: ${task.promptText}`,
    `Acceptance criteria: ${task.acceptanceText}`,
    `Original Sol work order: ${checkpoint.plan.workOrder || "not recorded"}`,
    `Original reviewed implementation evidence: ${checkpoint.implementation.summary || "not recorded"}`,
    `Original task tip: ${reconciliation.taskCommit || checkpoint.implementation.commit || "not recorded"}`,
    `Current automation branch: ${branch}`,
    `Reconciliation worktree: ${workspace.worktreePath}`,
    `Reconciliation summary: ${reconciliation.summary || "not recorded"}`,
    `Reconciled files: ${reconciliation.changedFiles.join(", ") || "none reported"}`,
    `Reconciled tests: ${reconciliation.tests.join("; ") || "none reported"}`,
    `Reconciliation diff evidence:\n${reconciliation.diff.slice(0, 60000)}`,
    `Conflicts resolved: ${reconciliation.conflictsResolved}`,
    "Review whether the intended capability is preserved on the current baseline, whether superseded code was correctly omitted, and whether the focused and regression evidence is sufficient."
  ].join("\n");
}

function promptIntegrationConvergence(task, checkpoint, reconciliation) {
  return [
    "You are Sol performing a focused convergence review of integration reconciliation.",
    "Do not request another broad rewrite. Choose exactly one: DECISION: CONTINUE, DECISION: SPLIT, or DECISION: BLOCK.",
    "CONTINUE must provide one narrower executable correction. SPLIT must identify a coherent dependent follow-up while preserving completed work. BLOCK requires a genuine semantic or human decision.",
    `Task: ${task.title}`,
    `Objective: ${task.promptText}`,
    `Acceptance: ${task.acceptanceText}`,
    `Reconciliation attempts: ${reconciliation.attempts}`,
    `Material attempts: ${reconciliation.materialAttempts}`,
    `No-progress attempts: ${reconciliation.noProgressAttempts}`,
    `Current correction: ${reconciliation.revisionInstructions || "none"}`,
    `Accumulated summary: ${reconciliation.summary || "none"}`,
    `Tests: ${reconciliation.tests.join("; ") || "none"}`,
    `Diff:\n${reconciliation.diff.slice(0, 50000)}`,
    "Use exact headings: DECISION:, RATIONALE:, and CORRECTION: (or FOLLOW-UP: when splitting)."
  ].join("\n");
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

async function openThread(client, { role, threadId, cwd, config, approvalPolicy, sandbox }) {
  const options = {
    cwd,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    approvalPolicy,
    sandbox
  };
  if (threadId) {
    if (typeof client?.resumeThread === "function") await client.resumeThread({ threadId, ...options });
    else await resumeCodexThread(client, threadId, options);
    return threadId;
  }
  const started = typeof client?.startThread === "function"
    ? await client.startThread({ role, ...options })
    : await startCodexThread(client, { role, ...options });
  const id = threadIdFromResponse(started);
  if (!id) throw new Error(`${role} reconciliation thread start returned no thread id`);
  return id;
}

export async function runWorkIntegrationReconciliationOnce({
  worldRoot,
  repositoryRoot = process.cwd(),
  owner = "",
  taskId = "",
  roleConfig = {},
  appServerFactory = ({}) => spawnCodexAppServer({}),
  workspaceFactory = prepareWorktree,
  evidenceFactory = collectGitEvidence,
  integrationBranch = "automation/roadmap",
  pushIntegration = false,
  integrationRemotes = ["origin", "github"],
  executionPreflight = null,
  turnTimeoutMs = 900000,
  approvalPolicy = "never",
  threadSandbox = "workspace-write",
  turnSandboxPolicy = ({ worktreePath }) => ({ type: "workspaceWrite", writableRoots: [worktreePath] }),
  maxNoProgressAttempts = 2,
  onEvent = null,
  now = () => new Date()
} = {}) {
  const roleSettings = resolveWorkRoleConfig(roleConfig);
  const claimed = await claimWorkTaskById(worldRoot, taskId, { owner, workerTag: "integration-reconciliation" });
  if (!claimed) return { claimed: false, status: "idle", queue: await queueDepth(worldRoot) };
  const persisted = await readWorkTaskStatus(worldRoot, claimed.task.taskId);
  let task = buildWorkTask({
    ...claimed.task,
    ...(persisted || {}),
    checkpoint: persisted?.checkpoint || claimed.task.checkpoint,
    workSpec: persisted?.workSpec || claimed.task.workSpec
  });
  const startedClients = [];
  let workerClient = null;
  let managerClient = null;
  let workspace;

  const emit = (type, fields = {}) => emitWorkEvent(onEvent, type, {
    taskId: task.taskId,
    title: task.title,
    priority: task.priority,
    ...fields
  }, { now });
  const save = async (checkpointPatch = {}, fields = {}) => {
    task = await writeWorkTaskStatus(worldRoot, {
      ...task,
      ...fields,
      checkpoint: mergeWorkCheckpoint(task.checkpoint, checkpointPatch)
    });
    await writeWorkTaskRuntime(claimed.path, task);
    return task;
  };
  const move = async (status, options = {}) => {
    task = transitionWorkTask(task, status, { ...options, now: nowValue(now) });
    await writeWorkTaskStatus(worldRoot, task);
    await writeWorkTaskRuntime(claimed.path, task);
    return task;
  };
  const fail = async (error) => {
    const message = text(error?.message || error) || "integration reconciliation failed";
    const at = iso(nowValue(now));
    const active = task.checkpoint.activeTurn;
    const ambiguous = active.state === "started" || active.state === "awaiting-completion" || error?.kind === "ambiguous";
    const prior = task.checkpoint.integration.reconciliation;
    const stalled = {
      ...prior,
      noProgressAttempts: prior.noProgressAttempts + 1,
      consecutiveNoProgressAttempts: prior.consecutiveNoProgressAttempts + 1
    };
    if (task.status !== "blocked") task = await move("blocked", { message: `integration reconciliation blocked: ${message}`, error: message });
    task = await save({
      blocker: `integration reconciliation blocked: ${message}`,
      interruption: { phase: "integration-reconciliation", at, reason: message, lastTurnId: active.turnId || "" },
      activeTurn: ambiguous ? { ...active, state: "ambiguous", ambiguity: message } : {},
      integration: { status: "revision", error: message, reconciliation: stalled },
      lastAction: "integration reconciliation failed; retryable"
    }, { message: `integration reconciliation blocked: ${message}`, error: message });
    await emit("integration-revision", { reason: message, phase: "integration-reconciliation", retryable: true });
    return { claimed: true, taskId: task.taskId, status: task.status, error: message, queue: await queueDepth(worldRoot) };
  };

  try {
    const original = task.checkpoint.workspace;
    const prior = task.checkpoint.integration.reconciliation;
    const branch = text(integrationBranch) || "automation/roadmap";
    const requestedWorktree = prior.worktreePath
      || `${original.worktreePath || path.join(worldRoot, "holding", "work", "worktrees", task.taskId)}-reconciliation`;
    workspace = await workspaceFactory({
      repositoryRoot,
      worldRoot,
      taskId: `${task.taskId}-reconciliation`,
      baseRevision: "",
      baseRef: branch,
      worktreePath: requestedWorktree
    });
    const reconciliation = {
      ...prior,
      worktreePath: workspace.worktreePath,
      taskBaseRevision: prior.taskBaseRevision || original.baseRevision,
      taskCommit: prior.taskCommit || task.checkpoint.implementation.commit,
      attempts: prior.attempts + 1
    };
    await save({
      integration: {
        branch,
        baseRevision: workspace.baseRevision,
        status: "reconciliation",
        reconciliation
      },
      workspace: { repository: workspace.repository, worktreePath: workspace.worktreePath, baseRevision: workspace.baseRevision, branch, mode: workspace.mode },
      lastAction: "integration reconciliation started"
    });
    await emit("integration-started", {
      phase: "integration-reconciliation",
      branch,
      baseRevision: workspace.baseRevision,
      worktree: workspace.worktreePath,
      attempt: reconciliation.attempts
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
        const error = new Error(preflight.reason || "integration reconciliation preflight failed");
        error.kind = "infrastructure";
        error.preflight = preflight;
        throw error;
      }
      await save({ executionPreflight: {
        status: preflight.status || "ready",
        check: preflight.check || "",
        reason: preflight.reason || "",
        observedAt: preflight.observedAt || "",
        worktree: preflight.worktree || workspace.worktreePath,
        threadSandbox,
        turnSandbox: turnSandboxPolicy?.type || "workspaceWrite"
      } });
    }

    if (reconciliation.consecutiveNoProgressAttempts >= Math.max(1, Number(maxNoProgressAttempts) || 1)) {
      if (!managerClient) {
        managerClient = await appServerFactory({ role: "manager", model: roleSettings.manager.model, reasoningEffort: roleSettings.manager.reasoningEffort, cwd: workspace.worktreePath, approvalPolicy });
        startedClients.push(managerClient);
      }
      const managerThreadId = await openThread(managerClient, {
        role: "manager",
        threadId: reconciliation.managerThreadId || task.checkpoint.manager.threadId,
        cwd: workspace.worktreePath,
        config: roleSettings.manager,
        approvalPolicy,
        sandbox: threadSandbox
      });
      await save({ integration: { reconciliation: { managerThreadId } } });
      const identity = `pyash-${task.taskId}-integration-convergence-${reconciliation.attempts}`;
      const result = await runCodexTurn(managerClient, {
        threadId: managerThreadId,
        cwd: workspace.worktreePath,
        model: roleSettings.manager.model,
        reasoningEffort: roleSettings.manager.reasoningEffort,
        approvalPolicy,
        sandboxPolicy: typeof turnSandboxPolicy === "function" ? turnSandboxPolicy({ worktreePath: workspace.worktreePath }) : turnSandboxPolicy,
        timeoutMs: turnTimeoutMs,
        requestIdentity: identity,
        input: [{ type: "text", text: promptIntegrationConvergence(task, task.checkpoint, reconciliation) }]
      });
      const convergence = parseConvergence(resultText(result));
      const nextStatus = convergence.decision === "BLOCK" ? "integration-blocked" : "revision";
      const blocker = convergence.decision === "BLOCK"
        ? `human decision required: integration reconciliation semantic blocker: ${convergence.rationale}`
        : `integration reconciliation requires focused correction: ${convergence.correction || convergence.rationale}`;
      await save({
        integration: {
          status: nextStatus,
          error: blocker,
          reconciliation: {
            lastReviewDecision: convergence.decision,
            lastReviewExplanation: convergence.rationale,
            revisionInstructions: convergence.correction,
            consecutiveNoProgressAttempts: 0
          }
        },
        blocker,
        lastAction: nextStatus === "revision" ? "integration convergence correction recorded" : "integration reconciliation blocked by Sol"
      }, { message: blocker, error: "" });
      if (task.status !== "blocked") task = await move("blocked", { message: blocker, error: "" });
      await emit("integration-convergence", { decision: convergence.decision, correction: convergence.correction, reason: convergence.rationale, retryable: nextStatus === "revision" });
      return { claimed: true, taskId: task.taskId, status: task.status, message: blocker, queue: await queueDepth(worldRoot) };
    }

    const attempt = reconciliation.attempts;
    if (task.status === "ready") task = await move("planning", { message: "integration reconciliation starting without new Sol planning" });
    if (task.status !== "implementing") task = await move("implementing", { message: "integration reconciliation Luna implementation" });
    const workerThreadId = reconciliation.workerThreadId || "";
    workerClient = await appServerFactory({ role: "worker", model: roleSettings.worker.model, reasoningEffort: roleSettings.worker.reasoningEffort, cwd: workspace.worktreePath, approvalPolicy });
    startedClients.push(workerClient);
    const openedWorkerThread = await openThread(workerClient, {
      role: "worker",
      threadId: workerThreadId,
      cwd: workspace.worktreePath,
      config: roleSettings.worker,
      approvalPolicy,
      sandbox: threadSandbox
    });
    await save({ integration: { reconciliation: { workerThreadId: openedWorkerThread } } });
    await emit("integration-implementation-started", { role: "worker", model: roleSettings.worker.model, threadId: openedWorkerThread, phase: "integration-reconciliation", worktree: workspace.worktreePath });
    const identity = `pyash-${task.taskId}-integration-implementation-${attempt}`;
    const startedAt = iso(nowValue(now));
    await save({ activeTurn: {
      phase: "integration-reconciliation",
      role: "worker",
      threadId: openedWorkerThread,
      turnId: "",
      requestIdentity: identity,
      state: "started",
      startedAt,
      completedAt: "",
      resultCaptured: false,
      ambiguity: "",
      result: { status: "", text: "", diff: "", fileChanges: [], turn: {} }
    }, lastAction: "integration reconciliation Luna turn started" });
    const result = await runTurn(workerClient, {
      threadId: openedWorkerThread,
      cwd: workspace.worktreePath,
      model: roleSettings.worker.model,
      reasoningEffort: roleSettings.worker.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function" ? turnSandboxPolicy({ worktreePath: workspace.worktreePath }) : turnSandboxPolicy,
      timeoutMs: turnTimeoutMs,
      requestIdentity: identity,
      input: [{ type: "text", text: promptIntegration(task, task.checkpoint, workspace, branch, reconciliation) }]
    });
    const completedAt = iso(nowValue(now));
    await save({ activeTurn: {
      phase: "integration-reconciliation",
      role: "worker",
      threadId: openedWorkerThread,
      turnId: result?.turnId || "",
      requestIdentity: identity,
      state: "completed",
      startedAt,
      completedAt,
      resultCaptured: false,
      ambiguity: "",
      result: { status: result?.status || "completed", text: resultText(result), diff: result?.diff || "", fileChanges: uniqueChanges(result?.fileChanges || []), turn: result?.turn || {} }
    }, lastAction: "integration reconciliation Luna turn completed" });
    const report = parseImplementation(resultText(result));
    const evidence = await evidenceFactory({ worktreePath: workspace.worktreePath });
    const changedFiles = [...new Set([
      ...report.changedFiles,
      ...changedFilesFromResult(result, workspace.worktreePath),
      ...(evidence?.changedFiles || [])
    ])];
    const previousHistory = reconciliation.passHistory.filter((entry) => entry.state === "completed");
    const pass = previousHistory.length + 1;
    const progressEntry = classifyImplementationPass({
      pass,
      at: completedAt,
      turn: {
        phase: "integration-reconciliation",
        state: "completed",
        turnId: result?.turnId || "",
        requestIdentity: identity,
        result: { text: resultText(result), diff: result?.diff || "", fileChanges: uniqueChanges(result?.fileChanges || []) }
      },
      report,
      evidence,
      previousHistory,
      baseRevision: workspace.baseRevision
    });
    const progress = summarizeImplementationProgress([...reconciliation.passHistory, progressEntry]);
    const conflictsResolved = reconciliation.conflictsResolved
      + (/conflict(?:s)?\s+(?:were\s+)?resolved|resolved\s+conflict/iu.test(resultText(result)) ? 1 : 0);
    const nextReconciliation = {
      ...reconciliation,
      taskCommit: evidence?.revision || reconciliation.taskCommit,
      summary: report.summary,
      changedFiles,
      tests: report.tests,
      diff: evidence?.diff || result?.diff || "",
      conflictsResolved,
      passHistory: progress.passHistory,
      materialAttempts: reconciliation.materialAttempts + (progressEntry.material ? 1 : 0),
      noProgressAttempts: reconciliation.noProgressAttempts + (progressEntry.material ? 0 : 1),
      consecutiveNoProgressAttempts: progress.consecutiveNoProgressPasses,
      lastMaterialAt: progress.lastMaterialProgressAt || reconciliation.lastMaterialAt,
      revisionInstructions: ""
    };
    await save({
      activeTurn: {},
      turnHistory: [...task.checkpoint.turnHistory, { ...task.checkpoint.activeTurn, resultCaptured: true }],
      integration: { reconciliation: nextReconciliation },
      interruption: {},
      lastAction: "integration reconciliation evidence captured"
    }, { message: report.summary, error: "" });
    await emit("integration-implementation-completed", {
      role: "worker",
      model: roleSettings.worker.model,
      threadId: openedWorkerThread,
      summary: report.summary,
      changedFiles,
      tests: report.tests,
      material: progressEntry.material,
      materialReasons: progressEntry.materialReasons,
      worktree: workspace.worktreePath
    });

    if (!report.reviewReady || !evidence?.revision || evidence.revision === workspace.baseRevision) {
      const blocker = `integration reconciliation requires more implementation: ${report.blockers || "no review-ready commit was reported"}`;
      if (task.status !== "blocked") task = await move("blocked", { message: blocker, error: "" });
      await save({
        blocker,
        integration: { status: "revision", error: blocker, reconciliation: nextReconciliation },
        lastAction: "integration reconciliation checkpoint; more Luna work required"
      }, { message: blocker, error: "" });
      await emit("integration-revision", { reason: blocker, material: progressEntry.material, retryable: true });
      return { claimed: true, taskId: task.taskId, status: task.status, message: blocker, queue: await queueDepth(worldRoot) };
    }

    if (task.status !== "reviewing") task = await move("reviewing", { message: "reconciled result ready for Sol review", error: "" });
    managerClient = await appServerFactory({ role: "manager", model: roleSettings.manager.model, reasoningEffort: roleSettings.manager.reasoningEffort, cwd: workspace.worktreePath, approvalPolicy });
    startedClients.push(managerClient);
    const managerThreadId = await openThread(managerClient, {
      role: "manager",
      threadId: nextReconciliation.managerThreadId || task.checkpoint.manager.threadId,
      cwd: workspace.worktreePath,
      config: roleSettings.manager,
      approvalPolicy,
      sandbox: threadSandbox
    });
    const reviewCount = nextReconciliation.reviewCount + 1;
    await save({ integration: { reconciliation: { managerThreadId, reviewCount } }, lastAction: "integration reconciliation Sol review started" });
    await emit("integration-review-started", { role: "manager", model: roleSettings.manager.model, threadId: managerThreadId, phase: "integration-review" });
    const reviewIdentity = `pyash-${task.taskId}-integration-review-${reviewCount}`;
    const review = parseReview(resultText(await runTurn(managerClient, {
      threadId: managerThreadId,
      cwd: workspace.worktreePath,
      model: roleSettings.manager.model,
      reasoningEffort: roleSettings.manager.reasoningEffort,
      approvalPolicy,
      sandboxPolicy: typeof turnSandboxPolicy === "function" ? turnSandboxPolicy({ worktreePath: workspace.worktreePath }) : turnSandboxPolicy,
      timeoutMs: turnTimeoutMs,
      requestIdentity: reviewIdentity,
      input: [{ type: "text", text: promptIntegrationReview(task, task.checkpoint, workspace, branch, nextReconciliation) }]
    })));
    await emit("integration-review-completed", { role: "manager", model: roleSettings.manager.model, threadId: managerThreadId, decision: review.decision, explanation: review.explanation, correction: review.revisionInstructions });
    const reviewBlocker = review.decision === "BLOCK"
      ? `human decision required: integration reconciliation semantic blocker: ${review.explanation}`
      : `integration reconciliation requires correction: ${review.revisionInstructions || review.explanation}`;
    if (review.decision !== "ACCEPT") {
      if (task.status !== "blocked") task = await move("blocked", { message: reviewBlocker, error: "" });
      await save({
        blocker: reviewBlocker,
        review: { decision: review.decision, explanation: review.explanation, revisionInstructions: review.revisionInstructions },
        integration: {
          status: review.decision === "BLOCK" ? "integration-blocked" : "revision",
          error: reviewBlocker,
          reconciliation: { lastReviewDecision: review.decision, lastReviewExplanation: review.explanation, revisionInstructions: review.revisionInstructions }
        },
        lastAction: review.decision === "BLOCK" ? "integration reconciliation blocked by Sol" : "integration reconciliation revision requested"
      }, { message: reviewBlocker, error: "" });
      await emit(review.decision === "BLOCK" ? "integration-blocked" : "integration-revision", { reason: reviewBlocker, correction: review.revisionInstructions, retryable: review.decision !== "BLOCK" });
      return { claimed: true, taskId: task.taskId, status: task.status, message: reviewBlocker, queue: await queueDepth(worldRoot) };
    }
    const integrated = await integrateAcceptedWork({
      repositoryRoot,
      worktreePath: workspace.worktreePath,
      baseRevision: workspace.baseRevision,
      branch,
      push: pushIntegration,
      pushRemotes: integrationRemotes,
      now
    });
    task = await save({
      review: { decision: "ACCEPT", explanation: review.explanation, revisionInstructions: "" },
      integration: { ...integrated, reconciliation: { lastReviewDecision: "ACCEPT", lastReviewExplanation: review.explanation } },
      blocker: "",
      interruption: {},
      lastAction: "integration reconciliation accepted and integrated"
    }, { error: "", message: review.explanation });
    task = await move("accepted", { message: review.explanation, error: "" });
    await save({ blocker: "", lastAction: "integration reconciliation accepted and integrated" }, { error: "" });
    await ackWorkTaskSuccess(worldRoot, { runtimePath: claimed.path });
    await emit("accepted", { decision: "ACCEPT", explanation: review.explanation, integration: integrated, worktree: workspace.worktreePath });
    return { claimed: true, taskId: task.taskId, status: task.status, message: review.explanation, integration: integrated, queue: await queueDepth(worldRoot) };
  } catch (error) {
    return fail(error);
  } finally {
    for (const client of startedClients) await closeClient(client);
  }
}
