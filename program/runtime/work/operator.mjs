import { buildWorkTask, transitionWorkTask } from "./contract.mjs";
import {
  ackWorkTaskTerminalFailure,
  enqueueWorkTask,
  findWorkTaskEnvelope,
  updateWorkTaskEnvelope
} from "./queue.mjs";
import { buildWorkCheckpoint, mergeWorkCheckpoint } from "./checkpoint.mjs";
import {
  listWorkTaskStatuses,
  readWorkTaskStatus,
  writeWorkTaskStatus
} from "./status.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function at(now) {
  return typeof now === "function" ? now() : now || new Date();
}

function iso(now) {
  const value = at(now);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

async function mutateTask(worldRoot, taskId, mutate) {
  const envelope = await findWorkTaskEnvelope(worldRoot, taskId);
  const stored = await readWorkTaskStatus(worldRoot, taskId);
  const current = stored || envelope?.task;
  if (!current) throw new Error(`work task not found: ${taskId}`);
  const next = buildWorkTask(await mutate(buildWorkTask(current)));
  if (envelope) await updateWorkTaskEnvelope(worldRoot, envelope, next);
  else await writeWorkTaskStatus(worldRoot, next);
  return next;
}

export async function addWorkTask(worldRoot, input = {}) {
  return enqueueWorkTask(worldRoot, {
    ...input,
    status: "ready",
    queuedAt: input.queuedAt || new Date().toISOString()
  });
}

export async function listWorkTasks(worldRoot, options = {}) {
  return listWorkTaskStatuses(worldRoot, options);
}

export async function showWorkTask(worldRoot, taskId) {
  const task = await readWorkTaskStatus(worldRoot, taskId);
  if (!task) throw new Error(`work task not found: ${taskId}`);
  return task;
}

export async function archiveWorkTask(worldRoot, taskId, reason, {
  supersededBy = "",
  now = new Date()
} = {}) {
  const explanation = text(reason);
  if (!explanation) throw new Error("archive reason is required");
  return mutateTask(worldRoot, taskId, (current) => {
    if (current.status === "accepted") {
      return {
        ...current,
        workSpec: {
          ...current.workSpec,
          archived: true,
          lifecycle: "superseded",
          archiveReason: explanation,
          archivedAt: iso(now),
          supersededBy: text(supersededBy)
        },
        checkpoint: mergeWorkCheckpoint(current.checkpoint, {
          lastAction: `archived: ${explanation}`
        })
      };
    }
    const next = current.status === "blocked" ? current : transitionWorkTask(current, "blocked", {
      now,
      message: `archived: ${explanation}`,
      error: ""
    });
    return {
      ...next,
      message: `archived: ${explanation}`,
      error: "",
      workSpec: {
        ...next.workSpec,
        archived: true,
        lifecycle: "superseded",
        archiveReason: explanation,
        archivedAt: iso(now),
        supersededBy: text(supersededBy)
      },
      checkpoint: mergeWorkCheckpoint(next.checkpoint, {
        blocker: "",
        lastAction: `archived: ${explanation}`
      })
    };
  });
}

export async function blockWorkTask(worldRoot, taskId, reason, { now = new Date() } = {}) {
  const message = text(reason);
  if (!message) throw new Error("block reason is required");
  return mutateTask(worldRoot, taskId, (current) => {
    if (current.status === "accepted") throw new Error("accepted work tasks are terminal");
    const next = current.status === "blocked"
      ? current
      : transitionWorkTask(current, "blocked", { now, message, error: message });
    return {
      ...next,
      message,
      error: message,
      checkpoint: mergeWorkCheckpoint(next.checkpoint, {
        blocker: message,
        interruption: {
          phase: current.status,
          at: iso(now),
          reason: message,
          lastTurnId: current.checkpoint.activeTurn.turnId || current.checkpoint.interruption.lastTurnId
        },
        lastAction: "human blocked task"
      })
    };
  });
}

export async function resumeWorkTask(worldRoot, taskId, humanResponse, { now = new Date() } = {}) {
  const response = text(humanResponse);
  if (!response) throw new Error("resume context is required");
  return mutateTask(worldRoot, taskId, (current) => {
    if (current.status === "accepted") throw new Error("accepted work tasks are terminal");
    if (current.status !== "blocked" && current.status !== "usage-limited") {
      throw new Error(`work task is not resumable from ${current.status}`);
    }
    const next = transitionWorkTask(current, "ready", {
      now,
      message: "human resumed task"
    });
    const active = current.checkpoint.activeTurn;
    const history = active.state
      ? [...current.checkpoint.turnHistory, { ...active, state: "abandoned", resultCaptured: true }]
      : current.checkpoint.turnHistory;
    return {
      ...next,
      contextText: [current.contextText, `Human response: ${response}`].filter(Boolean).join("\n"),
      message: "human resumed task",
      error: "",
      checkpoint: mergeWorkCheckpoint(next.checkpoint, {
        activeTurn: buildWorkCheckpoint().activeTurn,
        turnHistory: history,
        humanResponse: response,
        resumeCount: current.checkpoint.resumeCount + 1,
        lastAction: "human resumed task"
      })
    };
  });
}

export async function failWorkTask(worldRoot, taskId, reason, { now = new Date() } = {}) {
  const message = text(reason) || "cancelled by operator";
  const next = await mutateTask(worldRoot, taskId, (current) => {
    if (current.status === "accepted") throw new Error("accepted work tasks are terminal");
    const transitioned = current.status === "failed"
      ? current
      : transitionWorkTask(current, "failed", { now, message, error: message });
    return {
      ...transitioned,
      message,
      error: message,
      checkpoint: mergeWorkCheckpoint(transitioned.checkpoint, {
        blocker: message,
        lastAction: "operator failed task"
      })
    };
  });
  const envelope = await findWorkTaskEnvelope(worldRoot, taskId);
  if (envelope) await ackWorkTaskTerminalFailure(worldRoot, { runtimePath: envelope.path });
  return next;
}
