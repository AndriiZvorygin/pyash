import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { parse } from "../program/understand/index.mjs";
import {
  clearExchangeRecorder,
  setExchangeRecorder
} from "../program/bridge/exchange.mjs";
import {
  enqueueInputEnvelope
} from "../program/agent/channel_core/queue.mjs";
import { establishAgent } from "../program/agent/admin.mjs";
import {
  projectHeadquartersBriefing,
  readHeadquartersBriefingPolicy,
  recordHeadquartersBriefing,
  serializeHeadquartersBriefing
} from "../program/agent/headquarters/briefing.mjs";
import {
  claimOldestWorkTask,
  enqueueWorkTask
} from "../program/runtime/work/queue.mjs";
import {
  readWorkTaskStatus,
  writeWorkTaskStatus
} from "../program/runtime/work/status.mjs";
import { buildWorkTask } from "../program/runtime/work/contract.mjs";

const execFile = promisify(execFileCallback);
const AS_OF = "2026-08-24T12:00:00.000Z";
const OWNER = "correspondence worker";
const SOURCE_ROOT = "fixture-mail";

async function makeWorld(prefix = "pyash-headquarters-briefing-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  await establishAgent({
    worldRoot,
    agentName: "chief of staff",
    purpose: "Coordinate Headquarters work.",
    organization: { role: "Chief of Staff", supervisor: "", domains: ["headquarters"] }
  });
  await establishAgent({
    worldRoot,
    agentName: OWNER,
    purpose: "Handle correspondence.",
    organization: { role: "Correspondence Worker", supervisor: "chief of staff", domains: ["correspondence"] }
  });
  return worldRoot;
}

function sourceFor(id, overrides = {}) {
  return {
    identity: `${SOURCE_ROOT}:${id}`,
    kind: "fixture-mail",
    locator: `fixture://${id}`,
    provider: SOURCE_ROOT,
    messageId: id,
    subject: `Subject ${id}`,
    receivedAt: AS_OF,
    ...overrides
  };
}

async function addTask(worldRoot, taskId, {
  status = "implementing",
  priority = 50,
  deadline = "",
  source = sourceFor(taskId),
  checkpoint = {},
  title = `Task ${taskId}`,
  domain = "correspondence",
  queued = false
} = {}) {
  const enqueued = await enqueueWorkTask(worldRoot, {
    taskId,
    owner: OWNER,
    kind: "briefing-test",
    title,
    priority,
    status: "ready",
    queuedAt: AS_OF,
    acceptanceText: "The canonical evidence is preserved.",
    promptText: "Read the explicit canonical state.",
    source,
    domain,
    deadline,
    checkpoint
  });
  if (!queued) await fs.rm(enqueued.path, { force: true });
  const current = await readWorkTaskStatus(worldRoot, taskId);
  return writeWorkTaskStatus(worldRoot, buildWorkTask({ ...current, status }));
}

function newspaperMap(name, fields) {
  return [
    `su name ${name} be map def`,
    ...Object.entries(fields).map(([key, value]) => (
      `  su name ${key} ob text ${JSON.stringify(String(value ?? ""))} ya`
    )),
    "prah",
    ""
  ].join("\n");
}

async function appendNewspaper(worldRoot, name, records) {
  const directory = path.join(worldRoot, "newspaper");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, name),
    records.map(record => newspaperMap(record.name, record.fields)).join(""),
    "utf8"
  );
}

function itemIds(projection) {
  return projection.items.map(item => item.subjectIdentity);
}

async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("the canonical briefing policy loads and malformed, missing, or duplicate entries fail clearly", async () => {
  const policy = await readHeadquartersBriefingPolicy();
  assert.equal(policy.maximumItems, 5);
  assert.equal(policy.imminentHorizonHours, 24);
  assert.equal(policy.audienceIdentity, "chief of staff");
  assert.deepEqual(policy.categoryPrecedence, [
    "pending approval/decision",
    "explicit escalation",
    "overdue deadline",
    "deadline within horizon",
    "explicit reconciliation/conflict",
    "blocked or queued response work"
  ]);
  assert.deepEqual(policy.tieBreakFields, [
    "category precedence",
    "normalized deadline (missing last)",
    "existing numeric work priority (descending)",
    "evidence timestamp (missing last)",
    "stable identity (locale-independent lexical)"
  ]);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-briefing-policy-"));
  const missing = path.join(root, "missing.pya");
  await assert.rejects(
    readHeadquartersBriefingPolicy(missing),
    /headquarters briefing policy defective: policy module unavailable/
  );
  const malformed = path.join(root, "malformed.pya");
  await fs.writeFile(malformed, "su name headquarters briefing policy be map def\n", "utf8");
  await assert.rejects(
    readHeadquartersBriefingPolicy(malformed),
    /headquarters briefing policy defective/
  );
  const duplicate = path.join(root, "duplicate.pya");
  const source = await fs.readFile(path.resolve("module/headquarters-briefing.pya"), "utf8");
  await fs.writeFile(duplicate, source.replace(
    'su name maximum items ob num 5 ya',
    'su name maximum items ob num 5 ya\n  su name maximum items ob num 5 ya'
  ), "utf8");
  await assert.rejects(
    readHeadquartersBriefingPolicy(duplicate),
    /duplicate policy entry maximum items/
  );
});

test("a mixed canonical world has exact precedence, five unique subjects, and no prose heuristics", async () => {
  const worldRoot = await makeWorld();
  await addTask(worldRoot, "pending", {
    priority: 1,
    checkpoint: {
      approval: {
        state: "pending",
        taskId: "pending",
        requestId: "hq-request-pending",
        action: "send",
        checkpointIdentity: "checkpoint-pending",
        requestedAt: "2026-08-24T10:00:00.000Z"
      }
    }
  });
  await addTask(worldRoot, "escalated", {
    priority: 1,
    checkpoint: { interruption: { at: "2026-08-24T10:01:00.000Z" } }
  });
  await addTask(worldRoot, "overdue", { deadline: "2026-08-24T11:59:59.999Z", priority: 90 });
  await addTask(worldRoot, "imminent", { deadline: "2026-08-24T12:00:00.000Z", priority: 1 });
  await addTask(worldRoot, "reconcile", {
    checkpoint: { integration: { status: "reconciliation" } },
    priority: 80
  });
  await addTask(worldRoot, "outside", { deadline: "2026-08-25T12:00:00.001Z" });
  await addTask(worldRoot, "prose-only", {
    title: "Urgent conflict commitment waiting response",
    deadline: "",
    checkpoint: { implementation: { summary: "plain prose is not a signal" } }
  });
  const escalated = await readWorkTaskStatus(worldRoot, "escalated");
  await writeWorkTaskStatus(worldRoot, buildWorkTask({
    ...escalated,
    checkpoint: {
      ...escalated.checkpoint,
      ...{ blocker: "explicit blocker" },
      integration: escalated.checkpoint.integration,
      approval: escalated.checkpoint.approval
    },
    escalation: {
      state: "escalated",
      target: "chief of staff",
      reason: "explicit canonical escalation",
      timestamp: "2026-08-24T10:01:00.000Z",
      sourceIdentity: escalated.source.identity
    }
  }));

  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  assert.equal(projection.items.length, 5);
  assert.deepEqual(projection.items.map(item => item.category), [
    "pending approval/decision",
    "explicit escalation",
    "overdue deadline",
    "deadline within horizon",
    "explicit reconciliation/conflict"
  ]);
  assert.equal(new Set(itemIds(projection)).size, 5);
  assert.equal(projection.items.some(item => item.taskId === "outside"), false);
  assert.equal(projection.items.some(item => item.taskId === "prose-only"), false);
  assert.equal(projection.metadata.asOf, AS_OF);
  assert.equal(projection.metadata.maximumItems, 5);
});

test("approval evidence, deadline boundaries, terminal status, and evidence-free work obey policy", async () => {
  const worldRoot = await makeWorld();
  await addTask(worldRoot, "approval-bound", {
    deadline: "2026-08-24T12:00:00.000Z",
    checkpoint: {
      approval: {
        state: "pending",
        taskId: "approval-bound",
        requestId: "request-bound",
        action: "publish",
        checkpointIdentity: "checkpoint-bound",
        requestedAt: "2026-08-24T11:00:00.000Z"
      }
    }
  });
  await addTask(worldRoot, "at-bound", { deadline: AS_OF });
  await addTask(worldRoot, "inside-bound", { deadline: "2026-08-25T11:59:59.999Z" });
  await addTask(worldRoot, "outside-bound", { deadline: "2026-08-25T12:00:00.001Z" });
  await addTask(worldRoot, "overdue-bound", { deadline: "2026-08-24T11:59:59.999Z" });
  await addTask(worldRoot, "terminal", { status: "accepted", deadline: "2026-08-24T11:00:00.000Z" });
  await addTask(worldRoot, "no-evidence", { source: { identity: "", kind: "", locator: "" }, deadline: AS_OF });

  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  const byId = new Map(projection.items.map(item => [item.taskId, item]));
  assert.ok(byId.has("approval-bound"));
  assert.equal(byId.get("approval-bound").approval.requestId, "request-bound");
  assert.ok(byId.get("approval-bound").reasons.includes("pending approval/decision"));
  assert.equal(byId.get("at-bound").reasons.includes("overdue deadline"), false);
  assert.equal(byId.get("at-bound").reasons.includes("deadline within horizon"), true);
  assert.equal(byId.get("inside-bound").reasons.includes("deadline within horizon"), true);
  assert.equal(byId.has("outside-bound"), false);
  assert.equal(byId.get("overdue-bound").reasons.includes("overdue deadline"), true);
  assert.equal(byId.has("terminal"), false);
  assert.equal(byId.has("no-evidence"), false);
});

test("explicit queued channel work and reconciliation are projected, while duplicate delivery merges once", async () => {
  const worldRoot = await makeWorld();
  const payload = {
    provider: "fixture-mail",
    messageId: "golden-message-001",
    eventId: "golden-event-queued-001",
    sender: "decider@example.test",
    subject: "Decision packet",
    timestamp: AS_OF,
    receivedAt: AS_OF,
    domain: "correspondence",
    deadline: "2026-08-24T17:00:00.000Z",
    sourceLocator: "/fixtures/golden.pya#golden-message-001"
  };
  await enqueueInputEnvelope(worldRoot, {
    channelType: "fixture-mail",
    identity: "hq-inbox",
    agentName: OWNER,
    roomName: "hq-inbox",
    eventId: payload.eventId,
    payloadSentence: { mood: "ya", su: { name: payload.eventId }, be: "channel queued event", ob: { text: JSON.stringify(payload) } },
    queuedAt: AS_OF
  });
  await enqueueInputEnvelope(worldRoot, {
    channelType: "fixture-mail",
    identity: "hq-inbox",
    agentName: OWNER,
    roomName: "hq-inbox",
    eventId: "golden-event-queued-002",
    payloadSentence: { mood: "ya", su: { name: "golden-event-queued-002" }, be: "channel queued event", ob: { text: JSON.stringify(payload) } },
    queuedAt: AS_OF
  });
  await addTask(worldRoot, "fixture-mail-golden-message-001", {
    deadline: payload.deadline,
    source: sourceFor("golden-message-001", { provider: "fixture-mail", locator: payload.sourceLocator, subject: payload.subject }),
    checkpoint: { integration: { status: "reconciliation" } }
  });
  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  const golden = projection.items.find(item => item.sourceIdentity === "fixture-mail:golden-message-001");
  assert.ok(golden);
  assert.equal(projection.items.filter(item => item.sourceIdentity === golden.sourceIdentity).length, 1);
  assert.ok(golden.reasons.includes("deadline within horizon"));
  assert.ok(golden.channelLocators.length >= 1);
  assert.ok(golden.taskId);
});

test("golden fixture evidence is correlated and identical projections serialize byte-identically", async () => {
  const worldRoot = await makeWorld();
  await addTask(worldRoot, "fixture-mail-golden-message-001", {
    deadline: "2026-08-24T17:00:00.000Z",
    source: sourceFor("golden-message-001", {
      subject: "Decision packet for the headquarters",
      locator: path.resolve("examples/fixtures/headquarters/fixture-mail.pya") + "#golden-message-001"
    }),
    checkpoint: {
      approval: {
        state: "pending",
        taskId: "fixture-mail-golden-message-001",
        requestId: "hq-request-golden",
        action: "send",
        checkpointIdentity: "checkpoint-golden",
        requestedAt: "2026-08-24T10:00:00.000Z"
      }
    }
  });
  const task = await readWorkTaskStatus(worldRoot, "fixture-mail-golden-message-001");
  await writeWorkTaskStatus(worldRoot, buildWorkTask({
    ...task,
    escalation: {
      state: "escalated",
      target: "chief of staff",
      reason: "decision requirement plus deadline",
      timestamp: "2026-08-23T18:00:00.000Z",
      sourceIdentity: task.source.identity
    }
  }));
  await appendNewspaper(worldRoot, "20260823-headquarters-fixture-mail.pya", [
    { name: "headquarters fixture mail evidence", fields: {
      stage: "escalated",
      at: "2026-08-23T18:00:00.000Z",
      "source identity": "fixture-mail:golden-message-001",
      "message id": "golden-message-001",
      "task id": "fixture-mail-golden-message-001",
      "source locator": task.source.locator,
      "escalation reason": "decision requirement plus deadline",
      "escalation target": "chief of staff"
    }},
    { name: "headquarters fixture mail evidence", fields: {
      stage: "briefing-visible",
      at: "2026-08-23T18:00:00.000Z",
      "source identity": "fixture-mail:golden-message-001",
      "message id": "golden-message-001",
      "task id": "fixture-mail-golden-message-001",
      "source locator": task.source.locator
    }}
  ]);
  const first = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  const second = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  assert.deepEqual(second, first);
  assert.equal(serializeHeadquartersBriefing(second), serializeHeadquartersBriefing(first));
  assert.doesNotThrow(() => splitSentences(serializeHeadquartersBriefing(first)).map(sentence => parse(sentence)));
  const item = first.items[0];
  assert.equal(item.sourceIdentity, "fixture-mail:golden-message-001");
  assert.equal(item.messageId, "golden-message-001");
  assert.equal(item.approval.requestId, "hq-request-golden");
  assert.equal(item.approval.checkpointIdentity, "checkpoint-golden");
  assert.equal(item.escalation.reason, "decision requirement plus deadline");
  assert.equal(item.escalation.target, "chief of staff");
  assert.ok(item.newspaperLocators.some(locator => locator.includes("record-")));
  assert.ok(item.newspaperEvidence.some(evidence => evidence.stage === "escalated"));
  assert.ok(item.newspaperEvidence.some(evidence => evidence.stage === "briefing-visible"));
});

test("projection reads queued and runtime work envelopes without mutating holding lanes", async () => {
  const worldRoot = await makeWorld();
  const holdingRoot = path.join(worldRoot, "holding");
  assert.equal(await pathExists(holdingRoot), false);

  await addTask(worldRoot, "queued-work", { status: "ready", priority: 20, queued: true });
  await addTask(worldRoot, "runtime-work", { status: "implementing", priority: 10, queued: true });
  const claimed = await claimOldestWorkTask(worldRoot, {
    owner: OWNER,
    workerTag: "briefing-test"
  });
  assert.equal(claimed?.task?.taskId, "queued-work");

  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  const queued = projection.items.find(item => item.taskId === "runtime-work");
  const runtime = projection.items.find(item => item.taskId === "queued-work");
  assert.ok(queued);
  assert.ok(runtime);
  assert.ok(queued.reasons.includes("blocked or queued response work"));
  assert.ok(runtime.reasons.includes("blocked or queued response work"));
  assert.equal(
    queued.signals.find(signal => signal.name === "blocked or queued response work").evidence.workEnvelopePhase,
    "input"
  );
  assert.equal(
    runtime.signals.find(signal => signal.name === "blocked or queued response work").evidence.workEnvelopePhase,
    "runtime"
  );
  assert.equal(await pathExists(holdingRoot), true);
});

test("projection ignores newspaper prose and unrelated typed fields during correlation", async () => {
  const worldRoot = await makeWorld();
  await addTask(worldRoot, "collision", { deadline: AS_OF });
  await appendNewspaper(worldRoot, "collision.pya", [
    {
      name: "unrelated evidence",
      fields: {
        stage: "escalated",
        note: "fixture-mail:collision",
        explanation: "this prose is not a source identity"
      }
    }
  ]);

  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  const item = projection.items.find(candidate => candidate.taskId === "collision");
  assert.ok(item);
  assert.equal(item.escalation, null);
  assert.deepEqual(item.newspaperEvidence, []);
  assert.deepEqual(item.newspaperLocators, []);
});

test("canonical newspaper names containing the derived prefix remain readable", async () => {
  const worldRoot = await makeWorld();
  const source = sourceFor("canonical-newspaper", { locator: "fixture://canonical-newspaper" });
  await addTask(worldRoot, "canonical-newspaper", { source });
  await appendNewspaper(worldRoot, "20260824-headquarters-briefing-canonical.pya", [{
    name: "canonical escalation evidence",
    fields: {
      stage: "escalated",
      at: "2026-08-24T10:00:00.000Z",
      "task id": "canonical-newspaper",
      "source identity": source.identity,
      "source locator": source.locator,
      "escalation reason": "canonical evidence",
      "escalation target": "chief of staff"
    }
  }]);

  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  const item = projection.items.find(candidate => candidate.taskId === "canonical-newspaper");
  assert.ok(item);
  assert.equal(item.category, "explicit escalation");
  assert.equal(item.escalation.reason, "canonical evidence");
  assert.equal(item.newspaperEvidence[0].stage, "escalated");
});

test("ready work is a canonical queued signal and conflicting newspaper locators are defective", async () => {
  const worldRoot = await makeWorld();
  const source = sourceFor("ready-work", { locator: "fixture://ready-work" });
  await addTask(worldRoot, "ready-work", { status: "ready", source });
  const readyProjection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  assert.equal(readyProjection.items.length, 1);
  assert.deepEqual(readyProjection.items[0].reasons, ["blocked or queued response work"]);
  assert.equal(
    readyProjection.items[0].signals[0].evidence.workEnvelopePhase,
    ""
  );

  await appendNewspaper(worldRoot, "conflicting-source-locator.pya", [{
    name: "conflicting evidence",
    fields: {
      stage: "escalated",
      at: "2026-08-24T10:00:00.000Z",
      "task id": "ready-work",
      "source identity": source.identity,
      "source locator": "fixture://different-source"
    }
  }]);
  await assert.rejects(
    projectHeadquartersBriefing(worldRoot, { asOf: AS_OF }),
    /conflicting newspaper evidence for source locator/
  );
});

test("projection does not create holding lanes when the canonical world is empty", async () => {
  const worldRoot = await makeWorld();
  const holdingRoot = path.join(worldRoot, "holding");
  assert.equal(await pathExists(holdingRoot), false);
  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  assert.deepEqual(projection.items, []);
  assert.equal(await pathExists(holdingRoot), false);
});

test("explicit asOf excludes future queued state and future newspaper signals", async () => {
  const worldRoot = await makeWorld();
  const futureTask = await addTask(worldRoot, "future-task", { deadline: AS_OF });
  await writeWorkTaskStatus(worldRoot, buildWorkTask({
    ...futureTask,
    queuedAt: "2026-08-25T12:00:00.000Z"
  }));
  await enqueueInputEnvelope(worldRoot, {
    channelType: "fixture-mail",
    identity: "hq-inbox",
    agentName: OWNER,
    roomName: "hq-inbox",
    eventId: "future-channel-event",
    queuedAt: "2026-08-25T12:00:00.000Z",
    payloadSentence: {
      mood: "ya",
      su: { name: "future-channel-event" },
      be: "channel queued event",
      ob: { text: JSON.stringify({
        provider: "fixture-mail",
        messageId: "future-message",
        eventId: "future-channel-event",
        sourceLocator: "fixture://future-message"
      }) }
    }
  });
  await addTask(worldRoot, "future-evidence", { deadline: "" });
  await appendNewspaper(worldRoot, "future-evidence.pya", [{
    name: "future escalation",
    fields: {
      stage: "escalated",
      at: "2026-08-25T12:00:00.000Z",
      "source identity": "fixture-mail:future-evidence",
      "message id": "future-evidence",
      "task id": "future-evidence"
    }
  }]);

  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  assert.equal(projection.candidateCount, 0);
  assert.deepEqual(projection.items, []);
});

test("recording creates a derived artifact and standard replay detects a tampered linked source", async () => {
  const worldRoot = await makeWorld("pyash-headquarters-recording-");
  const sourcePath = path.join(worldRoot, "source.pya");
  await fs.writeFile(sourcePath, newspaperMap("source", { identity: "source-001" }), "utf8");
  await addTask(worldRoot, "recorded", {
    source: sourceFor("recorded", { locator: sourcePath }),
    deadline: AS_OF
  });
  const projection = await projectHeadquartersBriefing(worldRoot, { asOf: AS_OF });
  const recorded = [];
  setExchangeRecorder({ runRoot: worldRoot, record: sentence => recorded.push(sentence) });
  try {
    const result = await recordHeadquartersBriefing(worldRoot, projection);
    assert.ok(result.artifact.hash);
    assert.ok(result.artifact.locator.endsWith(".pya"));
    assert.ok(result.newspaper.locator.endsWith(".pya"));
  } finally {
    clearExchangeRecorder();
  }
  assert.ok(recorded.length >= 1);
  const runId = "briefing-replay";
  await fs.mkdir(path.join(worldRoot, "newspaper"), { recursive: true });
  await fs.writeFile(
    path.join(worldRoot, "newspaper", `${runId}.pya`),
    recorded.map(sentence => `${sentenceToPyash(sentence)}\n`).join(""),
    "utf8"
  );
  const replayArgs = [
    path.resolve("command/replay_newspaper.mjs"),
    "--run-id",
    runId,
    "--run-root",
    worldRoot
  ];
  const replayed = await execFile(process.execPath, replayArgs, { cwd: path.resolve(".") });
  assert.match(replayed.stdout, /replay ya/);
  const sourceArtifact = recorded.find(sentence => sentence?.to?.filename === "source.pya");
  assert.ok(sourceArtifact);
  const hash = sourceArtifact.fromtext.text;
  const contentAddressed = path.join(
    worldRoot,
    "artifacts",
    "sha256",
    hash.slice(0, 2),
    hash.slice(2, 4),
    `${hash}.pya`
  );
  await fs.appendFile(contentAddressed, "tampered\n", "utf8");
  await assert.rejects(
    execFile(process.execPath, replayArgs, { cwd: path.resolve(".") }),
    /hash inconsistency/
  );
  await fs.appendFile(sourcePath, "changed after projection\n", "utf8");
  await assert.rejects(
    recordHeadquartersBriefing(worldRoot, projection),
    /linked source changed after projection/
  );
  assert.equal(crypto.createHash("sha256").update(serializeHeadquartersBriefing(projection)).digest("hex").length, 64);
});
