import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { recordArtifact } from "../../bridge/exchange.mjs";
import { worldNewspaperLogPath } from "../newspaper_log.mjs";
import {
  HEADQUARTERS_ACTIONS,
  normalizeRatifyAction,
  resolveRatifyDecision
} from "../ratify_policy.mjs";
import { assertWorkTask, buildWorkTask } from "../../runtime/work/contract.mjs";
import { buildWorkApproval, mergeWorkCheckpoint } from "../../runtime/work/checkpoint.mjs";
import { mutateWorkTask } from "../../runtime/work/operator.mjs";
import { findWorkTaskEnvelope } from "../../runtime/work/queue.mjs";
import { readWorkTaskStatus, workTaskStatusPath } from "../../runtime/work/status.mjs";

const ACTION_SET = new Set(HEADQUARTERS_ACTIONS);
const RESUMABLE_STATUSES = new Set([
  "ready",
  "planning",
  "implementing",
  "reviewing",
  "revision"
]);
const ARTIFACT_PATHS_RECORDED = new Set();

function text(value) {
  return String(value ?? "").trim();
}

function nowDate(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("headquarters approval defective: invalid timestamp");
  return date;
}

function nowIso(now) {
  return nowDate(now).toISOString();
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

function normalizedProposal(value) {
  if (value == null || value === "") return {};
  if (typeof value === "string") return { text: text(value) };
  return normalizedValue(value);
}

function canonical(value) {
  return JSON.stringify(normalizedValue(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function approvalDefect(message) {
  throw new Error(`headquarters approval defective: ${message}`);
}

function resolveProposalValue(proposal) {
  if (proposal && typeof proposal === "object" && proposal.ob && typeof proposal.ob === "object") {
    return proposal.ob.map ?? proposal.ob.text ?? proposal.ob.name ?? proposal.ob;
  }
  return proposal;
}

function checkpointIdentity(task) {
  const approval = task.checkpoint?.approval;
  if (approval?.checkpointIdentity) return approval.checkpointIdentity;
  const checkpoint = buildWorkTask(task).checkpoint;
  return `checkpoint-${digest({ ...checkpoint, approval: {} })}`;
}

function bindingFor({ taskId, action, proposal, checkpoint }) {
  return { taskId, action, proposal, checkpointIdentity: checkpoint };
}

function requestIdFor(binding) {
  return `hq-request-${digest(binding).slice(0, 32)}`;
}

function resumeTokenFor(binding, requestId) {
  return `hq-resume-${digest({ ...binding, requestId }).slice(0, 48)}`;
}

function policyContext(proposal) {
  const value = proposal && typeof proposal === "object" ? proposal : {};
  return {
    subjectName: value.subjectName ?? value.subject ?? value.capability ?? "",
    toolName: value.toolName ?? value.tool ?? "",
    toolSignature: value.toolSignature ?? value.signature ?? ""
  };
}

function approvalPolicy(resolution) {
  const mode = text(resolution?.mode).toLowerCase();
  if (["allow", "deny", "ask"].includes(mode)) return mode;
  if (resolution?.decision === "truth") return "allow";
  if (resolution?.decision === "lie") return "deny";
  if (resolution?.decision === "ask") return "ask";
  return "ask";
}

function decisionState(mode) {
  if (mode === "allow") return "allowed";
  if (mode === "deny") return "denied";
  return "pending";
}

function historyEntry({ state, at, approval, decisionSource = "", decisionValue = "", actor = "", rationale = "" }) {
  return {
    state,
    at,
    requestId: approval.requestId,
    action: approval.action,
    checkpointIdentity: approval.checkpointIdentity,
    decisionSource,
    decisionValue,
    actor,
    rationale,
    resumeStatus: approval.resumeStatus,
    resumePhase: approval.resumePhase
  };
}

function sameBinding(approval, { taskId, action, proposal, checkpointIdentity: identity, requestId, resumeToken }) {
  return (!approval.taskId || approval.taskId === taskId)
    && approval.requestId === requestId
    && approval.action === action
    && approval.checkpointIdentity === identity
    && canonical(approval.proposal) === canonical(proposal)
    && (!resumeToken || approval.resumeToken === resumeToken)
    && Boolean(taskId);
}

function policyResult(resolution, mode) {
  return {
    mode,
    key: resolution?.matchedKey ?? null,
    path: resolution?.policyPath ?? "",
    raw: resolution?.raw ?? (mode === "ask" ? "unanswered" : mode)
  };
}

function transitionApproval(task, approval, patch) {
  const nextApproval = buildWorkApproval({ ...approval, ...patch });
  const next = buildWorkTask({
    ...task,
    checkpoint: mergeWorkCheckpoint(task.checkpoint, { approval: nextApproval })
  });
  assertWorkTask(next);
  return next;
}

function restoreApprovedTask(task, approval, at) {
  const status = approval.resumeStatus;
  if (!RESUMABLE_STATUSES.has(status)) approvalDefect(`invalid recorded resume status ${status || "(missing)"}`);
  const next = buildWorkTask({
    ...task,
    status,
    previousStatus: "blocked",
    startedAt: task.startedAt || (status === "planning" || status === "implementing" ? at : ""),
    finishedAt: "",
    message: "Headquarters approval granted; task resumed",
    error: "",
    checkpoint: mergeWorkCheckpoint(task.checkpoint, {
      blocker: "",
      lastAction: "Headquarters approval resumed task",
      approval: buildWorkApproval({
        ...approval,
        state: "approved",
        resumedAt: at,
        resumedStatus: status,
        resumedPhase: approval.resumePhase,
        resumeCount: approval.resumeCount + 1,
        history: [
          ...approval.history,
          historyEntry({
            state: "resumed",
            at,
            approval,
            decisionSource: "runtime",
            decisionValue: "resumed",
            actor: approval.decisionActor,
            rationale: approval.rationale
          })
        ]
      })
    })
  });
  assertWorkTask(next);
  return next;
}

async function appendApprovalEvent(worldRoot, task, approval, {
  state,
  at,
  decisionSource = "",
  decisionValue = "",
  actor = "",
  rationale = ""
} = {}) {
  const file = worldNewspaperLogPath({ worldRoot, name: `work-${task.taskId}`, now: new Date(at) });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const source = task.source || {};
  const lines = [
    "su name work task approval be map def",
    `  su name event ob text ${JSON.stringify(state)} ya`,
    `  su name state ob text ${JSON.stringify(state)} ya`,
    `  su name task id ob text ${JSON.stringify(task.taskId)} ya`,
    `  su name source identity ob text ${JSON.stringify(source.identity)} ya`,
    `  su name source kind ob text ${JSON.stringify(source.kind)} ya`,
    `  su name source locator ob text ${JSON.stringify(source.locator)} ya`,
    `  su name action ob text ${JSON.stringify(approval.action)} ya`,
    `  su name proposal ob text ${JSON.stringify(canonical(approval.proposal))} ya`,
    `  su name request id ob text ${JSON.stringify(approval.requestId)} ya`,
    `  su name checkpoint identity ob text ${JSON.stringify(approval.checkpointIdentity)} ya`,
    `  su name policy source ob text ${JSON.stringify(approval.policyPath)} ya`,
    `  su name policy key ob text ${JSON.stringify(approval.policyKey)} ya`,
    `  su name policy mode ob text ${JSON.stringify(approval.policyMode)} ya`,
    `  su name decision source ob text ${JSON.stringify(decisionSource)} ya`,
    `  su name decision value ob text ${JSON.stringify(decisionValue)} ya`,
    `  su name actor ob text ${JSON.stringify(actor)} ya`,
    `  su name rationale ob text ${JSON.stringify(rationale)} ya`,
    `  su name resumption phase ob text ${JSON.stringify(approval.resumedPhase || approval.resumePhase)} ya`,
    `  su name timestamp ob text ${JSON.stringify(at)} ya`,
    "prah",
    ""
  ].join("\n");
  await fs.appendFile(file, lines, "utf8");
  return file;
}

async function recordApprovalArtifacts({ worldRoot, task, approval, evidencePath }) {
  const envelope = await findWorkTaskEnvelope(worldRoot, task.taskId, { owner: task.owner });
  const statusPath = await workTaskStatusPath(worldRoot, task.taskId);
  const paths = [statusPath, envelope?.path, evidencePath].filter(Boolean);
  const links = [];
  for (const filename of [...new Set(paths)]) {
    let bytes;
    try {
      bytes = await fs.readFile(filename);
    } catch {
      continue;
    }
    const durableLocator = path.relative(process.cwd(), filename).replace(/[\\]+/g, "/");
    const key = `${durableLocator}:${approval.requestId}`;
    const locator = ARTIFACT_PATHS_RECORDED.has(key)
      ? path.join("artifacts", "headquarters-approval", task.taskId, `${approval.requestId}-${approval.state}-${path.basename(filename)}`)
      : durableLocator;
    try {
      const artifact = recordArtifact({
        locator,
        producer: "headquarters approval",
        bytes,
        kind: "work approval evidence"
      });
      if (!artifact) continue;
      ARTIFACT_PATHS_RECORDED.add(key);
      links.push({
        locator: durableLocator,
        snapshot: locator === durableLocator ? "" : locator,
        hash: artifact.fromtext?.text || ""
      });
    } catch {
      // Artifact linking is best-effort outside a run newspaper.
    }
  }
  return links;
}

function resultFor({ task, approval, policy, evidencePath = "", artifactLinks = [], noop = false }) {
  return {
    taskId: task.taskId,
    owner: task.owner,
    state: approval.state,
    action: approval.action,
    proposal: approval.proposal,
    requestId: approval.requestId,
    resumeToken: approval.resumeToken,
    checkpointIdentity: approval.checkpointIdentity,
    resumeStatus: approval.resumeStatus,
    resumePhase: approval.resumePhase,
    resumedAt: approval.resumedAt,
    resumeCount: approval.resumeCount,
    status: task.status,
    policy,
    evidencePath,
    statusPath: "",
    envelopePath: "",
    artifactLinks,
    noop
  };
}

export function headquartersApprovalActions() {
  return [...HEADQUARTERS_ACTIONS];
}

export async function requestHeadquartersApproval(worldRoot, {
  taskId,
  action,
  proposal = {},
  policyContext: suppliedPolicyContext = {},
  now = new Date()
} = {}) {
  const canonicalAction = normalizeRatifyAction(action);
  if (!canonicalAction || !ACTION_SET.has(canonicalAction)) {
    approvalDefect(`unsupported action ${text(action) || "(missing)"}`);
  }
  const normalized = normalizedProposal(resolveProposalValue(proposal));
  const stored = await readWorkTaskStatus(worldRoot, taskId);
  if (!stored) approvalDefect(`work task not found: ${taskId}`);
  const initial = buildWorkTask(stored);
  const identity = checkpointIdentity(initial);
  const binding = bindingFor({ taskId: initial.taskId, action: canonicalAction, proposal: normalized, checkpoint: identity });
  const requestId = requestIdFor(binding);
  const resumeToken = resumeTokenFor(binding, requestId);
  const context = { ...policyContext(normalized), ...suppliedPolicyContext };
  const resolution = await resolveRatifyDecision({
    mindName: initial.owner,
    action: canonicalAction,
    subjectName: context.subjectName,
    toolName: context.toolName,
    toolSignature: context.toolSignature,
    headquartersWork: true,
    rememberFn: () => ({ ob: { filename: worldRoot } })
  });
  const mode = approvalPolicy(resolution);
  const policy = policyResult(resolution, mode);
  const at = nowIso(now);
  let operation = null;
  const task = await mutateWorkTask(worldRoot, initial.taskId, (current) => {
    const existing = current.checkpoint.approval;
    if (existing.state) {
      if (!sameBinding(existing, {
        taskId: current.taskId,
        action: canonicalAction,
        proposal: normalized,
        checkpointIdentity: existing.checkpointIdentity || identity,
        requestId,
        resumeToken
      })) {
        approvalDefect("conflicting approval request for the current task checkpoint");
      }
      operation = { approval: existing, noop: true };
      return current;
    }
    if (!RESUMABLE_STATUSES.has(current.status)) {
      approvalDefect(`task status ${current.status} cannot be approval-blocked`);
    }
    const resumePhase = current.checkpoint.interruption.phase || current.status;
    const baseApproval = buildWorkApproval({
      state: decisionState(mode),
      taskId: initial.taskId,
      requestId,
      action: canonicalAction,
      proposal: normalized,
      resumeToken,
      checkpointIdentity: identity,
      resumeStatus: current.status,
      resumePhase,
      policyMode: policy.mode,
      policyKey: policy.key,
      policyPath: policy.path,
      requestedAt: at,
      decidedAt: mode === "ask" ? "" : at,
      decisionSource: mode === "ask" ? "" : "standing-policy",
      decisionActor: mode === "ask" ? "" : "policy",
      rationale: policy.raw,
      history: []
    });
    const requested = historyEntry({
      state: "requested",
      at,
      approval: baseApproval,
      decisionSource: "headquarters",
      decisionValue: "requested"
    });
    const finalState = decisionState(mode);
    const finalEntry = historyEntry({
      state: finalState,
      at,
      approval: baseApproval,
      decisionSource: mode === "ask" ? "policy" : "standing-policy",
      decisionValue: mode,
      actor: mode === "ask" ? "" : "policy",
      rationale: policy.raw
    });
    let next = current;
    let approval = buildWorkApproval({
      ...baseApproval,
      history: mode === "ask" ? [requested, historyEntry({
        state: "pending",
        at,
        approval: baseApproval,
        decisionSource: "policy",
        decisionValue: "ask",
        rationale: policy.raw
      })] : [requested, finalEntry]
    });
    if (mode === "ask") {
      next = {
        ...current,
        status: "blocked",
        previousStatus: current.status,
        message: "Headquarters approval pending",
        error: "Headquarters approval pending",
        checkpoint: mergeWorkCheckpoint(current.checkpoint, {
          blocker: "Headquarters approval pending",
          interruption: {
            phase: current.status,
            at,
            reason: "Headquarters approval pending",
            lastTurnId: current.checkpoint.activeTurn.turnId || current.checkpoint.interruption.lastTurnId
          },
          approval,
          lastAction: "Headquarters approval requested"
        })
      };
      next = buildWorkTask(next);
    } else {
      next = transitionApproval(current, approval, {});
    }
    assertWorkTask(next);
    operation = { approval: next.checkpoint.approval, noop: false, events: mode === "ask" ? ["requested", "pending"] : ["requested", finalState] };
    return next;
  });
  const finalApproval = task.checkpoint.approval;
  let evidencePath = "";
  if (!operation.noop) {
    for (const event of operation.events) {
      evidencePath = await appendApprovalEvent(worldRoot, task, finalApproval, {
        state: event,
        at,
        decisionSource: event === "requested" ? "headquarters" : (mode === "ask" ? "policy" : "standing-policy"),
        decisionValue: event === "requested" ? "requested" : (mode === "ask" ? "ask" : mode),
        actor: event === "requested" || mode === "ask" ? "" : "policy",
        rationale: policy.raw
      });
    }
  }
  const artifactLinks = await recordApprovalArtifacts({ worldRoot, task, approval: finalApproval, evidencePath });
  const result = resultFor({ task, approval: finalApproval, policy, evidencePath, artifactLinks, noop: operation.noop });
  const statusPath = await workTaskStatusPath(worldRoot, task.taskId);
  const envelope = await findWorkTaskEnvelope(worldRoot, task.taskId, { owner: task.owner });
  result.statusPath = statusPath;
  result.envelopePath = envelope?.path || "";
  return result;
}

function normalizeDecision(value) {
  const decision = String(value ?? "").trim().toLowerCase();
  if (["approve", "approved", "allow", "allowed", "truth", "yes"].includes(decision)) return "approve";
  if (["deny", "denied", "lie", "no"].includes(decision)) return "deny";
  return "";
}

export async function decideHeadquartersApproval(worldRoot, {
  taskId,
  action,
  requestId,
  resumeToken,
  decision,
  actor = "Headquarters",
  rationale = "",
  proposal,
  now = new Date()
} = {}) {
  const canonicalAction = normalizeRatifyAction(action);
  if (!canonicalAction || !ACTION_SET.has(canonicalAction)) approvalDefect(`unsupported action ${text(action) || "(missing)"}`);
  const normalizedDecision = normalizeDecision(decision);
  if (!normalizedDecision) approvalDefect(`unsupported decision ${text(decision) || "(missing)"}`);
  let operation = null;
  const at = nowIso(now);
  const task = await mutateWorkTask(worldRoot, taskId, (current) => {
    const approval = current.checkpoint.approval;
    if (!approval.state) approvalDefect("no approval request is pending");
    const expectedProposal = proposal === undefined ? approval.proposal : normalizedProposal(resolveProposalValue(proposal));
    if (!sameBinding(approval, {
      taskId: current.taskId,
      action: canonicalAction,
      proposal: expectedProposal,
      checkpointIdentity: approval.checkpointIdentity,
      requestId: text(requestId),
      resumeToken: text(resumeToken)
    })) {
      approvalDefect("stale or tampered approval decision binding");
    }
    if (approval.state !== "pending") {
      const sameDecision = (approval.state === "approved" && normalizedDecision === "approve")
        || (approval.state === "denied" && normalizedDecision === "deny");
      if (!sameDecision) approvalDefect("conflicting decision for the completed approval request");
      operation = { approval, noop: true };
      return current;
    }
    const nextRationale = text(rationale);
    const decided = buildWorkApproval({
      ...approval,
      state: normalizedDecision === "approve" ? "approved" : "denied",
      decidedAt: at,
      decisionSource: "human",
      decisionActor: text(actor) || "Headquarters",
      rationale: nextRationale,
      history: [
        ...approval.history,
        historyEntry({
          state: normalizedDecision === "approve" ? "approved" : "denied",
          at,
          approval,
          decisionSource: "human",
          decisionValue: normalizedDecision,
          actor: text(actor) || "Headquarters",
          rationale: nextRationale
        })
      ]
    });
    let next;
    if (normalizedDecision === "approve") {
      next = restoreApprovedTask(current, decided, at);
    } else {
      next = buildWorkTask({
        ...current,
        status: "blocked",
        message: "Headquarters approval denied",
        error: "Headquarters approval denied",
        checkpoint: mergeWorkCheckpoint(current.checkpoint, {
          blocker: "Headquarters approval denied",
          approval: decided,
          lastAction: "Headquarters approval denied task action"
        })
      });
      assertWorkTask(next);
    }
    operation = { approval: next.checkpoint.approval, noop: false, events: normalizedDecision === "approve" ? ["approved", "resumed"] : ["denied"] };
    return next;
  });
  const finalApproval = task.checkpoint.approval;
  let evidencePath = "";
  if (!operation.noop) {
    for (const event of operation.events) {
      evidencePath = await appendApprovalEvent(worldRoot, task, finalApproval, {
        state: event,
        at,
        decisionSource: "human",
        decisionValue: normalizedDecision,
        actor: finalApproval.decisionActor,
        rationale: finalApproval.rationale
      });
    }
  }
  const artifactLinks = await recordApprovalArtifacts({ worldRoot, task, approval: finalApproval, evidencePath });
  const policy = {
    mode: finalApproval.policyMode,
    key: finalApproval.policyKey,
    path: finalApproval.policyPath,
    raw: ""
  };
  const result = resultFor({ task, approval: finalApproval, policy, evidencePath, artifactLinks, noop: operation.noop });
  const statusPath = await workTaskStatusPath(worldRoot, task.taskId);
  const envelope = await findWorkTaskEnvelope(worldRoot, task.taskId, { owner: task.owner });
  result.statusPath = statusPath;
  result.envelopePath = envelope?.path || "";
  return result;
}
