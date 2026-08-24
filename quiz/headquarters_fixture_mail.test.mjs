import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  clearExchangeRecorder,
  recordArtifact,
  setExchangeRecorder
} from "../program/bridge/exchange.mjs";
import { remember } from "../program/remember/index.mjs";
import { router } from "../program/verbs/router.mjs";
import {
  claimOldestInputEnvelope,
  queueDepth
} from "../program/agent/channel_core/queue.mjs";
import {
  runChannelPollOnce,
  runChannelInputOnce
} from "../program/agent/channels/index.mjs";
import { readChannelRuntimeState } from "../program/agent/channel_core/state.mjs";
import {
  classifyFixtureMailWithPyash,
  createFixtureMailAdapter,
  fixtureMailTaskId,
  readFixtureMailRecord,
  runFixtureMailWorkflow
} from "../program/agent/channels/fixture_mail.mjs";
import { projectHeadquartersBriefingInput } from "../program/agent/headquarters/briefing.mjs";
import { readWorkTaskStatus, updateWorkTaskCheckpoint } from "../program/runtime/work/status.mjs";
import { listWorkTasks } from "../program/runtime/work/operator.mjs";

const fixtureSource = path.resolve("examples/fixtures/headquarters/fixture-mail.pya");
const policySource = path.resolve("module/headquarters-fixture-mail.pya");
const execFile = promisify(execFileCallback);

async function makeWorldRoot(prefix = "pyash-headquarters-fixture-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

function fixtureText(overrides = {}) {
  const values = {
    provider: "fixture-mail",
    "event id": "fixture-event-test-001",
    "message id": "test-message-001",
    sender: "sender@example.test",
    subject: "A structured fixture record",
    body: "The prose deliberately contains no classification policy.",
    "received time": "2026-08-23T18:00:00.000Z",
    domain: "correspondence",
    deadline: "2026-08-24T17:00:00.000Z",
    "decision required": "truth",
    "draft response requested": "lie",
    "mutation requested": "lie",
    ...overrides
  };
  return [
    "su name fixture mail be map def",
    ...Object.entries(values).map(([key, value]) => `  su name ${key} ob text ${JSON.stringify(value)} ya`),
    "prah",
    ""
  ].join("\n");
}

async function writeFixture(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-headquarters-fixture-file-"));
  const filename = path.join(root, "fixture.pya");
  await fs.writeFile(filename, fixtureText(overrides), "utf8");
  return filename;
}

function adapterFor(worldRoot, fixturePath) {
  return createFixtureMailAdapter({
    fixturePath,
    policyPath: policySource,
    inboxIdentity: "hq-inbox",
    worldRoot
  });
}

function routeWithRemember(sentence) {
  return router(sentence, { remember });
}

async function runInput({ worldRoot, fixturePath, adapter, workflowCalls, contexts = [] } = {}) {
  const agentHouse = path.join(worldRoot, "house", "correspondence worker");
  await fs.mkdir(path.join(agentHouse, "conduct"), { recursive: true });
  return runChannelInputOnce({
    agentName: "correspondence worker",
    channelType: "fixture-mail",
    channelConfig: {
      user: "hq-inbox",
      warmStart: false,
      roomLanes: { "hq-inbox": "fixture-mail_hq-inbox" }
    },
    adapter,
    agentHouse,
    concurrency: 1,
    propagateInterpretErrors: true,
    interpretFn: async (sentence, { channelProcessingContext } = {}) => {
      contexts.push(channelProcessingContext);
      assert.equal(Object.prototype.hasOwnProperty.call(sentence, "channelEvent"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(sentence, "routerPayloadId"), false);
      assert.doesNotThrow(() => JSON.stringify(channelProcessingContext));
      workflowCalls.push(await runFixtureMailWorkflow({
        channelProcessingContext,
        worldRoot,
        fixturePath,
        policyPath: policySource,
        owner: "correspondence worker"
      }));
      return { ob: { text: "fixture mail work recorded" }, be: "text" };
    },
    routerInterpretFn: routeWithRemember
  });
}

async function parsedNewspaperRecords(filename) {
  const source = await fs.readFile(filename, "utf8");
  const records = [];
  let current = null;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sentence = parse(line);
    if (sentence?.su?.name === "headquarters fixture mail evidence") {
      current = {};
      continue;
    }
    if (!current) continue;
    if (sentence?.su?.name) {
      const key = sentence.su.name;
      const value = sentence.ob?.text ?? sentence.ob?.name ?? sentence.ob?.num ?? sentence.ob?.boolean;
      if (value !== undefined) current[key] = value;
    }
    if (sentence?.mood === "prah") {
      records.push(current);
      current = null;
    }
  }
  return records;
}

async function fileEntries(directory) {
  try {
    return (await fs.readdir(directory)).filter(name => !name.startsWith("."));
  } catch {
    return [];
  }
}

test("headquarters fixture mail classifies all four structured cases and rejects identity defects", async () => {
  const base = {
    decisionRequired: false,
    deadline: "",
    draftResponseRequested: false,
    mutationRequested: false
  };
  assert.equal(await classifyFixtureMailWithPyash(base, policySource), "information");
  assert.equal(await classifyFixtureMailWithPyash({ ...base, deadline: "2026-08-24T17:00:00.000Z" }, policySource), "work");
  assert.equal(await classifyFixtureMailWithPyash({ ...base, draftResponseRequested: true }, policySource), "draft-response");
  assert.equal(await classifyFixtureMailWithPyash({ ...base, decisionRequired: true, deadline: "2026-08-24T17:00:00.000Z" }, policySource), "escalation");
  for (const conflicting of [
    { decisionRequired: true },
    { deadline: "2026-08-24T17:00:00.000Z", draftResponseRequested: true },
    { decisionRequired: true, draftResponseRequested: true },
    { mutationRequested: true },
    { decisionRequired: true, deadline: "2026-08-24T17:00:00.000Z", draftResponseRequested: true },
    { decisionRequired: true, mutationRequested: true },
    { deadline: "2026-08-24T17:00:00.000Z", mutationRequested: true },
    { draftResponseRequested: true, mutationRequested: true },
    { decisionRequired: true, deadline: "2026-08-24T17:00:00.000Z", mutationRequested: true },
    { deadline: "2026-08-24T17:00:00.000Z", draftResponseRequested: true, mutationRequested: true },
    { decisionRequired: true, draftResponseRequested: true, mutationRequested: true },
    { decisionRequired: true, deadline: "2026-08-24T17:00:00.000Z", draftResponseRequested: true, mutationRequested: true }
  ]) {
    await assert.rejects(
      classifyFixtureMailWithPyash({ ...base, ...conflicting }, policySource),
      /fixture mail classification defective/
    );
  }

  const missingMessage = await writeFixture({ "message id": "" });
  await assert.rejects(
    readFixtureMailRecord({ fixturePath: missingMessage, inboxIdentity: "hq-inbox" }),
    /missing message id/
  );
  const missingProvider = await writeFixture({ provider: "" });
  await assert.rejects(
    readFixtureMailRecord({ fixturePath: missingProvider, inboxIdentity: "hq-inbox" }),
    /missing provider/
  );
});
test("headquarters golden fixture becomes one assigned escalated briefing candidate with replayable evidence", async () => {
  const worldRoot = await makeWorldRoot();
  const fixturePath = fixtureSource;
  const adapter = adapterFor(worldRoot, fixturePath);
  const agentHouse = path.join(worldRoot, "house", "correspondence worker");
  const channelConfig = {
    user: "hq-inbox",
    warmStart: false,
    roomLanes: { "hq-inbox": "fixture-mail_hq-inbox" }
  };
  const poll = await runChannelPollOnce({
    agentName: "correspondence worker",
    channelType: "fixture-mail",
    channelConfig,
    adapter,
    agentHouse
  });
  assert.equal(poll.enqueued, 1);

  const inputFiles = await fileEntries(path.join(worldRoot, "holding", "channel", "input"));
  assert.equal(inputFiles.length, 1);
  const queuedLines = (await fs.readFile(path.join(worldRoot, "holding", "channel", "input", inputFiles[0]), "utf8"))
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => parse(line));
  const queuedPayload = queuedLines.find(sentence => sentence?.su?.name === "payload");
  assert.match(queuedPayload?.ob?.text ?? "", /golden-message-001/);

  const workflowCalls = [];
  const contexts = [];
  const input = await runInput({ worldRoot, fixturePath, adapter, workflowCalls, contexts });
  assert.equal(input.handled, 1);
  assert.equal(input.sent, 0);
  assert.equal((await queueDepth(worldRoot)).produce, 0);
  assert.equal(workflowCalls.length, 1);
  assert.equal(contexts[0].event.messageId, "golden-message-001");
  assert.equal(contexts[0].routerPayloadId, workflowCalls[0].routerPayloadId);

  const taskId = fixtureMailTaskId(await readFixtureMailRecord({ fixturePath, inboxIdentity: "hq-inbox" }));
  const task = await readWorkTaskStatus(worldRoot, taskId);
  assert.equal(task.owner, "correspondence worker");
  assert.equal(task.source.provider, "fixture-mail");
  assert.equal(task.source.eventId, "fixture-event-golden-001");
  assert.equal(task.source.messageId, "golden-message-001");
  assert.equal(task.source.routerPayloadId, workflowCalls[0].routerPayloadId);
  assert.equal(task.escalation.target, "chief of staff");
  assert.equal(task.escalation.reason, "decision requirement plus deadline");
  assert.deepEqual(task.delegationEvents.map(event => event.type), ["assigned", "escalated"]);
  assert.deepEqual(task.delegationEvents.map(event => event.sourceIdentity), [task.source.identity, task.source.identity]);

  const briefing = await projectHeadquartersBriefingInput(worldRoot);
  assert.deepEqual(briefing, [{
    taskId,
    owner: "correspondence worker",
    domain: "correspondence",
    deadline: "2026-08-24T17:00:00.000Z",
    escalationReason: "decision requirement plus deadline",
    escalationTarget: "chief of staff",
    sourceLocator: task.source.locator
  }]);

  const duplicatePoll = await runChannelPollOnce({
    agentName: "correspondence worker",
    channelType: "fixture-mail",
    channelConfig,
    adapter,
    agentHouse
  });
  assert.equal(duplicatePoll.enqueued, 1);
  const duplicateInput = await runInput({ worldRoot, fixturePath, adapter, workflowCalls });
  assert.equal(duplicateInput.skippedDedup, 1);
  assert.equal(duplicateInput.handled, 0);
  assert.equal(workflowCalls.length, 1);
  const afterDuplicate = await readWorkTaskStatus(worldRoot, taskId);
  assert.equal(afterDuplicate.delegationEvents.length, 2);
  assert.equal((await listWorkTasks(worldRoot)).length, 1);
  assert.equal((await fileEntries(path.join(worldRoot, "holding", "work", "input"))).length, 1);
  assert.deepEqual(afterDuplicate.checkpoint, task.checkpoint);

  const newspaper = path.join(worldRoot, "newspaper", "20260823-headquarters-fixture-mail.pya");
  const records = await parsedNewspaperRecords(newspaper);
  assert.deepEqual(records.slice(0, 7).map(record => record.stage), [
    "received", "routed", "classified", "work-created", "escalated", "briefing-visible", "channel-completed"
  ]);
  for (const record of records.slice(0, 7)) {
    assert.equal(record["source identity"], task.source.identity);
    assert.equal(record["event id"], task.source.eventId);
    assert.equal(record["message id"], task.source.messageId);
    assert.equal(record["task id"] || "", record.stage === "received" || record.stage === "routed" || record.stage === "classified" ? record["task id"] || "" : taskId);
    if (record.stage !== "received") assert.equal(record["router payload id"], task.source.routerPayloadId);
  }
});

test("headquarters restart recovers a claimed input after work creation and reuses its checkpoint", async () => {
  const worldRoot = await makeWorldRoot("pyash-headquarters-restart-");
  const fixturePath = await writeFixture();
  const adapter = adapterFor(worldRoot, fixturePath);
  const agentHouse = path.join(worldRoot, "house", "correspondence worker");
  const channelConfig = { user: "hq-inbox", warmStart: false };
  await runChannelPollOnce({
    agentName: "correspondence worker",
    channelType: "fixture-mail",
    channelConfig,
    adapter,
    agentHouse
  });
  const claim = await claimOldestInputEnvelope(worldRoot, {
    workerTag: "correspondence-worker-input",
    channelType: "fixture-mail",
    agentName: "correspondence worker"
  });
  assert.ok(claim?.path.includes(`${path.sep}runtime${path.sep}`));
  const event = JSON.parse(claim.envelope.payloadSentence.ob.text);
  const firstWorkflow = await runFixtureMailWorkflow({
    channelProcessingContext: {
      channelType: "fixture-mail",
      channelId: "hq-inbox",
      eventId: event.eventId,
      agentName: "correspondence worker",
      routerPayloadId: "fixture-mail-news-pre-ack",
      sessionName: "fixture-mail_hq-inbox",
      agentHouse,
      event
    },
    worldRoot,
    fixturePath,
    policyPath: policySource,
    owner: "correspondence worker"
  });
  const taskId = firstWorkflow.taskId;
  await updateWorkTaskCheckpoint(worldRoot, taskId, {
    lastAction: "work created before channel acknowledgement",
    implementation: { summary: "retained checkpoint" }
  });
  const beforeRestart = await readWorkTaskStatus(worldRoot, taskId);
  assert.equal((await fileEntries(path.join(worldRoot, "holding", "channel", "runtime"))).length, 1);

  const workflowCalls = [];
  const recovered = await runInput({ worldRoot, fixturePath, adapter, workflowCalls });
  assert.equal(recovered.handled, 1);
  assert.equal(workflowCalls.length, 1);
  assert.equal(workflowCalls[0].reused, true);
  assert.equal((await fileEntries(path.join(worldRoot, "holding", "channel", "runtime"))).length, 0);
  const afterRestart = await readWorkTaskStatus(worldRoot, taskId);
  assert.equal(afterRestart.owner, beforeRestart.owner);
  assert.equal(afterRestart.status, beforeRestart.status);
  assert.deepEqual(afterRestart.checkpoint, beforeRestart.checkpoint);
  assert.deepEqual(afterRestart.delegationEvents, beforeRestart.delegationEvents);
  assert.equal((await listWorkTasks(worldRoot)).length, 1);
  assert.equal((await fileEntries(path.join(worldRoot, "holding", "work", "input"))).length, 1);
});

test("headquarters failed workflow requeues without persisting dedup, then processes once after restart", async () => {
  const worldRoot = await makeWorldRoot("pyash-headquarters-retry-");
  const fixturePath = await writeFixture();
  const adapter = adapterFor(worldRoot, fixturePath);
  const agentHouse = path.join(worldRoot, "house", "correspondence worker");
  await runChannelPollOnce({
    agentName: "correspondence worker",
    channelType: "fixture-mail",
    channelConfig: { user: "hq-inbox", warmStart: false },
    adapter,
    agentHouse
  });
  let calls = 0;
  const interpretFn = async (sentence, { channelProcessingContext } = {}) => {
    calls += 1;
    if (calls === 1) throw new Error("fixture workflow interrupted");
    return runFixtureMailWorkflow({
      channelProcessingContext,
      worldRoot,
      fixturePath,
      policyPath: policySource,
      owner: "correspondence worker"
    });
  };
  const options = {
    agentName: "correspondence worker",
    channelType: "fixture-mail",
    channelConfig: { user: "hq-inbox", warmStart: false },
    adapter,
    agentHouse,
    concurrency: 1,
    propagateInterpretErrors: true,
    interpretFn,
    routerInterpretFn: routeWithRemember
  };
  const failed = await runChannelInputOnce(options);
  assert.equal(failed.handled, 0);
  assert.equal(calls, 1);
  assert.equal((await queueDepth(worldRoot)).input, 1);
  assert.equal((await fileEntries(path.join(worldRoot, "holding", "channel", "runtime"))).length, 0);
  const afterFailure = await readChannelRuntimeState({ agentHouse, channelType: "fixture-mail" });
  assert.deepEqual(afterFailure?.dedupOrder ?? [], []);

  const recovered = await runChannelInputOnce(options);
  assert.equal(recovered.handled, 1);
  assert.equal(calls, 2);
  assert.equal((await queueDepth(worldRoot)).input, 0);
  const afterRecovery = await readChannelRuntimeState({ agentHouse, channelType: "fixture-mail" });
  assert.equal(afterRecovery.dedupOrder.length, 1);
  assert.equal((await listWorkTasks(worldRoot)).length, 1);
  const taskId = fixtureMailTaskId(await readFixtureMailRecord({ fixturePath, inboxIdentity: "hq-inbox" }));
  const task = await readWorkTaskStatus(worldRoot, taskId);
  assert.equal(task.owner, "correspondence worker");
  assert.deepEqual(task.delegationEvents.map(event => event.type), ["assigned", "escalated"]);
});

test("headquarters standard newspaper replay detects tampered correlated evidence", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-headquarters-tamper-"));
  await fs.mkdir(path.join(runRoot, "newspaper"), { recursive: true });
  const evidencePath = path.join(runRoot, "channel-evidence.pya");
  const evidence = Buffer.from("su name evidence be map def\nprah\n", "utf8");
  await fs.writeFile(evidencePath, evidence);
  const recorded = [];
  setExchangeRecorder({ runRoot, record: sentence => recorded.push(sentence) });
  let artifact;
  try {
    artifact = recordArtifact({
      locator: "channel-evidence.pya",
      producer: "headquarters",
      bytes: evidence,
      kind: "fixture mail evidence"
    });
  } finally {
    clearExchangeRecorder();
  }
  assert.equal(recorded.length, 1);
  await fs.writeFile(
    path.join(runRoot, "newspaper", "hq-tamper.pya"),
    `${sentenceToPyash(artifact)}\n`,
    "utf8"
  );
  const replayArgs = [
    path.resolve("command/replay_newspaper.mjs"),
    "--run-id",
    "hq-tamper",
    "--run-root",
    runRoot
  ];
  const replayed = await execFile(process.execPath, replayArgs, { cwd: path.resolve(".") });
  assert.match(replayed.stdout, /replay ya/);

  const hash = artifact.fromtext.text;
  const contentAddressed = path.join(
    runRoot,
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
});

function resultMapValue(resultMap, key) {
  return resultMap?.[key]?.ob?.text
    ?? resultMap?.[key]?.ob?.filename
    ?? resultMap?.[key]?.ob?.num
    ?? resultMap?.[key]?.ob?.boolean;
}

test("headquarters runnable example returns linked artifacts and replay detects a tampered link", async () => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-headquarters-example-"));
  const repoRoot = path.resolve(".");
  try {
    for (const directory of ["program", "command", "module", "examples"]) {
      await fs.symlink(path.join(repoRoot, directory), path.join(runRoot, directory), "dir");
    }
    const cleanEnv = { ...process.env };
    delete cleanEnv.PYA_MIND_RESPONSE;
    delete cleanEnv.PYA_HEAR_FIXTURE;
    delete cleanEnv.PYA_PIPER_FIXTURE;
    const runCommand = path.join(repoRoot, "command", "run_pya_program.mjs");
    const example = path.join(runRoot, "examples", "pyash", "headquarter-fixture-mail.pya");
    await execFile(
      process.execPath,
      [runCommand, "--newspaper", "--run-id", "hq-fixture-mail", example],
      { cwd: runRoot, env: cleanEnv }
    );

    const resultPath = path.join(runRoot, "artifacts", "hq-fixture-mail", "result.pya");
    const parsedResult = JSON.parse((await execFile(
      process.execPath,
      [path.join(repoRoot, "command", "pya_to_json.mjs"), resultPath, "--pretty"],
      { cwd: repoRoot, env: cleanEnv }
    )).stdout);
    const result = parsedResult.memory.find(entry => entry?.su?.name === "result");
    const resultMap = result?.ob?.map ?? {};
    assert.equal(resultMapValue(resultMap, "classification"), "escalation");
    assert.equal(resultMapValue(resultMap, "owner"), "correspondence worker");
    assert.equal(resultMapValue(resultMap, "escalation target"), "chief of staff");
    assert.equal(resultMapValue(resultMap, "briefing visible"), "truth");
    const artifactLinks = JSON.parse(resultMapValue(resultMap, "artifact links"));
    assert.equal(artifactLinks.length, 6);
    assert.ok(artifactLinks.some(link => link.locator.includes("headquarters-fixture-mail")));
    assert.ok(artifactLinks.some(link => link.locator.includes("channel-fixture-mail")));
    assert.ok(artifactLinks.some(link => link.locator.includes("work-fixture-mail")));
    assert.ok(artifactLinks.some(link => link.locator.includes("holding/channel/produce/success")));
    assert.ok(resultMapValue(resultMap, "channel input path"));
    assert.ok(resultMapValue(resultMap, "channel success path"));
    assert.ok(resultMapValue(resultMap, "work envelope path"));
    assert.ok(resultMapValue(resultMap, "task status path"));

    const runNewspaper = path.join(runRoot, "newspaper", "hq-fixture-mail.pya");
    const runSentences = (await fs.readFile(runNewspaper, "utf8"))
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => parse(line));
    const artifactSentences = runSentences.filter(sentence => sentence?.be === "artifact");
    assert.equal(artifactSentences.length, artifactLinks.length);
    assert.ok(runSentences.some(sentence => sentence?.be === "run"));
    assert.ok(runSentences.some(sentence => sentence?.be === "end"));

    const replayArgs = [
      path.join(repoRoot, "command", "replay_newspaper.mjs"),
      "--run-id",
      "hq-fixture-mail",
      "--run-root",
      runRoot
    ];
    const replayed = await execFile(process.execPath, replayArgs, { cwd: repoRoot, env: cleanEnv });
    assert.match(replayed.stdout, /replay ya/);

    const tamperedLink = artifactLinks.find(link => link.locator.includes("channel-fixture-mail"));
    assert.ok(tamperedLink);
    const hash = tamperedLink.hash;
    const contentAddressed = path.join(
      runRoot,
      "artifacts",
      "sha256",
      hash.slice(0, 2),
      hash.slice(2, 4),
      `${hash}.pya`
    );
    await fs.appendFile(contentAddressed, "tampered\n", "utf8");
    await assert.rejects(
      execFile(process.execPath, replayArgs, { cwd: repoRoot, env: cleanEnv }),
      /hash inconsistency/
    );
  } finally {
    await fs.rm(runRoot, { recursive: true, force: true });
  }
});

test("headquarters result maps render and parse back with typed values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-headquarters-map-"));
  const filename = path.join(root, "result.pya");
  const sentence = {
    mood: "ya",
    su: { name: "result" },
    be: "map",
    ob: {
      map: {
        "task id": { mood: "ya", su: { name: "task id" }, be: "text", ob: { text: "fixture-mail-golden-message-001" } },
        owner: { mood: "ya", su: { name: "owner" }, be: "text", ob: { text: "correspondence worker" } },
        "briefing visible": { mood: "ya", su: { name: "briefing visible" }, be: "text", ob: { text: "truth" } },
        priority: { mood: "ya", su: { name: "priority" }, be: "num", ob: { num: 10 } }
      }
    }
  };
  await fs.writeFile(filename, `${sentenceToPyash(sentence)}\n`, "utf8");
  const parsed = JSON.parse((await execFile(
    process.execPath,
    [path.resolve("command/pya_to_json.mjs"), filename, "--pretty"],
    { cwd: path.resolve(".") }
  )).stdout);
  const result = parsed.memory.find(entry => entry?.su?.name === "result");
  assert.equal(result?.be, "map");
  assert.equal(result?.ob?.map?.["task id"]?.ob?.text, "fixture-mail-golden-message-001");
  assert.equal(result?.ob?.map?.owner?.ob?.text, "correspondence worker");
  assert.equal(result?.ob?.map?.["briefing visible"]?.ob?.text, "truth");
  assert.equal(result?.ob?.map?.priority?.ob?.num, 10);
  await fs.rm(root, { recursive: true, force: true });
});
