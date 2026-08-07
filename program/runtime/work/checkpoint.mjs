function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? [...value] : [];
}

export function buildWorkCheckpoint(input = {}) {
  const workspace = object(input.workspace);
  const manager = object(input.manager);
  const worker = object(input.worker);
  const plan = object(input.plan);
  const implementation = object(input.implementation);
  const review = object(input.review);
  const interruption = object(input.interruption);
  return {
    workspace: {
      repository: text(workspace.repository),
      baseRevision: text(workspace.baseRevision),
      branch: text(workspace.branch),
      worktreePath: text(workspace.worktreePath),
      mode: text(workspace.mode)
    },
    manager: {
      model: text(manager.model),
      reasoningEffort: text(manager.reasoningEffort),
      threadId: text(manager.threadId)
    },
    worker: {
      model: text(worker.model),
      reasoningEffort: text(worker.reasoningEffort),
      threadId: text(worker.threadId)
    },
    plan: {
      summary: text(plan.summary),
      workOrder: text(plan.workOrder),
      risks: text(plan.risks)
    },
    implementation: {
      summary: text(implementation.summary),
      changedFiles: list(implementation.changedFiles),
      fileChanges: list(implementation.fileChanges),
      diff: text(implementation.diff),
      tests: list(implementation.tests),
      blockers: text(implementation.blockers),
      uncertainty: text(implementation.uncertainty)
    },
    review: {
      decision: text(review.decision).toUpperCase(),
      explanation: text(review.explanation),
      revisionInstructions: text(review.revisionInstructions)
    },
    interruption: {
      phase: text(interruption.phase),
      at: text(interruption.at),
      reason: text(interruption.reason),
      lastTurnId: text(interruption.lastTurnId)
    },
    revisionCount: Math.max(0, Math.trunc(Number(input.revisionCount) || 0))
  };
}

export function mergeWorkCheckpoint(base = {}, patch = {}) {
  const current = buildWorkCheckpoint(base);
  const update = object(patch);
  const merged = {
    ...current,
    workspace: { ...current.workspace, ...object(update.workspace) },
    manager: { ...current.manager, ...object(update.manager) },
    worker: { ...current.worker, ...object(update.worker) },
    plan: { ...current.plan, ...object(update.plan) },
    implementation: { ...current.implementation, ...object(update.implementation) },
    review: { ...current.review, ...object(update.review) },
    interruption: { ...current.interruption, ...object(update.interruption) }
  };
  if (Object.prototype.hasOwnProperty.call(update, "revisionCount")) {
    merged.revisionCount = Math.max(0, Math.trunc(Number(update.revisionCount) || 0));
  }
  return buildWorkCheckpoint(merged);
}
