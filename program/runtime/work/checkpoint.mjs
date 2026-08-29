function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? [...value] : [];
}

function uniqueTextList(value) {
  const values = list(value).map((entry) => text(entry)).filter(Boolean);
  return [...new Set(values)];
}

function normalizedValue(value) {
  if (Array.isArray(value)) return value.map((entry) => normalizedValue(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizedValue(value[key])])
  );
}

function approvalProposal(value) {
  if (value == null || value === "") return {};
  if (typeof value === "string") return { text: text(value) };
  return normalizedValue(object(value));
}

function approvalHistoryRecord(value = {}) {
  const source = object(value);
  return {
    state: text(source.state),
    at: text(source.at || source.timestamp),
    requestId: text(source.requestId),
    action: text(source.action),
    checkpointIdentity: text(source.checkpointIdentity),
    decisionSource: text(source.decisionSource || source.source),
    decisionValue: text(source.decisionValue || source.value),
    actor: text(source.actor),
    rationale: text(source.rationale),
    resumeStatus: text(source.resumeStatus),
    resumePhase: text(source.resumePhase)
  };
}

export function buildWorkApproval(input = {}) {
  const source = object(input);
  const decidedAt = text(source.decidedAt || source.decisionTimestamp);
  const approval = {
    state: text(source.state),
    taskId: text(source.taskId),
    requestId: text(source.requestId),
    action: text(source.action || source.canonicalAction),
    proposal: approvalProposal(source.proposal || source.normalizedProposal),
    resumeToken: text(source.resumeToken),
    checkpointIdentity: text(source.checkpointIdentity),
    resumeStatus: text(source.resumeStatus || source.recordedStatus),
    resumePhase: text(source.resumePhase || source.recordedPhase),
    policyMode: text(source.policyMode || source.mode),
    policyKey: text(source.policyKey || source.matchedKey),
    policyPath: text(source.policyPath),
    requestedAt: text(source.requestedAt || source.requestTimestamp),
    decidedAt,
    decisionTimestamp: decidedAt,
    decisionSource: text(source.decisionSource || source.source),
    decisionActor: text(source.decisionActor || source.actor),
    rationale: text(source.rationale),
    resumedAt: text(source.resumedAt || source.resumedTimestamp),
    resumedStatus: text(source.resumedStatus),
    resumedPhase: text(source.resumedPhase),
    resumeCount: Math.max(0, Math.trunc(Number(source.resumeCount) || 0)),
    history: list(source.history).map((entry) => approvalHistoryRecord(entry))
  };
  return approval;
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

function progressRecord(value = {}) {
  const source = object(value);
  return {
    pass: Math.max(0, Math.trunc(Number(source.pass) || 0)),
    at: text(source.at),
    turnId: text(source.turnId),
    requestIdentity: text(source.requestIdentity),
    state: text(source.state),
    summary: text(source.summary),
    commits: list(source.commits),
    newCommits: list(source.newCommits),
    changedFiles: list(source.changedFiles),
    changedFilesHash: text(source.changedFilesHash),
    diffHash: text(source.diffHash),
    tests: list(source.tests),
    testsHash: text(source.testsHash),
    blockers: text(source.blockers),
    blockerHash: text(source.blockerHash),
    reviewReady: source.reviewReady === true,
    material: source.material === true,
    materialReasons: list(source.materialReasons),
    noDeltaReason: text(source.noDeltaReason)
  };
}

function compactContextRecord(value = {}) {
  const source = object(value);
  const version = Number(source.version);
  return {
    version: Number.isFinite(version) ? Math.max(0, Math.trunc(version)) : 0,
    phase: text(source.phase),
    role: text(source.role),
    contextHash: text(source.contextHash || source.hash),
    prompt: text(source.prompt || source.exactPrompt),
    sourceRequestIds: uniqueTextList(source.sourceRequestIds || source.sourceRequestIDs),
    sourceTurnIds: uniqueTextList(source.sourceTurnIds || source.sourceTurnIDs),
    requestIdentity: text(source.requestIdentity),
    activeThreadId: text(source.activeThreadId || source.threadId),
    priorThreadIds: uniqueTextList(source.priorThreadIds || source.previousThreadIds)
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
      mode: text(workspace.mode),
      replacementOf: text(workspace.replacementOf)
    },
    manager: {
      model: text(manager.model),
      reasoningEffort: text(manager.reasoningEffort),
      threadId: text(manager.threadId),
      previousThreadIds: uniqueTextList(manager.previousThreadIds)
    },
    worker: {
      model: text(worker.model),
      reasoningEffort: text(worker.reasoningEffort),
      threadId: text(worker.threadId),
      previousThreadIds: uniqueTextList(worker.previousThreadIds)
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
      uncertainty: text(implementation.uncertainty),
      passHistory: list(implementation.passHistory).map((entry) => progressRecord(entry)),
      materialProgressPasses: Math.max(0, Math.trunc(Number(implementation.materialProgressPasses) || 0)),
      noProgressPasses: Math.max(0, Math.trunc(Number(implementation.noProgressPasses) || 0)),
      consecutiveNoProgressPasses: Math.max(0, Math.trunc(Number(implementation.consecutiveNoProgressPasses) || 0)),
      commitsProduced: Math.max(0, Math.trunc(Number(implementation.commitsProduced) || 0)),
      acceptanceChecksClosed: Math.max(0, Math.trunc(Number(implementation.acceptanceChecksClosed) || 0)),
      lastMaterialProgressAt: text(implementation.lastMaterialProgressAt)
    },
    review: {
      decision: text(review.decision).toUpperCase(),
      explanation: text(review.explanation),
      revisionInstructions: text(review.revisionInstructions)
    },
    convergence: {
      status: text(input.convergence?.status),
      reviewCount: Math.max(0, Math.trunc(Number(input.convergence?.reviewCount) || 0)),
      requestedAt: text(input.convergence?.requestedAt),
      reviewedAt: text(input.convergence?.reviewedAt),
      decision: text(input.convergence?.decision).toUpperCase(),
      rationale: text(input.convergence?.rationale),
      correction: text(input.convergence?.correction),
      splitTaskIds: list(input.convergence?.splitTaskIds)
    },
    integration: {
      branch: text(integration.branch),
      baseRevision: text(integration.baseRevision),
      commit: text(integration.commit),
      branchCommit: text(integration.branchCommit),
      status: text(integration.status),
      integratedAt: text(integration.integratedAt),
      error: text(integration.error),
      pushed: integration.pushed === true,
      reconciliation: {
        worktreePath: text(integration.reconciliation?.worktreePath),
        taskBaseRevision: text(integration.reconciliation?.taskBaseRevision),
        taskCommit: text(integration.reconciliation?.taskCommit),
        managerThreadId: text(integration.reconciliation?.managerThreadId),
        workerThreadId: text(integration.reconciliation?.workerThreadId),
        attempts: Math.max(0, Math.trunc(Number(integration.reconciliation?.attempts) || 0)),
        materialAttempts: Math.max(0, Math.trunc(Number(integration.reconciliation?.materialAttempts) || 0)),
        noProgressAttempts: Math.max(0, Math.trunc(Number(integration.reconciliation?.noProgressAttempts) || 0)),
        consecutiveNoProgressAttempts: Math.max(0, Math.trunc(Number(integration.reconciliation?.consecutiveNoProgressAttempts) || 0)),
        conflictsResolved: Math.max(0, Math.trunc(Number(integration.reconciliation?.conflictsResolved) || 0)),
        summary: text(integration.reconciliation?.summary),
        changedFiles: list(integration.reconciliation?.changedFiles),
        tests: list(integration.reconciliation?.tests),
        diff: text(integration.reconciliation?.diff),
        revisionInstructions: text(integration.reconciliation?.revisionInstructions),
        lastMaterialAt: text(integration.reconciliation?.lastMaterialAt),
        lastReviewDecision: text(integration.reconciliation?.lastReviewDecision).toUpperCase(),
        lastReviewExplanation: text(integration.reconciliation?.lastReviewExplanation),
        reviewCount: Math.max(0, Math.trunc(Number(integration.reconciliation?.reviewCount) || 0)),
        passHistory: list(integration.reconciliation?.passHistory)
      }
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
    compactContext: compactContextRecord(input.compactContext || input.contextCheckpoint),
    activeTurn,
    turnHistory,
    blocker: text(input.blocker),
    humanResponse: text(input.humanResponse),
    lastAction: text(input.lastAction),
    selectionReason: text(input.selectionReason),
    revisionCount: Math.max(0, Math.trunc(Number(input.revisionCount) || 0)),
    continuationCount: Math.max(0, Math.trunc(Number(input.continuationCount) || 0)),
    resumeCount: Math.max(0, Math.trunc(Number(input.resumeCount) || 0)),
    recoveryCount: Math.max(0, Math.trunc(Number(input.recoveryCount) || 0)),
    recoveryHistory: list(input.recoveryHistory).map((entry) => ({
      at: text(entry?.at),
      previousBlocker: text(entry?.previousBlocker),
      reason: text(entry?.reason),
      previousPhase: text(entry?.previousPhase),
      previousTurnId: text(entry?.previousTurnId),
      staleTurn: entry?.staleTurn === true
    })),
    approval: buildWorkApproval(input.approval)
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
    convergence: { ...current.convergence, ...object(update.convergence) },
    integration: {
      ...current.integration,
      ...object(update.integration),
      reconciliation: {
        ...current.integration.reconciliation,
        ...object(update.integration?.reconciliation)
      }
    },
    executionPreflight: { ...current.executionPreflight, ...object(update.executionPreflight) },
    interruption: { ...current.interruption, ...object(update.interruption) },
    compactContext: Object.prototype.hasOwnProperty.call(update, "compactContext")
      ? compactContextRecord(update.compactContext)
      : current.compactContext,
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
      : current.selectionReason,
    approval: Object.prototype.hasOwnProperty.call(update, "approval")
      ? buildWorkApproval({ ...current.approval, ...object(update.approval) })
      : current.approval
  };
  if (Object.prototype.hasOwnProperty.call(update, "revisionCount")) {
    merged.revisionCount = Math.max(0, Math.trunc(Number(update.revisionCount) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(update, "continuationCount")) {
    merged.continuationCount = Math.max(0, Math.trunc(Number(update.continuationCount) || 0));
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
