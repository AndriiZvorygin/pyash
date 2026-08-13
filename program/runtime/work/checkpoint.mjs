function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? [...value] : [];
}

function turnResult(value) {
  const source = object(value);
  return {
    status: text(source.status),
    text: text(source.text),
    diff: text(source.diff),
    fileChanges: list(source.fileChanges),
    turn: object(source.turn)
  };
}

function turnRecord(value = {}) {
  const source = object(value);
  return {
    phase: text(source.phase),
    role: text(source.role),
    threadId: text(source.threadId),
    turnId: text(source.turnId),
    requestIdentity: text(source.requestIdentity),
    state: text(source.state),
    startedAt: text(source.startedAt),
    completedAt: text(source.completedAt),
    resultCaptured: source.resultCaptured === true,
    ambiguity: text(source.ambiguity),
    result: turnResult(source.result)
  };
}

export function buildWorkCheckpoint(input = {}) {
  const workspace = object(input.workspace);
  const manager = object(input.manager);
  const worker = object(input.worker);
  const plan = object(input.plan);
  const implementation = object(input.implementation);
  const review = object(input.review);
  const integration = object(input.integration);
  const executionPreflight = object(input.executionPreflight);
  const interruption = object(input.interruption);
  const activeTurn = turnRecord(input.activeTurn);
  const turnHistory = list(input.turnHistory).map((entry) => turnRecord(entry));
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
      commit: text(implementation.commit),
      passes: Math.max(0, Math.trunc(Number(implementation.passes) || 0)),
      reviewReady: implementation.reviewReady === true,
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
    integration: {
      branch: text(integration.branch),
      baseRevision: text(integration.baseRevision),
      commit: text(integration.commit),
      status: text(integration.status),
      integratedAt: text(integration.integratedAt),
      error: text(integration.error),
      pushed: integration.pushed === true
    },
    executionPreflight: {
      status: text(executionPreflight.status),
      check: text(executionPreflight.check),
      reason: text(executionPreflight.reason),
      observedAt: text(executionPreflight.observedAt),
      worktree: text(executionPreflight.worktree),
      threadSandbox: text(executionPreflight.threadSandbox),
      turnSandbox: text(executionPreflight.turnSandbox)
    },
    interruption: {
      phase: text(interruption.phase),
      at: text(interruption.at),
      reason: text(interruption.reason),
      lastTurnId: text(interruption.lastTurnId)
    },
    activeTurn,
    turnHistory,
    blocker: text(input.blocker),
    humanResponse: text(input.humanResponse),
    lastAction: text(input.lastAction),
    selectionReason: text(input.selectionReason),
    revisionCount: Math.max(0, Math.trunc(Number(input.revisionCount) || 0)),
    resumeCount: Math.max(0, Math.trunc(Number(input.resumeCount) || 0)),
    recoveryCount: Math.max(0, Math.trunc(Number(input.recoveryCount) || 0)),
    recoveryHistory: list(input.recoveryHistory).map((entry) => ({
      at: text(entry?.at),
      previousBlocker: text(entry?.previousBlocker),
      reason: text(entry?.reason),
      previousPhase: text(entry?.previousPhase),
      previousTurnId: text(entry?.previousTurnId),
      staleTurn: entry?.staleTurn === true
    }))
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
    integration: { ...current.integration, ...object(update.integration) },
    executionPreflight: { ...current.executionPreflight, ...object(update.executionPreflight) },
    interruption: { ...current.interruption, ...object(update.interruption) },
    activeTurn: Object.prototype.hasOwnProperty.call(update, "activeTurn")
      ? turnRecord(update.activeTurn)
      : current.activeTurn,
    turnHistory: Object.prototype.hasOwnProperty.call(update, "turnHistory")
      ? list(update.turnHistory).map((entry) => turnRecord(entry))
      : current.turnHistory,
    blocker: Object.prototype.hasOwnProperty.call(update, "blocker")
      ? text(update.blocker)
      : current.blocker,
    humanResponse: Object.prototype.hasOwnProperty.call(update, "humanResponse")
      ? text(update.humanResponse)
      : current.humanResponse,
    lastAction: Object.prototype.hasOwnProperty.call(update, "lastAction")
      ? text(update.lastAction)
      : current.lastAction,
    selectionReason: Object.prototype.hasOwnProperty.call(update, "selectionReason")
      ? text(update.selectionReason)
      : current.selectionReason
  };
  if (Object.prototype.hasOwnProperty.call(update, "revisionCount")) {
    merged.revisionCount = Math.max(0, Math.trunc(Number(update.revisionCount) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(update, "resumeCount")) {
    merged.resumeCount = Math.max(0, Math.trunc(Number(update.resumeCount) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(update, "recoveryCount")) {
    merged.recoveryCount = Math.max(0, Math.trunc(Number(update.recoveryCount) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(update, "recoveryHistory")) {
    merged.recoveryHistory = list(update.recoveryHistory);
  }
  return buildWorkCheckpoint(merged);
}
