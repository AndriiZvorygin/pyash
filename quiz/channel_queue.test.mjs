import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  channelQueuePaths,
  ensureChannelQueueDirs,
  enqueueInputEnvelope,
  enqueueProduceEnvelope,
  claimOldestInputEnvelope,
  claimOldestProduceEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail,
  queueDepth
} from "../program/agent/channel_core/queue.mjs";
import {
  eventToSentence,
  ackToSentence
} from "../program/agent/channel_core/contract.mjs";

test("channel queue creates expected directory layout under world/holding/channel", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-queue-layout-"));
  const worldRoot = path.join(root, "world");
  const paths = await ensureChannelQueueDirs(worldRoot);
  assert.equal(paths.root, path.join(worldRoot, "holding", "channel"));

  const statInput = await fs.stat(paths.inputDir);
  const statRuntime = await fs.stat(paths.runtimeDir);
  const statProduce = await fs.stat(paths.produceDir);
  const statSuccess = await fs.stat(paths.produceSuccessDir);
  const statFail = await fs.stat(paths.produceFailDir);
  assert.equal(statInput.isDirectory(), true);
  assert.equal(statRuntime.isDirectory(), true);
  assert.equal(statProduce.isDirectory(), true);
  assert.equal(statSuccess.isDirectory(), true);
  assert.equal(statFail.isDirectory(), true);
});

test("channel queue enqueues and claims oldest input envelope with parsed payload sentence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-queue-input-"));
  const worldRoot = path.join(root, "world");
  const payloadOld = eventToSentence({
    payloadId: "news-20260213-0001",
    fromEndpoint: "channel matrix room !room:server",
    toEndpoint: "agent mricge",
    payloadText: "oldest",
    targetAgentName: "mricge",
    sessionId: "session name matrix_room"
  });
  const payloadNew = eventToSentence({
    payloadId: "news-20260213-0002",
    fromEndpoint: "channel matrix room !room:server",
    toEndpoint: "agent mricge",
    payloadText: "newest",
    targetAgentName: "mricge",
    sessionId: "session name matrix_room"
  });

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-02-13T18:30:10.000Z",
    channelType: "matrix",
    identity: "@mricge:matrix.liberit.ca",
    agentName: "mricge",
    roomName: "!room:server",
    eventId: "$old",
    payloadSentence: payloadOld
  });
  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-02-13T18:30:11.000Z",
    channelType: "matrix",
    identity: "@mricge:matrix.liberit.ca",
    agentName: "mricge",
    roomName: "!room:server",
    eventId: "$new",
    payloadSentence: payloadNew
  });

  const first = await claimOldestInputEnvelope(worldRoot, { workerTag: "router" });
  assert.equal(first?.envelope?.eventId, "$old");
  assert.equal(first?.envelope?.payloadSentence?.ob?.text, "oldest");
});

test("channel queue supports produce queue claims and success/fail transitions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-queue-produce-"));
  const worldRoot = path.join(root, "world");
  const producePayload = ackToSentence({
    messageId: "matrix-event-20260213-0001",
    fromEndpoint: "agent mricge",
    toEndpoint: "channel matrix room !room:server",
    payloadId: "news-20260213-0001",
    success: true
  });
  await enqueueProduceEnvelope(worldRoot, {
    queuedAt: "2026-02-13T18:30:12.000Z",
    channelType: "matrix",
    identity: "@mricge:matrix.liberit.ca",
    agentName: "mricge",
    roomName: "!room:server",
    payloadId: "news-20260213-0001",
    payloadSentence: producePayload
  });

  const produceClaim = await claimOldestProduceEnvelope(worldRoot, { workerTag: "sender" });
  assert.equal(produceClaim?.envelope?.phase, "produce");
  assert.equal(produceClaim?.envelope?.payloadId, "news-20260213-0001");

  const successPath = await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: produceClaim.path });
  assert.match(successPath, /produce\/success\//);
});

test("channel queue fail ack can requeue then fail out", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-queue-retry-"));
  const worldRoot = path.join(root, "world");
  const paths = channelQueuePaths(worldRoot);
  const payload = eventToSentence({
    payloadId: "news-20260213-0011",
    fromEndpoint: "channel matrix room !room:server",
    toEndpoint: "agent accountant",
    payloadText: "retry please",
    targetAgentName: "accountant",
    sessionId: "session name matrix_room"
  });

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-02-13T18:31:10.000Z",
    channelType: "matrix",
    identity: "@accountant:matrix.liberit.ca",
    agentName: "accountant",
    roomName: "!room:server",
    eventId: "$retry",
    payloadSentence: payload
  });
  const first = await claimOldestInputEnvelope(worldRoot, { workerTag: "router" });
  const requeuedPath = await ackRuntimeEnvelopeFail(worldRoot, {
    runtimePath: first.path,
    retryCount: 0,
    maxRetries: 2,
    requeuePhase: "input"
  });
  assert.match(requeuedPath, /\/input\//);

  const second = await claimOldestInputEnvelope(worldRoot, { workerTag: "router" });
  const failedPath = await ackRuntimeEnvelopeFail(worldRoot, {
    runtimePath: second.path,
    retryCount: 2,
    maxRetries: 2,
    requeuePhase: "input"
  });
  assert.match(failedPath, /produce\/fail\//);

  const depth = await queueDepth(worldRoot);
  assert.equal(depth.input, 0);
  assert.equal(depth.produce, 0);
  const failed = await fs.readdir(paths.produceFailDir);
  assert.equal(failed.length, 1);
});

test("channel queue claim scopes input envelopes by agent and channel", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-queue-scope-input-"));
  const worldRoot = path.join(root, "world");
  const payload = eventToSentence({
    payloadId: "news-20260213-0101",
    fromEndpoint: "channel matrix room !room:server",
    toEndpoint: "agent accountant",
    payloadText: "scoped input",
    targetAgentName: "accountant",
    sessionId: "session name matrix_room"
  });

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-02-13T18:40:10.000Z",
    channelType: "matrix",
    identity: "@accountant:matrix.liberit.ca",
    agentName: "accountant",
    roomName: "!room:server",
    eventId: "$scope-input-1",
    payloadSentence: payload
  });

  const wrongAgentClaim = await claimOldestInputEnvelope(worldRoot, {
    workerTag: "mricge-input",
    channelType: "matrix",
    agentName: "mricge"
  });
  assert.equal(wrongAgentClaim, null);

  const rightAgentClaim = await claimOldestInputEnvelope(worldRoot, {
    workerTag: "accountant-input",
    channelType: "matrix",
    agentName: "accountant"
  });
  assert.equal(rightAgentClaim?.envelope?.eventId, "$scope-input-1");
});

test("channel queue claim scopes produce envelopes by agent and channel", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-channel-queue-scope-produce-"));
  const worldRoot = path.join(root, "world");
  const payload = ackToSentence({
    messageId: "matrix-event-20260213-0102",
    fromEndpoint: "agent accountant",
    toEndpoint: "channel matrix room !room:server",
    payloadId: "news-20260213-0102",
    success: true
  });

  await enqueueProduceEnvelope(worldRoot, {
    queuedAt: "2026-02-13T18:41:12.000Z",
    channelType: "matrix",
    identity: "@accountant:matrix.liberit.ca",
    agentName: "accountant",
    roomName: "!room:server",
    payloadId: "news-20260213-0102",
    payloadSentence: payload
  });

  const wrongAgentClaim = await claimOldestProduceEnvelope(worldRoot, {
    workerTag: "mricge-produce",
    channelType: "matrix",
    agentName: "mricge"
  });
  assert.equal(wrongAgentClaim, null);

  const rightAgentClaim = await claimOldestProduceEnvelope(worldRoot, {
    workerTag: "accountant-produce",
    channelType: "matrix",
    agentName: "accountant"
  });
  assert.equal(rightAgentClaim?.envelope?.payloadId, "news-20260213-0102");
});
