import {
  readCodexThread,
  resumeCodexThread,
  spawnCodexAppServer
} from "../codex/app_server.mjs";
import { buildWorkTask, transitionWorkTask } from "./contract.mjs";
import {
  findWorkTaskEnvelope,
  updateWorkTaskEnvelope
} from "./queue.mjs";
import { mergeWorkCheckpoint } from "./checkpoint.mjs";
import { listWorkTasks } from "./operator.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "./status.mjs";
import { collectGitEvidence } from "./workspace.mjs";

export const TURN_LIVENESS = Object.freeze({
  LIVE: "LIVE",
  STALE: "STALE",
  COMPLETED_UNRECONCILED: "COMPLETED_UNRECONCILED",
  AMBIGUOUS: "AMBIGUOUS"
});

export const DEFAULT_LIVENESS_EVIDENCE_WINDOW_MS = 30 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function asDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function iso(value) {
  const date = asDate(value);
  return date ? date.toISOString() : "";
}

function object(value) {
  return value && typeof value === "object" ? value : {};
}

function threadStatus(thread) {
  const status = object(thread?.status);
  return text(status.type || thread?.status).toLowerCase();
}

function remoteTurns(thread) {
  return Array.isArray(thread?.turns) ? thread.turns : [];
}

function latestRemoteTurn(thread, turnId = "") {
  const turns = remoteTurns(thread);
  if (turnId) {
    const matching = turns.find((turn) => text(turn?.id) === turnId);
    if (matching) return matching;
  }
  return turns.at(-1) || null;
}

function remoteTurnState(turn) {
  return text(turn?.status).toLowerCase();
}

function isTerminalRemoteTurn(state) {
  return ["completed", "interrupted", "failed"].includes(state);
}

function processAlive(pid, probe = null) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return null;
  if (typeof probe === "function") return Boolean(probe(value));
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function recentEvidenceAt({ activeTurn = {}, thread = null, remoteTurn = null } = {}) {
  const candidates = [
    activeTurn.lastActivityAt,
    thread?.updatedAt,
    thread?.recencyAt,
    remoteTurn?.updatedAt,
    remoteTurn?.completedAt
  ].map(asDate).filter(Boolean);
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((date) => date.getTime())));
}

function hasWriterSignal(activeTurn, blocker, remoteState) {
  return /active writer|thread .* writer|already .* writer/iu.test(
    `${text(activeTurn?.ambiguity)} ${text(blocker)} ${text(remoteState)}`
  );
}

function hasCompletedLocalResult(activeTurn) {
  return activeTurn?.state === "completed"
    && activeTurn?.resultCaptured !== true
    && Boolean(activeTurn?.result?.text || activeTurn?.result?.diff || activeTurn?.result?.fileChanges?.length);
}

export function classifyTurnLiveness({
  activeTurn = {},
  blocker = "",
  localOwnerAlive = null,
  appServerAlive = null,
  remoteState = "",
  remoteTurn = null,
  remoteUpdatedAt = "",
  remoteError = "",
  now = new Date(),
  staleEvidenceMs = DEFAULT_LIVENESS_EVIDENCE_WINDOW_MS
} = {}) {
  const current = asDate(now) || new Date();
  const state = text(remoteState).toLowerCase();
  const turnState = remoteTurnState(remoteTurn);
  const completed = hasCompletedLocalResult(activeTurn)
    || (activeTurn?.turnId && text(remoteTurn?.id) === text(activeTurn.turnId) && turnState === "completed");
  if (completed) return TURN_LIVENESS.COMPLETED_UNRECONCILED;
  if (localOwnerAlive === true || appServerAlive === true || state === "active" || turnState === "inprogress") {
    return TURN_LIVENESS.LIVE;
  }

  const evidence = recentEvidenceAt({
    activeTurn,
    thread: { updatedAt: remoteUpdatedAt },
    remoteTurn
  });
  const evidenceAt = evidence || asDate(activeTurn.lastActivityAt) || asDate(activeTurn.startedAt);
  const recent = evidenceAt
    ? current.getTime() - evidenceAt.getTime() < Math.max(1, Number(staleEvidenceMs) || DEFAULT_LIVENESS_EVIDENCE_WINDOW_MS)
    : false;
  const writer = hasWriterSignal(activeTurn, blocker, state) || Boolean(remoteError);

  if (["idle", "notloaded", "systemerror"].includes(state)
    && (!turnState || isTerminalRemoteTurn(turnState))) {
    // A terminal provider turn is stronger evidence than its recency: the
    // writer has stopped, even when the interruption was just observed.
    return turnState && isTerminalRemoteTurn(turnState)
      ? TURN_LIVENESS.STALE
      : recent ? TURN_LIVENESS.AMBIGUOUS : TURN_LIVENESS.STALE;
  }
  if (state === "writer-conflict" && !recent) return TURN_LIVENESS.STALE;
  if (writer && !recent && state === "error") return TURN_LIVENESS.AMBIGUOUS;
  return TURN_LIVENESS.AMBIGUOUS;
}

function livenessReason(classification, {
  localOwnerAlive,
  appServerAlive,
  remoteState,
  remoteTurnState: turnState,
  remoteError,
  worktreeState
} = {}) {
  if (classification === TURN_LIVENESS.LIVE) {
    return localOwnerAlive === true
      ? "local App Server owner is alive"
      : appServerAlive === true
        ? "local App Server process is alive"
      : `Codex reports an active thread${turnState ? ` and ${turnState} turn` : ""}`;
  }
  if (classification === TURN_LIVENESS.COMPLETED_UNRECONCILED) {
    return "a completed turn result or outcome exists without a captured task transition";
  }
  if (classification === TURN_LIVENESS.STALE) {
    return `no live writer evidence remains; remote=${remoteState || "unknown"}${worktreeState ? `; ${worktreeState}` : ""}`;
  }
  return remoteError
    ? `liveness evidence is incomplete: ${remoteError}`
    : "liveness evidence does not establish either a live or abandoned writer";
}

function roleForTask(task) {
  const active = task?.checkpoint?.activeTurn || {};
  if (active.role) return text(active.role).toLowerCase();
  const phase = text(active.phase || task?.checkpoint?.interruption?.phase || task?.status).toLowerCase();
  return phase === "planning" || phase === "reviewing" ? "manager" : "worker";
}

function threadForTask(task, role) {
  const checkpoint = task?.checkpoint || {};
  return text(role === "manager"
    ? checkpoint.manager?.threadId || task?.solThreadId || checkpoint.activeTurn?.threadId
    : checkpoint.worker?.threadId || task?.lunaThreadId || checkpoint.activeTurn?.threadId);
}

function phaseForTask(task) {
  const phase = text(task?.checkpoint?.activeTurn?.phase
    || task?.checkpoint?.interruption?.phase
    || task?.status).toLowerCase();
  return ["planning", "implementing", "reviewing", "revision"].includes(phase)
    ? phase
    : text(task?.checkpoint?.implementation?.commit) ? "reviewing" : "implementing";
}

function preservedEvidence(task, evidence = {}) {
  const checkpoint = task?.checkpoint || {};
  const saved = checkpoint.interruption?.workspaceEvidence || {};
  const implementation = checkpoint.implementation || {};
  return Boolean(
    text(implementation.commit)
    || implementation.changedFiles?.length
    || text(implementation.diff)
    || implementation.tests?.length
    || saved.changedFiles?.length
    || text(saved.diff)
    || evidence.changedFiles?.length
    || text(evidence.diff)
  );
}

function safeContinuation(task, evidence) {
  const phase = phaseForTask(task);
  if (phase === "reviewing") return Boolean(
    text(task?.checkpoint?.implementation?.commit)
    || text(task?.checkpoint?.interruption?.workspaceEvidence?.revision)
    || text(evidence?.revision)
  );
  return preservedEvidence(task, evidence);
}

function appendAbandonedTurn(turnHistory, activeTurn, reason) {
  if (!activeTurn?.state) return turnHistory;
  const exists = turnHistory.some((entry) => (
    text(entry.threadId) === text(activeTurn.threadId)
    && text(entry.turnId) === text(activeTurn.turnId)
    && text(entry.requestIdentity) === text(activeTurn.requestIdentity)
    && entry.state === "abandoned"
  ));
  if (exists) return turnHistory;
  return [...turnHistory, {
    ...activeTurn,
    state: "abandoned",
    ambiguity: text(activeTurn.ambiguity) || reason
  }];
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

async function inspectRemoteThread({
  threadId,
  role,
  task,
  appServerFactory,
  repositoryRoot,
  roleConfig,
  approvalPolicy,
  threadSandbox
} = {}) {
  if (!threadId) return { remoteState: "unknown", remoteTurn: null, remoteError: "no persisted thread id" };
  let client = null;
  let thread = null;
  let remoteError = "";
  try {
    const settings = roleConfig?.[role] || {};
    client = await appServerFactory({
      role,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      cwd: task?.checkpoint?.workspace?.worktreePath || repositoryRoot,
      threadId,
      approvalPolicy
    });
    try {
      const read = await readCodexThread(client, threadId, { includeTurns: true });
      thread = read?.thread || read;
    } catch (error) {
      remoteError = text(error?.message || error);
    }
    let resumed = null;
    try {
      resumed = await resumeCodexThread(client, threadId, {
        cwd: task?.checkpoint?.workspace?.worktreePath || repositoryRoot,
        model: roleConfig?.[role]?.model,
        reasoningEffort: roleConfig?.[role]?.reasoningEffort,
        approvalPolicy,
        sandbox: threadSandbox,
        excludeTurns: true
      });
    } catch (error) {
      const message = text(error?.message || error);
      remoteError = remoteError || message;
      if (/active writer|thread .* writer|already .* writer/iu.test(message)) {
        return {
          thread,
          remoteState: "writer-conflict",
          remoteTurn: latestRemoteTurn(thread, task?.checkpoint?.activeTurn?.turnId),
          remoteError: message
        };
      }
    }
    const resumedThread = resumed?.thread || resumed;
    if (resumedThread && thread) {
      thread = {
        ...thread,
        ...resumedThread,
        turns: Array.isArray(resumedThread.turns) && resumedThread.turns.length
          ? resumedThread.turns
          : thread.turns
      };
    } else {
      thread = resumedThread || thread;
    }
    return {
      thread,
      remoteState: threadStatus(thread) || "unknown",
      remoteTurn: latestRemoteTurn(thread, task?.checkpoint?.activeTurn?.turnId),
      remoteError
    };
  } finally {
    try {
      await client?.close?.();
    } catch {}
  }
}

async function persistTask(worldRoot, task) {
  const envelope = await findWorkTaskEnvelope(worldRoot, task.taskId, { owner: task.owner });
  if (envelope) await updateWorkTaskEnvelope(worldRoot, envelope, task);
  else await writeWorkTaskStatus(worldRoot, task);
  return task;
}

export async function reconcileWorkTaskTurn(worldRoot, taskId, {
  repositoryRoot = process.cwd(),
  appServerFactory = ({}) => spawnCodexAppServer({}),
  evidenceFactory = collectGitEvidence,
  roleConfig = {},
  approvalPolicy = "never",
  threadSandbox = "workspace-write",
  processProbe = null,
  now = () => new Date(),
  staleEvidenceMs = DEFAULT_LIVENESS_EVIDENCE_WINDOW_MS
} = {}) {
  const current = await readWorkTaskStatus(worldRoot, taskId);
  if (!current || ["accepted", "failed"].includes(current.status)) return null;
  const activeTurn = current.checkpoint?.activeTurn || {};
  const blocker = text(current.checkpoint?.blocker || current.message || current.error);
  if (!activeTurn.state && !/active writer|thread .* writer|turn timeout/iu.test(blocker)) return null;
  const role = roleForTask(current);
  const threadId = threadForTask(current, role);
  const localOwnerPid = Number(activeTurn.localOwnerPid || 0);
  const appServerPid = Number(activeTurn.appServerPid || 0);
  const localOwnerAlive = processAlive(localOwnerPid, processProbe);
  const appServerAlive = processAlive(appServerPid, processProbe);
  let worktreeEvidence = current.checkpoint?.interruption?.workspaceEvidence || {};
  const worktreePath = text(current.checkpoint?.workspace?.worktreePath);
  if (worktreePath) {
    try {
      worktreeEvidence = {
        ...worktreeEvidence,
        ...(await evidenceFactory({ worktreePath }))
      };
    } catch (error) {
      worktreeEvidence = {
        ...worktreeEvidence,
        error: text(error?.message || error)
      };
    }
  }
  const remote = await inspectRemoteThread({
    threadId,
    role,
    task: current,
    appServerFactory,
    repositoryRoot,
    roleConfig,
    approvalPolicy,
    threadSandbox
  });
  const latestTurn = remote.remoteTurn;
  const classification = classifyTurnLiveness({
    activeTurn,
    blocker,
    localOwnerAlive,
    appServerAlive,
    remoteState: remote.remoteState,
    remoteTurn: latestTurn,
    remoteUpdatedAt: remote.thread?.updatedAt || remote.thread?.recencyAt || "",
    remoteError: remote.remoteError,
    now,
    staleEvidenceMs
  });
  const safeToResume = classification === TURN_LIVENESS.STALE
    && safeContinuation(current, worktreeEvidence);
  const at = iso(typeof now === "function" ? now() : now) || new Date().toISOString();
  const reconciliation = {
    checkedAt: at,
    threadId,
    turnId: text(activeTurn.turnId || latestTurn?.id),
    classification,
    lastActivityAt: iso(recentEvidenceAt({
      activeTurn,
      thread: remote.thread,
      remoteTurn: latestTurn
    })) || text(activeTurn.lastActivityAt),
    localOwnerPid,
    localOwnerAlive,
    appServerPid,
    appServerAlive,
    remoteState: remote.remoteState,
    remoteTurnState: remoteTurnState(latestTurn),
    remoteSessionId: text(remote.thread?.sessionId),
    safeToResume,
    worktreeState: text(
      worktreeEvidence.status || worktreeEvidence.diff || worktreeEvidence.changedFiles?.length
        ? "evidence captured"
        : "not inspected"
    ),
    reason: livenessReason(classification, {
      localOwnerAlive,
      appServerAlive,
      remoteState: remote.remoteState,
      remoteTurnState: remoteTurnState(latestTurn),
      remoteError: remote.remoteError,
      worktreeState: worktreeEvidence.status || worktreeEvidence.diff || worktreeEvidence.changedFiles?.length
        ? "worktree evidence captured"
        : ""
    })
  };
  let next = buildWorkTask({
    ...current,
    checkpoint: mergeWorkCheckpoint(current.checkpoint, {
      turnReconciliation: reconciliation,
      interruption: {
        workspaceEvidence: worktreeEvidence
      }
    })
  });
  let replacementThread = false;
  if (classification === TURN_LIVENESS.STALE) {
    if (safeToResume) {
      const phase = phaseForTask(current);
      const oldThreadId = threadId;
      const abandonedTurn = activeTurn.state
        ? { ...activeTurn, threadId: oldThreadId || activeTurn.threadId }
        : null;
      const turnHistory = appendAbandonedTurn(current.checkpoint.turnHistory, abandonedTurn, reconciliation.reason);
      const nextCheckpoint = {
        turnReconciliation: reconciliation,
        activeTurn: {},
        blocker: "",
        interruption: {
          phase,
          at,
          reason: `stale Codex ownership reconciled; continuing ${phase}`,
          lastTurnId: text(activeTurn.turnId || current.checkpoint.interruption?.lastTurnId),
          workspaceEvidence: worktreeEvidence
        },
        turnHistory,
        resumeCount: current.checkpoint.resumeCount + 1,
        lastAction: `stale ${role} writer reconciled; safe continuation available`
      };
      if (role === "manager") {
        nextCheckpoint.manager = {
          threadId: "",
          previousThreadIds: unique([
            ...(current.checkpoint.manager?.previousThreadIds || []),
            oldThreadId
          ])
        };
        next = buildWorkTask({
          ...transitionWorkTask(current, phase, {
            now: typeof now === "function" ? now() : now,
            message: `stale ${role} writer reconciled; safe continuation available`,
            error: ""
          }),
          solThreadId: "",
          message: `stale ${role} writer reconciled; safe continuation available`,
          error: "",
          checkpoint: mergeWorkCheckpoint(current.checkpoint, nextCheckpoint)
        });
      } else {
        nextCheckpoint.worker = {
          threadId: "",
          previousThreadIds: unique([
            ...(current.checkpoint.worker?.previousThreadIds || []),
            oldThreadId
          ])
        };
        next = buildWorkTask({
          ...transitionWorkTask(current, phase, {
            now: typeof now === "function" ? now() : now,
            message: `stale ${role} writer reconciled; safe continuation available`,
            error: ""
          }),
          lunaThreadId: "",
          message: `stale ${role} writer reconciled; safe continuation available`,
          error: "",
          checkpoint: mergeWorkCheckpoint(current.checkpoint, nextCheckpoint)
        });
      }
      replacementThread = Boolean(oldThreadId);
    } else {
      next = buildWorkTask({
        ...next,
        checkpoint: mergeWorkCheckpoint(next.checkpoint, {
          lastAction: "stale turn confirmed but preserved evidence is insufficient for automatic replay"
        })
      });
    }
  } else if (classification === TURN_LIVENESS.COMPLETED_UNRECONCILED
    && activeTurn.state === "completed"
    && activeTurn.resultCaptured !== true) {
    const phase = phaseForTask(current);
    next = buildWorkTask({
      ...transitionWorkTask(current, phase, {
        now: typeof now === "function" ? now() : now,
        message: "completed Codex result reconciled from durable checkpoint",
        error: ""
      }),
      message: "completed Codex result reconciled from durable checkpoint",
      error: "",
      checkpoint: mergeWorkCheckpoint(next.checkpoint, {
        lastAction: "completed turn result awaits normal checkpoint capture"
      })
    });
  }
  await persistTask(worldRoot, next);
  return {
    task: next,
    classification,
    role,
    threadId,
    turnId: reconciliation.turnId,
    localOwnerAlive,
    appServerAlive,
    remoteState: remote.remoteState,
    remoteTurnState: remoteTurnState(latestTurn),
    worktreeEvidence,
    safeToResume,
    replacementThread,
    reason: reconciliation.reason,
    reconciliation
  };
}

export async function reconcileOperationalWorkTasks(worldRoot, {
  owner = "",
  ...options
} = {}) {
  const tasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  const candidates = tasks
    .filter((task) => !owner || task.owner === owner)
    .filter((task) => !["accepted", "failed"].includes(task.status))
    .filter((task) => task.workSpec?.archived !== true)
    .filter((task) => {
      const checkpoint = task.checkpoint || {};
      const reason = `${text(checkpoint.blocker)} ${text(task.message)} ${text(task.error)}`;
      return Boolean(checkpoint.activeTurn?.state)
        || /active writer|thread .* writer|turn timeout/iu.test(reason);
    });
  const results = [];
  for (const task of candidates) {
    const result = await reconcileWorkTaskTurn(worldRoot, task.taskId, options);
    if (result) results.push(result);
  }
  return results;
}
