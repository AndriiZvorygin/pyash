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
  readHeadquartersStateSources
} from "../program/agent/headquarters/state.mjs";
import { parse } from "../program/understand/index.mjs";
import {
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

function commitmentBundle({ person = "person-ada", deadline = "2026-08-24", work = "work-fixture-mail-001" } = {}) {
  return normalizeLinkedClaimBundle([
    evidenceLine({
      facet: "bet",
      value: 'ob text "Prepare the decision packet"',
      source: "hq-mail-001 commitment"
    }),
    evidenceLine({
      facet: "person",
      value: `ob name ${person}`,
      source: "hq-mail-001 person-ref"
    }),
    evidenceLine({
      facet: "company",
      value: "ob name organization-analytical-engine",
      source: "hq-mail-001 company-ref"
    }),
    evidenceLine({
      facet: "deadline",
      value: `ob date ${deadline}`,
      source: "hq-mail-001 deadline"
    }),
    evidenceLine({
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

function dutyBundle() {
  return normalizeLinkedClaimBundle([
    evidenceLine({
      subject: "work-fixture-mail-001",
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
  const work = workTask("work-fixture-mail-001");
  const contested = normalizeLinkedClaimBundle([
    ...commitmentBundle().records.map(record => parse(record.sentence)),
    evidenceLine({
      facet: "person",
      value: "ob name person-charles",
      source: "hq-mail-002 person-ref",
      confidence: 0.8
    })
  ]);
  const snapshot = await projectHeadquartersState({
    asOf: "2026-08-25T00:00:00.000Z",
    bundles: [
      { kind: "bet", bundle: contested },
      { kind: "person", bundle: personBundle("person-ada", "Ada Lovelace", "hq-mail-001 person") },
      { kind: "person", bundle: personBundle("person-charles", "Charles Babbage", "hq-mail-002 person") },
      { kind: "company", bundle: companyBundle() },
      { kind: "duty", bundle: dutyBundle() }
    ],
    workTasks: [work, approvalTask],
    channels: [
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
      }
    ],
    newspaper: [
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
    ],
    spaces: [{
      name: "mailroom",
      source: { filename: "mailroom/.activity.pya" },
      activity: [{
        source: { filename: "mailroom/.activity.pya", sentenceOrdinal: 1 },
        sentence: { mood: "ya", su: { name: "correspondence worker" }, be: "wait" }
      }]
    }],
    newspaperLimit: 1
  });

  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(snapshot.work.map(task => task.taskId), [
    "approval-task-001",
    "work-fixture-mail-001"
  ]);
  assert.equal(snapshot.approvals.length, 1);
  assert.equal(snapshot.approvals[0].taskId, "approval-task-001");
  assert.equal(snapshot.approvals[0].state, "pending");

  const commitment = snapshot.commitments[0];
  assert.equal(commitment.status, "contested");
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

  assert.equal(snapshot.newspaper.length, 1);
  assert.equal(snapshot.newspaper[0].source.sentenceOrdinal, 2);
  assert.equal(snapshot.newspaper[0].sentence.su.name, "newspaper-new");
  assert.equal(snapshot.spaces.some(space => space.name === "mailroom"), true);
  assert.equal(snapshot.activityMarkers.some(marker => marker.marker === "approval-wait"), true);
  assert.equal(snapshot.activityMarkers.some(marker => marker.marker === "waiting-input"), true);
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

  const sources = await readHeadquartersStateSources({
    worldRoot,
    asOf: "2026-08-25T00:00:00.000Z",
    newspaperLimit: 1,
    bundles: [
      { kind: "bet", bundle: commitmentBundle() },
      { kind: "person", bundle: personBundle("person-ada", "Ada Lovelace", "hq-mail-001 person") },
      { kind: "company", bundle: companyBundle() },
      { kind: "duty", bundle: dutyBundle() }
    ]
  });
  const snapshot = await projectHeadquartersState({ ...sources, asOf: sources.asOf });

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
