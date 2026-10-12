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

export async function reconcileCompletedSplitParent(worldRoot, taskId, {
  capabilityCommit,
  baselineCommit,
  reason = "completed capability reconciled on the autonomous integration baseline",
  now = new Date()
} = {}) {
  const completedCommit = text(capabilityCommit);
  const integratedRevision = text(baselineCommit);
  if (!completedCommit || !integratedRevision) {
    throw new Error("split-parent reconciliation requires capability and baseline commits");
  }
  const explanation = text(reason);
  if (!explanation) throw new Error("split-parent reconciliation reason is required");

  return mutateTask(worldRoot, taskId, async (current) => {
    const followUpTaskId = text(current.workSpec?.splitFollowUpTaskId);
    const followUp = followUpTaskId
      ? await readWorkTaskStatus(worldRoot, followUpTaskId)
      : null;
    if (current.status !== "blocked"
      || current.workSpec?.lifecycle !== "split-parent"
      || current.checkpoint?.convergence?.decision !== "SPLIT"
      || !followUp?.workSpec?.archived) {
      throw new Error(`work task is not a safely completed split parent: ${taskId}`);
    }

    const completedAt = iso(now);
    const reconciliation = current.checkpoint.integration.reconciliation;
    return {
      ...current,
      status: "accepted",
      previousStatus: current.status,
      finishedAt: completedAt,
      message: `accepted: ${explanation}`,
      result: "accepted",
      error: "",
      workSpec: {
        ...current.workSpec,
        lifecycle: "completed-split-parent",
        completedCapabilityCommit: completedCommit,
        completedAt,
        completionReason: explanation
      },
      checkpoint: mergeWorkCheckpoint(current.checkpoint, {
        implementation: { reviewReady: true },
        review: {
          role: current.checkpoint.review.role || "escalationReviewer",
          decision: "ACCEPT",
          reviewedCommit: completedCommit,
          reviewedRevision: integratedRevision,
          explanation,
          evidence: "completed split capability preserved; follow-up is archived"
        },
        integration: {
          branch: "automation/roadmap",
          commit: completedCommit,
          branchCommit: integratedRevision,
          status: "integrated",
          integratedAt: completedAt,
          error: "",
          reconciliation: {
            ...reconciliation,
            taskCommit: current.checkpoint.implementation.commit || completedCommit,
            summary: explanation,
            materialAttempts: reconciliation.materialAttempts + 1,
            lastMaterialAt: completedAt,
            lastReviewDecision: "ACCEPT",
            lastReviewExplanation: explanation,
            reviewCount: reconciliation.reviewCount + 1
          }
        },
        blocker: "",
        lastAction: "completed split parent reconciled as integrated capability"
      })
    };
  });
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

export async function resumeExternalEvidenceTask(worldRoot, taskId, probeReason, { now = new Date() } = {}) {
  const probe = probeReason && typeof probeReason === "object" ? probeReason : {};
  const reason = text(probe.reason || probeReason) || "external dependency probe passed";
  const envelope = await findWorkTaskEnvelope(worldRoot, taskId);
  return mutateTask(worldRoot, taskId, (current) => {
    if (current.status !== "blocked" && current.status !== "failed") return current;
    const checks = Array.isArray(probe.checks)
      ? probe.checks
        .filter((check) => check?.name && check?.healthy)
        .map((check) => `${check.name}=${check.endpoint || "available"}`)
      : [];
    const probeNote = checks.length
      ? `Fresh external dependency probe passed: ${checks.join(", ")}. Run fixture-free evidence against these endpoints.`
      : "Fresh external dependency probe passed; run the pending fixture-free evidence now.";
    const revisionInstructions = [current.checkpoint.review.revisionInstructions, probeNote]
      .filter(Boolean)
      .join("\n");
    const nextStatus = envelope?.runtime && (current.checkpoint?.review?.revisionInstructions
      || Number(current.checkpoint?.implementation?.passes || 0) > 0
      ) ? "revision" : "ready";
    const next = transitionWorkTask(current, nextStatus, {
      now,
      message: reason,
      error: ""
    });
    return {
      ...next,
      message: reason,
      error: "",
      checkpoint: mergeWorkCheckpoint(next.checkpoint, {
        blocker: "",
        activeTurn: {},
        interruption: {
          phase: current.status,
          at: iso(now),
          reason,
          lastTurnId: current.checkpoint.activeTurn.turnId || current.checkpoint.interruption.lastTurnId
        },
        resumeCount: current.checkpoint.resumeCount + 1,
        review: { revisionInstructions },
        convergence: {
          status: "pending",
          requestedAt: "",
          reviewedAt: "",
          decision: "",
          rationale: ""
        },
        lastAction: "external dependency became available; resuming without replanning"
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
