import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { eventToSentence } from "../program/agent/channel_core/contract.mjs";
import { enqueueInputEnvelope } from "../program/agent/channel_core/queue.mjs";
import {
  listWorkTasks
} from "../program/runtime/work/operator.mjs";
import { buildWorkTask } from "../program/runtime/work/contract.mjs";
import {
  projectHeadquartersState,
  readHeadquartersState,
  readHeadquartersStateSources
} from "../program/agent/headquarters/state.mjs";
import { parse } from "../program/understand/index.mjs";
import {
  compareUtf8Bytes,
  normalizeLinkedClaimBundle
} from "../program/library/knowledge_core.mjs";

function evidenceLine({ subject = "commitment-001", facet, value, source, confidence = 0.9 } = {}) {
  return parse([
    `su name ${subject}`,
    value,
    `fromtext text ${JSON.stringify(source)}`,
    "accordingto name direct-evidential",
    `by num ${confidence}`,
    `be ${facet} ya`
  ].join(" "));
}

function commitmentBundle({ subject = "commitment-001", person = "person-ada", deadline = "2026-08-24", work = "work-fixture-mail-001" } = {}) {
  return normalizeLinkedClaimBundle([
    evidenceLine({
      subject,
      facet: "bet",
      value: 'ob text "Prepare the decision packet"',
      source: "hq-mail-001 commitment"
    }),
    evidenceLine({
      subject,
      facet: "person",
      value: `ob name ${person}`,
      source: "hq-mail-001 person-ref"
    }),
    evidenceLine({
      subject,
      facet: "company",
      value: "ob name organization-analytical-engine",
      source: "hq-mail-001 company-ref"
    }),
    evidenceLine({
      subject,
      facet: "deadline",
      value: `ob date ${deadline}`,
      source: "hq-mail-001 deadline"
    }),
    evidenceLine({
      subject,
      facet: "duty",
      value: `ob name ${work}`,
      source: "hq-mail-001 work-ref"
    })
  ]);
}

function personBundle(subject, label, source) {
  return normalizeLinkedClaimBundle([
    evidenceLine({
      subject,
      facet: "person",
      value: `ob text ${JSON.stringify(label)}`,
      source
    })
  ]);
}

function companyBundle() {
  return normalizeLinkedClaimBundle([
    evidenceLine({
      subject: "organization-analytical-engine",
      facet: "company",
      value: 'ob text "Analytical Engine"',
      source: "hq-mail-001 company"
    })
  ]);
}

function dutyBundle(work = "work-fixture-mail-001") {
  return normalizeLinkedClaimBundle([
    evidenceLine({
      subject: work,
      facet: "duty",
      value: 'ob text "Decision packet"',
      source: "hq-mail-001 duty"
    })
  ]);
}

function workTask(taskId, overrides = {}) {
  return buildWorkTask({
    taskId,
    owner: "correspondence worker",
    kind: "correspondence",
    title: `Work for ${taskId}`,
    priority: 40,
    status: "ready",
    queuedAt: "2026-08-23T18:00:00.000Z",
    acceptanceText: "The canonical work record remains replayable.",
    promptText: "Prepare the bounded work item.",
    source: {
      identity: `fixture:${taskId}`,
      kind: "fixture-mail",
      locator: `fixture://${taskId}`
    },
    domain: "correspondence",
    ...overrides
  });
}

test("Headquarters state preserves contested Knowledge Core commitments and checkpoint approvals", async () => {
  const approvalTask = workTask("approval-task-001", {
    status: "blocked",
    escalation: {
      state: "open",
      target: "chief of staff",
      reason: "decision deadline requires review",
      timestamp: "2026-08-24T15:00:00.000Z",
      sourceIdentity: "fixture:approval-task-001"
    },
    delegationEvents: [
      {
        type: "assigned",
        timestamp: "2026-08-24T10:00:00.000Z",
        actor: "chief of staff",
        recipient: "correspondence worker",
        note: "prepare the packet",
        sourceIdentity: "fixture:approval-task-001"
      },
      {
        type: "escalated",
        timestamp: "2026-08-24T15:00:00.000Z",
        actor: "correspondence worker",
        recipient: "chief of staff",
        note: "decision is required",
        sourceIdentity: "fixture:approval-task-001"
      }
    ],
    checkpoint: {
      approval: {
        state: "pending",
        requestId: "hq-request-001",
        action: "send",
        proposal: { text: "send the response" },
        checkpointIdentity: "checkpoint-001",
        resumeStatus: "implementing",
        resumePhase: "implementing"
      }
    }
  });
  const work = workTask("work-fixture-mail-001", { status: "implementing" });
  const futureTask = workTask("future-task-001", {
    domain: "future",
    queuedAt: "2026-08-26T00:00:00.000Z",
    status: "accepted",
    checkpoint: {
      approval: {
        state: "pending",
        requestId: "future-request-001"
      }
    }
  });
  const contested = normalizeLinkedClaimBundle([
    ...commitmentBundle().records.map(record => parse(record.sentence)),
    evidenceLine({
      facet: "person",
      value: "ob name person-charles",
      source: "hq-mail-002 person-ref",
      confidence: 0.8
    })
  ]);
  const contestedDescription = normalizeLinkedClaimBundle([
    ...commitmentBundle({ subject: "commitment-002", work: "work-fixture-mail-002" })
      .records.map(record => parse(record.sentence)),
    evidenceLine({
      subject: "commitment-002",
      facet: "bet",
      value: 'ob text "Send the revised decision packet"',
      source: "hq-mail-002 commitment",
      confidence: 0.8
    })
  ]);
  const bundles = [
    { kind: "bet", bundle: contested },
    { kind: "bet", bundle: contestedDescription },
    { kind: "person", bundle: personBundle("person-ada", "Ada Lovelace", "hq-mail-001 person") },
    { kind: "person", bundle: personBundle("person-charles", "Charles Babbage", "hq-mail-002 person") },
    { kind: "company", bundle: companyBundle() },
    { kind: "duty", bundle: dutyBundle() },
    { kind: "duty", bundle: dutyBundle("work-fixture-mail-002") }
  ];
  const workTasks = [work, workTask("work-fixture-mail-002"), approvalTask, futureTask];
  const channels = [
    {
      location: "input",
      filename: "20260824-fixture.pya",
      path: "/world/holding/channel/input/20260824-fixture.pya",
      envelope: {
        phase: "input",
        queuedAt: "2026-08-24T12:00:00.000Z",
        channelType: "fixture-mail",
        agentName: "correspondence worker",
        identity: "inbox-main"
      }
    },
    {
      location: "runtime",
      filename: "20260824-runtime.pya",
      path: "/world/holding/channel/runtime/20260824-runtime.pya",
      envelope: {
        phase: "input",
        queuedAt: "2026-08-24T12:01:00.000Z",
        channelType: "fixture-mail",
        agentName: "correspondence worker",
        identity: "runtime-main"
      }
    },
    {
      location: "produce-waiting",
      filename: "20260824-produce-waiting.pya",
      path: "/world/holding/channel/produce/waiting/20260824-produce-waiting.pya",
      envelope: {
        phase: "produce",
        queuedAt: "2026-08-24T12:02:00.000Z",
        channelType: "fixture-mail",
        agentName: "correspondence worker",
        identity: "produce-main"
      }
    },
    {
      location: "produce-success",
      filename: "20260824-produce-success.pya",
      path: "/world/holding/channel/produce/success/20260824-produce-success.pya",
      envelope: {
        phase: "produce",
        queuedAt: "2026-08-24T12:03:00.000Z",
        channelType: "fixture-mail",
        agentName: "correspondence worker",
        identity: "produce-success"
      }
    },
    {
      location: "produce-fail",
      filename: "20260824-produce-fail.pya",
      path: "/world/holding/channel/produce/fail/20260824-produce-fail.pya",
      envelope: {
        phase: "produce",
        queuedAt: "2026-08-24T12:04:00.000Z",
        channelType: "fixture-mail",
        agentName: "correspondence worker",
        identity: "produce-fail"
      }
    }
  ];
  const newspaper = [
    {
      source: { filename: "20260824-hq.pya", sentenceOrdinal: 1 },
      timestamp: "2026-08-24T13:00:00.000Z",
      sentence: { mood: "ya", su: { name: "newspaper-old" }, be: "wait" }
    },
    {
      source: { filename: "20260824-hq.pya", sentenceOrdinal: 2 },
      timestamp: "2026-08-24T14:00:00.000Z",
      sentence: { mood: "ya", su: { name: "newspaper-new" }, be: "wait" }
    }
  ];
  const spaces = [{
    name: "mailroom",
    source: { filename: "mailroom/.activity.pya" },
    activity: [{
      source: { filename: "mailroom/.activity.pya", sentenceOrdinal: 1 },
      timestamp: "2026-08-24T13:00:00.000Z",
      sentence: { mood: "ya", su: { name: "correspondence worker" }, be: "wait" }
    }, {
      source: { filename: "mailroom/.activity.pya", sentenceOrdinal: 2 },
      timestamp: "2026-08-24T14:00:00.000Z",
      sentence: { mood: "ya", su: { name: "chief of staff" }, be: "review" }
    }]
  }];
  const snapshot = await projectHeadquartersState({
    asOf: "2026-08-25T00:00:00.000Z",
    bundles,
    workTasks,
    channels,
    newspaper,
    spaces,
    newspaperLimit: 1
  });

  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(snapshot.work.map(task => task.taskId), [
    "approval-task-001",
    "work-fixture-mail-001",
    "work-fixture-mail-002"
  ]);
  assert.equal(snapshot.work.some(task => task.taskId === "future-task-001"), false);
  assert.equal(snapshot.approvals.some(approval => approval.taskId === "future-task-001"), false);
  assert.equal(snapshot.activityMarkers.some(marker => marker.source.taskId === "future-task-001"), false);
  assert.equal(snapshot.layout.rooms.some(room => room.name === "workplace/future"), false);
  assert.equal(snapshot.layout.placements.some(placement => placement.id === "future-task-001"), false);
  assert.equal(snapshot.approvals.length, 1);
  assert.equal(snapshot.approvals[0].taskId, "approval-task-001");
  assert.equal(snapshot.approvals[0].state, "pending");

  const commitment = snapshot.commitments[0];
  assert.equal(commitment.status, "contested");
  assert.equal(commitment.description, "Prepare the decision packet");
  assert.deepEqual(commitment.descriptionCandidates, []);
  assert.equal(commitment.person.status, "contested");
  assert.equal(commitment.person.record, null);
  assert.deepEqual(commitment.person.records.map(record => record.payload.name), [
    "person-ada",
    "person-charles"
  ]);
  assert.equal(commitment.company.record.payload.name, "organization-analytical-engine");
  assert.equal(commitment.deadline.record.payload.date, "2026-08-24");
  assert.equal(commitment.duty.record.payload.name, "work-fixture-mail-001");
  assert.equal(commitment.evidence.length, 6);
  assert.equal(commitment.evidence.every(record => record.anchorId.includes("#")), true);
  assert.equal(commitment.provenance.person.records.length, 2);
  const contestedDescriptionCommitment = snapshot.commitments.find(
    candidate => candidate.id === "commitment-002"
  );
  assert.equal(contestedDescriptionCommitment.status, "contested");
  assert.equal(contestedDescriptionCommitment.description, null);
  assert.deepEqual(
    contestedDescriptionCommitment.descriptionCandidates.map(record => record.payload.text),
    ["Prepare the decision packet", "Send the revised decision packet"]
  );

  assert.equal(snapshot.newspaper.length, 1);
  assert.equal(snapshot.newspaper[0].source.sentenceOrdinal, 2);
  assert.equal(snapshot.newspaper[0].sentence.su.name, "newspaper-new");
  assert.equal(snapshot.spaces.some(space => space.name === "mailroom"), true);
  assert.equal(snapshot.activityMarkers.some(marker => marker.marker === "approval-wait"), true);
  assert.equal(snapshot.activityMarkers.some(marker => marker.marker === "waiting-input"), true);
  assert.equal(snapshot.activityMarkers.some(marker => (
    marker.source.kind === "work"
      && marker.source.taskId === "work-fixture-mail-001"
      && marker.marker === "active"
  )), true);
  assert.equal(snapshot.activityMarkers.some(marker => (
    marker.source.kind === "channel"
      && marker.source.location === "runtime"
      && marker.marker === "claimed"
  )), true);
  assert.equal(snapshot.activityMarkers.some(marker => (
    marker.source.kind === "channel"
      && marker.source.location === "produce-waiting"
      && marker.marker === "handoff"
  )), true);
  assert.equal(snapshot.activityMarkers.some(marker => (
    marker.source.kind === "channel"
      && marker.source.location === "produce-success"
      && marker.marker === "completion"
  )), true);
  assert.equal(snapshot.activityMarkers.some(marker => (
    marker.source.kind === "channel"
      && marker.source.location === "produce-fail"
      && marker.marker === "failure"
  )), true);
  assert.equal(snapshot.activityMarkers.some(marker => (
    marker.source.kind === "channel"
      && marker.source.location === "produce-fail"
      && marker.marker === "escalation"
  )), false);
  const approvalTaskMarkers = snapshot.activityMarkers.filter(
    marker => marker.source.kind === "work" && marker.source.taskId === "approval-task-001"
  );
  assert.equal(approvalTaskMarkers.some(marker => marker.marker === "status" && marker.status === "blocked"), true);
  assert.equal(approvalTaskMarkers.some(marker => marker.marker === "blocked"), true);
  assert.equal(approvalTaskMarkers.some(marker => marker.marker === "approval-wait"), true);
  assert.equal(approvalTaskMarkers.some(marker => marker.marker === "escalation"), true);
  assert.equal(approvalTaskMarkers.filter(marker => marker.marker === "handoff").length, 1);
  assert.equal(approvalTaskMarkers.some(marker => (
    marker.marker === "delegation" && marker.eventType === "escalated"
  )), true);
  assert.equal(approvalTaskMarkers.some(marker => marker.marker === "waiting-input"), false);
  assert.deepEqual(snapshot.layout.rooms.map(room => room.name), [
    "chief-of-staff",
    "mailroom",
    "workplace/correspondence"
  ]);
  const workPlacement = snapshot.layout.placements.find(
    placement => placement.kind === "work" && placement.id === "approval-task-001"
  );
  const workRoom = snapshot.layout.rooms.find(room => room.name === workPlacement.room);
  assert.equal(workPlacement.x >= workRoom.bounds.x, true);
  assert.equal(workPlacement.y >= workRoom.bounds.y, true);
  assert.equal(workPlacement.x + workPlacement.width <= workRoom.bounds.x + workRoom.bounds.width, true);
  assert.equal(workPlacement.y + workPlacement.height <= workRoom.bounds.y + workRoom.bounds.height, true);
  assert.equal(Object.isFrozen(snapshot.layout), true);

  const limited = await projectHeadquartersState({
    asOf: "2026-08-25T00:00:00.000Z",
    bundles,
    workTasks,
    channels,
    newspaper,
    spaces,
    collectionLimits: {
      commitments: 1,
      work: 1,
      approvals: 0,
      channels: 1,
      newspaper: 1,
      spaces: 1,
      activityMarkers: 1,
      spaceActivity: 1
    }
  });
  const expectedLimits = {
    commitments: 1,
    work: 1,
    approvals: 0,
    channels: 1,
    newspaper: 1,
    spaces: 1,
    activityMarkers: 1
  };
  for (const name of [
    "commitments",
    "work",
    "approvals",
    "channels",
    "newspaper",
    "spaces",
    "activityMarkers"
  ]) {
    assert.equal(limited.pagination[name].limit, expectedLimits[name]);
    assert.equal(limited.pagination[name].total >= limited.pagination[name].returned, true);
    assert.equal(
      limited.pagination[name].truncated,
      limited.pagination[name].returned < limited.pagination[name].total
    );
  }
  assert.equal(limited.pagination.commitments.total, 2);
  assert.equal(limited.pagination.work.total, 3);
  assert.equal(limited.pagination.approvals.total, 1);
  assert.equal(limited.pagination.channels.total, 5);
  assert.equal(limited.pagination.newspaper.total, 2);
  assert.equal(limited.pagination.spaces.total, 1);
  assert.equal(limited.pagination.activityMarkers.total > 1, true);
  assert.equal(limited.pagination.spaceActivity[0].limit, 1);
  assert.equal(limited.pagination.spaceActivity[0].total, 2);

  const duplicateSpaces = [
    spaces[0],
    { ...spaces[0], source: { filename: "mailroom/duplicate.activity.pya" } }
  ];
  await assert.rejects(
    () => projectHeadquartersState({ asOf: snapshot.asOf, bundles, workTasks, channels, newspaper, spaces: duplicateSpaces }),
    /duplicate space name: mailroom/
  );
  await assert.rejects(
    () => projectHeadquartersState({ asOf: snapshot.asOf, bundles, workTasks, channels, newspaper, spaces: [...duplicateSpaces].reverse() }),
    /duplicate space name: mailroom/
  );

  const reordered = await projectHeadquartersState({
    asOf: "2026-08-25T00:00:00.000Z",
    bundles: [...bundles].reverse(),
    workTasks: [...workTasks].reverse(),
    channels: [...channels].reverse(),
    newspaper: [...newspaper].reverse(),
    spaces: spaces.map(space => ({
      ...space,
      activity: [...space.activity].reverse()
    })),
    newspaperLimit: 1
  });
  assert.equal(
    Buffer.from(JSON.stringify(reordered), "utf8").equals(
      Buffer.from(JSON.stringify(snapshot), "utf8")
    ),
    true
  );
});

test("Headquarters filesystem reading is deterministic and does not prepare empty queues", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-headquarters-state-empty-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  const before = await fs.readdir(worldRoot);

  const sources = await readHeadquartersStateSources({
    worldRoot,
    asOf: "2026-08-25T00:00:00.000Z",
    newspaperLimit: 3
  });

  assert.deepEqual(sources.workTasks, []);
  assert.deepEqual(sources.channels, []);
  assert.deepEqual(sources.newspaper, []);
  assert.deepEqual(sources.spaces, []);
  assert.deepEqual(await fs.readdir(worldRoot), before);
  await assert.rejects(
    fs.stat(path.join(worldRoot, "holding")),
    error => error?.code === "ENOENT"
  );
});

test("Headquarters filesystem reader uses canonical work, channel, newspaper, and activity records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-headquarters-state-world-"));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  const work = workTask("work-fixture-mail-001");
  const { enqueueWorkTask } = await import("../program/runtime/work/queue.mjs");
  await enqueueWorkTask(worldRoot, work);
  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-08-24T11:00:00.000Z",
    channelType: "fixture-mail",
    identity: "inbox-main",
    agentName: "correspondence-worker",
    roomName: "inbox-main",
    eventId: "fixture-event-001",
    payloadSentence: eventToSentence({
      payloadId: "fixture-event-001",
      fromEndpoint: "channel fixture-mail room inbox-main",
      toEndpoint: "agent correspondence-worker",
      payloadText: "prepare the packet",
      targetAgentName: "correspondence-worker",
      sessionId: "fixture-session-001"
    })
  });

  const newspaperDir = path.join(worldRoot, "newspaper");
  await fs.mkdir(newspaperDir, { recursive: true });
  await fs.writeFile(
    path.join(newspaperDir, "20260824-hq.pya"),
    [
      "su name old event at date 2026-08-24T12:00:00.000Z be wait ya",
      "su name new event at date 2026-08-24T13:00:00.000Z be wait ya"
    ].join("\n") + "\n",
    "utf8"
  );
  const activityDir = path.join(worldRoot, "mailroom");
  await fs.mkdir(activityDir, { recursive: true });
  await fs.writeFile(
    path.join(activityDir, ".activity.pya"),
    `${sentenceToPyash({
      mood: "ya",
      su: { name: "correspondence-worker" },
      at: { date: "2026-08-24T13:30:00.000Z" },
      be: "wait"
    })}\n`,
    "utf8"
  );

  const knowledgeBundles = [
    { kind: "bet", bundle: commitmentBundle() },
    { kind: "person", bundle: personBundle("person-ada", "Ada Lovelace", "hq-mail-001 person") },
    { kind: "company", bundle: companyBundle() },
    { kind: "duty", bundle: dutyBundle() }
  ];
  const beforeRead = (await fs.readdir(worldRoot, { recursive: true })).sort(compareUtf8Bytes);
  const sources = await readHeadquartersStateSources({
    worldRoot,
    asOf: "2026-08-25T00:00:00.000Z",
    newspaperLimit: 1,
    bundles: knowledgeBundles
  });
  const afterRead = (await fs.readdir(worldRoot, { recursive: true })).sort(compareUtf8Bytes);
  assert.deepEqual(afterRead, beforeRead);
  const snapshot = await projectHeadquartersState({ ...sources, asOf: sources.asOf });
  const directSnapshot = await readHeadquartersState({
    worldRoot,
    asOf: sources.asOf,
    newspaperLimit: 1,
    bundles: knowledgeBundles
  });
  assert.equal(JSON.stringify(directSnapshot), JSON.stringify(snapshot));
  const afterDirectRead = (await fs.readdir(worldRoot, { recursive: true })).sort(compareUtf8Bytes);
  assert.deepEqual(afterDirectRead, beforeRead);

  assert.equal((await listWorkTasks(worldRoot, { includeTerminal: true })).length, 1);
  assert.equal(snapshot.work[0].taskId, "work-fixture-mail-001");
  assert.equal(snapshot.channels.length, 1);
  assert.equal(snapshot.channels[0].location, "input");
  assert.equal(snapshot.channels[0].eventId, "fixture-event-001");
  assert.equal(snapshot.newspaper.length, 1);
  assert.equal(snapshot.newspaper[0].source.filename, "newspaper/20260824-hq.pya");
  assert.equal(snapshot.newspaper[0].source.sentenceOrdinal, 2);
  assert.equal(snapshot.spaces[0].name, "mailroom");
  assert.equal(snapshot.spaces[0].activity[0].sentence.be, "wait");
});
