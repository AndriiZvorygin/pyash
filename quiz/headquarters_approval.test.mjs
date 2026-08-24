import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { parse } from "../program/understand/index.mjs";
import {
  HEADQUARTERS_ACTIONS,
  resolveRatifyDecision
} from "../program/agent/ratify_policy.mjs";
import {
  decideHeadquartersApproval,
  requestHeadquartersApproval
} from "../program/agent/headquarters/approval.mjs";
import { enqueueWorkTask, findWorkTaskEnvelope } from "../program/runtime/work/queue.mjs";
import {
  readWorkTaskStatus,
  workTaskStatusPath,
  writeWorkTaskStatus
} from "../program/runtime/work/status.mjs";
import { buildWorkTask } from "../program/runtime/work/contract.mjs";
import { resumeWorkTask } from "../program/runtime/work/operator.mjs";
import {
  isRecoverableOperationalWorkTask,
  recoverOperationalWorkTask
} from "../program/runtime/work/recovery.mjs";

const OWNER = "correspondence worker";
const POLICY_PATH = (worldRoot) => path.join(worldRoot, "house", OWNER, "conduct", "ratify.pya");

async function world(prefix = "pyash-headquarters-approval-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

async function policy(worldRoot, entries = []) {
  await fs.mkdir(path.dirname(POLICY_PATH(worldRoot)), { recursive: true });
  await fs.writeFile(
    POLICY_PATH(worldRoot),
    entries.map(([key, value]) => `su name ${key} ob text ${value} ya`).join("\n") + "\n",
    "utf8"
  );
}

function rememberWorld(worldRoot) {
  return name => name === "world root" ? { ob: { filename: worldRoot } } : null;
}

async function task(worldRoot, taskId, {
  status = "implementing",
  kind = "correspondence",
  owner = OWNER,
  approval = {},
  checkpoint = {}
} = {}) {
  await enqueueWorkTask(worldRoot, {
    taskId,
    owner,
    kind,
    title: `Approval task ${taskId}`,
    queuedAt: "2026-08-24T12:00:00.000Z",
    acceptanceText: "The approval decision is durable and replayable.",
    promptText: "Prepare the bounded action from the checkpoint.",
    retryCount: 1,
    retryMax: 3,
    result: "checkpoint result",
    source: {
      identity: `fixture:${taskId}`,
      kind: "fixture-mail",
      locator: `fixture://${taskId}`
    },
    delegationEvents: [{
      type: "assigned",
      timestamp: "2026-08-24T12:00:01.000Z",
      actor: "chief of staff",
      recipient: owner,
      note: "Prepare the bounded action.",
      sourceIdentity: `fixture:${taskId}`
    }],
    checkpoint: {
      implementation: {
        summary: "progress before approval",
        passes: 2,
        tests: ["focused quiz"]
      },
      activeTurn: { phase: status, state: "started", turnId: `turn-${taskId}` },
      interruption: { phase: status, at: "2026-08-24T12:01:00.000Z", reason: "checkpoint" },
      ...checkpoint,
      approval
    }
  });
  const current = await readWorkTaskStatus(worldRoot, taskId);
  return writeWorkTaskStatus(worldRoot, buildWorkTask({
    ...current,
    status,
    startedAt: "2026-08-24T12:01:00.000Z",
    checkpoint: {
      ...current.checkpoint,
      interruption: {
        ...current.checkpoint.interruption,
        phase: status
      }
    }
  }));
}

async function readApprovalEvidence(worldRoot, taskId) {
  const files = await fs.readdir(path.join(worldRoot, "newspaper"));
  const file = files.find(name => name.endsWith(`-work-${taskId}.pya`));
  return file ? fs.readFile(path.join(worldRoot, "newspaper", file), "utf8") : "";
}

test("headquarters policy supports exactly five sensitive actions and preserves legacy booleans", async () => {
  assert.deepEqual(HEADQUARTERS_ACTIONS, ["send", "delete", "purchase", "publish", "calendar-mutation"]);
  const worldRoot = await world();
  await policy(worldRoot, [
    ["action send", "ask"],
    ["action delete", "lie"],
    ["action purchase", "truth"],
    ["subject report", "truth"]
  ]);
  const resolve = action => resolveRatifyDecision({
    mindName: OWNER,
    action,
    subjectName: "subject report",
    headquartersWork: true,
    rememberFn: rememberWorld(worldRoot)
  });
  assert.equal((await resolve("send")).mode, "ask");
  assert.equal((await resolve("send")).decision, "ask");
  assert.equal((await resolve("delete")).decision, "lie");
  assert.equal((await resolve("delete")).mode, "deny");
  assert.equal((await resolve("purchase")).decision, "truth");
  assert.equal((await resolve("purchase")).mode, "allow");
  assert.equal((await resolve("publish")).matchedKey, "subject report");
  const nonHeadquarters = await resolveRatifyDecision({
    mindName: OWNER,
    action: "publish",
    subjectName: "missing subject",
    rememberFn: rememberWorld(worldRoot)
  });
  assert.equal(nonHeadquarters, null);
  const missing = await resolveRatifyDecision({
    mindName: OWNER,
    action: "calendar-mutation",
    subjectName: "missing subject",
    headquartersWork: true,
    rememberFn: rememberWorld(worldRoot)
  });
  assert.equal(missing.mode, "ask");
  assert.equal(missing.matchedKey, null);
  assert.equal(missing.decision, "ask");
  await policy(worldRoot, [["default", "lie"]]);
  const defaulted = await resolveRatifyDecision({
    mindName: OWNER,
    action: "calendar-mutation",
    subjectName: "missing subject",
    headquartersWork: true,
    rememberFn: rememberWorld(worldRoot)
  });
  assert.equal(defaulted.matchedKey, "default");
  assert.equal(defaulted.mode, "deny");
});

test("standing allow and deny record durable terminal approval states for all five actions", async () => {
  const worldRoot = await world();
  await policy(worldRoot, HEADQUARTERS_ACTIONS.map(action => [`action ${action}`, "truth"]));
  for (const [index, action] of HEADQUARTERS_ACTIONS.entries()) {
    const taskId = `standing-allow-${index}`;
    await task(worldRoot, taskId);
    const result = await requestHeadquartersApproval(worldRoot, {
      taskId,
      action,
      proposal: { text: `proposal for ${action}` },
      now: "2026-08-24T12:02:00.000Z"
    });
    assert.equal(result.state, "allowed");
    assert.equal(result.status, "implementing");
    assert.equal(result.policy.mode, "allow");
    assert.deepEqual(result.resumeStatus, "implementing");
    assert.deepEqual((await readWorkTaskStatus(worldRoot, taskId)).checkpoint.approval.history.map(entry => entry.state), [
      "requested", "allowed"
    ]);
  }
  await policy(worldRoot, [["action send", "lie"]]);
  await task(worldRoot, "standing-deny");
  const denied = await requestHeadquartersApproval(worldRoot, {
    taskId: "standing-deny",
    action: "send",
    proposal: { text: "deny this" },
    now: "2026-08-24T12:03:00.000Z"
  });
  assert.equal(denied.state, "denied");
  assert.equal(denied.status, "implementing");
  assert.equal(denied.policy.mode, "deny");
  assert.deepEqual((await readWorkTaskStatus(worldRoot, "standing-deny")).checkpoint.approval.history.map(entry => entry.state), [
    "requested", "denied"
  ]);
});

test("ask persists the pending request in both the envelope and canonical status, then resumes its exact phase", async () => {
  const worldRoot = await world();
  await policy(worldRoot, [["action send", "ask"]]);
  await task(worldRoot, "pending-round-trip", {
    checkpoint: { implementation: { summary: "durable progress", passes: 7 } }
  });
  const requested = await requestHeadquartersApproval(worldRoot, {
    taskId: "pending-round-trip",
    action: "send",
    proposal: { body: "send this draft", subject: "checkpoint" },
    now: "2026-08-24T12:04:00.000Z"
  });
  assert.equal(requested.state, "pending");
  assert.equal(requested.status, "blocked");
  assert.equal(requested.resumeStatus, "implementing");
  assert.equal(requested.resumePhase, "implementing");
  assert.match(requested.resumeToken, /^hq-resume-/);
  assert.match(requested.checkpointIdentity, /^checkpoint-/);
  const stored = await readWorkTaskStatus(worldRoot, "pending-round-trip");
  const envelope = await findWorkTaskEnvelope(worldRoot, "pending-round-trip");
  assert.equal(stored.status, "blocked");
  assert.equal(stored.checkpoint.approval.state, "pending");
  assert.equal(stored.checkpoint.approval.requestId, requested.requestId);
  assert.equal(stored.checkpoint.approval.resumeStatus, "implementing");
  assert.equal(stored.checkpoint.implementation.summary, "durable progress");
  assert.equal(stored.retryCount, 1);
  assert.equal(stored.result, "checkpoint result");
  assert.equal(envelope.task.status, "blocked");
  assert.equal(envelope.task.checkpoint.approval.resumePhase, "implementing");
  assert.equal(envelope.task.checkpoint.implementation.passes, 7);

  const restarted = await readWorkTaskStatus(worldRoot, "pending-round-trip");
  assert.equal(restarted.checkpoint.approval.state, "pending");
  assert.equal(restarted.checkpoint.approval.resumeStatus, "implementing");
  const approved = await decideHeadquartersApproval(worldRoot, {
    taskId: "pending-round-trip",
    action: "send",
    requestId: requested.requestId,
    resumeToken: requested.resumeToken,
    decision: "approve",
    actor: "Sol",
    rationale: "The checkpoint is reviewable.",
    now: "2026-08-24T12:05:00.000Z"
  });
  assert.equal(approved.state, "approved");
  assert.equal(approved.status, "implementing");
  assert.notEqual(approved.status, "ready");
  assert.equal(approved.resumeCount, 1);
  const resumed = await readWorkTaskStatus(worldRoot, "pending-round-trip");
  assert.equal(resumed.status, "implementing");
  assert.equal(resumed.checkpoint.approval.resumedStatus, "implementing");
  assert.equal(resumed.checkpoint.approval.decisionActor, "Sol");
  assert.equal(resumed.checkpoint.approval.rationale, "The checkpoint is reviewable.");
  assert.equal(resumed.checkpoint.implementation.passes, 7);
  assert.equal(resumed.retryCount, 1);
  assert.equal(resumed.result, "checkpoint result");
  assert.deepEqual(resumed.checkpoint.approval.history.map(entry => entry.state), [
    "requested", "pending", "approved", "resumed"
  ]);
  const envelopeAfter = await findWorkTaskEnvelope(worldRoot, "pending-round-trip");
  assert.equal(envelopeAfter.task.status, "implementing");
  assert.equal(envelopeAfter.task.checkpoint.approval.resumeCount, 1);
  await assert.rejects(
    () => decideHeadquartersApproval(worldRoot, {
      taskId: "pending-round-trip",
      action: "send",
      requestId: requested.requestId,
      resumeToken: requested.resumeToken,
      decision: "deny",
      now: "2026-08-24T12:06:00.000Z"
    }),
    /conflicting decision/
  );
});

test("approval restores every supported nonterminal phase without generic ready resumption", async () => {
  const worldRoot = await world();
  await policy(worldRoot, [["action send", "ask"]]);
  for (const [index, phase] of ["planning", "implementing", "reviewing", "revision"].entries()) {
    const taskId = `phase-${phase}-${index}`;
    await task(worldRoot, taskId, { status: phase });
    const pending = await requestHeadquartersApproval(worldRoot, {
      taskId,
      action: "send",
      proposal: { phase },
      now: "2026-08-24T12:06:00.000Z"
    });
    const resumed = await decideHeadquartersApproval(worldRoot, {
      taskId,
      action: "send",
      requestId: pending.requestId,
      resumeToken: pending.resumeToken,
      decision: "allow",
      now: "2026-08-24T12:07:00.000Z"
    });
    assert.equal(resumed.status, phase);
    assert.notEqual(resumed.status, "ready");
  }
});

test("denial, duplicate calls, stale tokens, generic resume, and recovery cannot bypass approval", async () => {
  const worldRoot = await world();
  await policy(worldRoot, [["action send", "ask"]]);
  await task(worldRoot, "approval-guards", {
    kind: "roadmap",
    checkpoint: { blocker: "turn timeout", activeTurn: {} }
  });
  const pending = await requestHeadquartersApproval(worldRoot, {
    taskId: "approval-guards",
    action: "send",
    proposal: { text: "guarded" },
    now: "2026-08-24T12:08:00.000Z"
  });
  const duplicateRequest = await requestHeadquartersApproval(worldRoot, {
    taskId: "approval-guards",
    action: "send",
    proposal: { text: "guarded" },
    now: "2026-08-24T12:09:00.000Z"
  });
  assert.equal(duplicateRequest.noop, true);
  assert.equal((await readApprovalEvidence(worldRoot, "approval-guards")).match(/su name event/g).length, 2);
  await assert.rejects(
    () => decideHeadquartersApproval(worldRoot, {
      taskId: "approval-guards",
      action: "send",
      requestId: pending.requestId,
      resumeToken: `${pending.resumeToken}-tampered`,
      decision: "approve"
    }),
    /stale or tampered/
  );
  assert.equal((await readWorkTaskStatus(worldRoot, "approval-guards")).status, "blocked");
  await assert.rejects(
    () => resumeWorkTask(worldRoot, "approval-guards", "bypass"),
    /approval bypass defective/
  );
  const current = await readWorkTaskStatus(worldRoot, "approval-guards");
  assert.equal(isRecoverableOperationalWorkTask(current, {
    now: "2026-08-24T13:00:00.000Z",
    staleTurnMs: 1
  }), false);
  assert.equal(await recoverOperationalWorkTask(worldRoot, "approval-guards", {
    now: "2026-08-24T13:00:00.000Z",
    staleTurnMs: 1
  }), null);
  const denied = await decideHeadquartersApproval(worldRoot, {
    taskId: "approval-guards",
    action: "send",
    requestId: pending.requestId,
    resumeToken: pending.resumeToken,
    decision: "deny",
    actor: "Sol",
    rationale: "Do not send.",
    now: "2026-08-24T12:10:00.000Z"
  });
  assert.equal(denied.state, "denied");
  assert.equal(denied.status, "blocked");
  assert.equal((await readWorkTaskStatus(worldRoot, "approval-guards")).checkpoint.approval.resumeCount, 0);
  const duplicateDecision = await decideHeadquartersApproval(worldRoot, {
    taskId: "approval-guards",
    action: "send",
    requestId: pending.requestId,
    resumeToken: pending.resumeToken,
    decision: "deny",
    actor: "Sol",
    rationale: "Do not send.",
    now: "2026-08-24T12:11:00.000Z"
  });
  assert.equal(duplicateDecision.noop, true);
  assert.deepEqual((await readWorkTaskStatus(worldRoot, "approval-guards")).checkpoint.approval.history.map(entry => entry.state), [
    "requested", "pending", "denied"
  ]);
  await assert.rejects(
    () => decideHeadquartersApproval(worldRoot, {
      taskId: "approval-guards",
      action: "send",
      requestId: pending.requestId,
      resumeToken: pending.resumeToken,
      decision: "approve"
    }),
    /conflicting decision/
  );
  await assert.rejects(
    () => resumeWorkTask(worldRoot, "approval-guards", "denied bypass"),
    /approval bypass defective/
  );
});

test("unsupported actions are defective and approval evidence is ordered and bound to the task", async () => {
  const worldRoot = await world();
  await policy(worldRoot, [["default", "truth"]]);
  await task(worldRoot, "unsupported-action");
  await assert.rejects(
    () => requestHeadquartersApproval(worldRoot, {
      taskId: "unsupported-action",
      action: "transfer",
      proposal: { text: "unsupported" }
    }),
    /unsupported action/
  );
  await policy(worldRoot, [["action send", "ask"]]);
  await task(worldRoot, "newspaper-binding");
  const pending = await requestHeadquartersApproval(worldRoot, {
    taskId: "newspaper-binding",
    action: "send",
    proposal: { text: "ordered" },
    now: "2026-08-24T12:12:00.000Z"
  });
  await decideHeadquartersApproval(worldRoot, {
    taskId: "newspaper-binding",
    action: "send",
    requestId: pending.requestId,
    resumeToken: pending.resumeToken,
    decision: "approve",
    actor: "Sol",
    rationale: "Proceed from the checkpoint.",
    now: "2026-08-24T12:13:00.000Z"
  });
  const evidence = await readApprovalEvidence(worldRoot, "newspaper-binding");
  const events = [...evidence.matchAll(/su name event ob text "(requested|pending|approved|resumed)"/g)].map(match => match[1]);
  assert.deepEqual(events, ["requested", "pending", "approved", "resumed"]);
  assert.match(evidence, /newspaper-binding/);
  assert.match(evidence, new RegExp(pending.requestId));
  assert.match(evidence, new RegExp(pending.checkpointIdentity));
  assert.match(evidence, /policy mode/);
  assert.match(evidence, /decision source/);
  assert.match(evidence, /resumption phase/);
  const parsedEvents = splitSentences(evidence).map(sentence => parse(sentence)).filter(sentence => (
    sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name === "work task approval"
  ));
  assert.equal(parsedEvents.length, 4);
});
