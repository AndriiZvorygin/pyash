import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  appendSessionEntry,
  beginSessionTurn,
  completeSessionTurn,
  ensureSessionFile,
  readSessionMessagesWithFallback,
  readSessionReplay
} from "../program/agent/session.mjs";
import {
  buildSessionCheckpointSentence,
  buildSessionTurnSentence,
  buildCompactSessionSnapshot,
  canonicalRequestHash,
  deriveTurnIdentity,
  projectSessionReplay
} from "../program/agent/session_replay.mjs";
import { setExchangeRecorder, clearExchangeRecorder, setExchangeRunId, setExchangeSentenceId } from "../program/bridge/exchange.mjs";

const execFileAsync = promisify(execFile);

async function makeSession(name) {
  const root = path.resolve(`/tmp/pyash-agent-session-replay-${name}`);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const sessionFile = await ensureSessionFile({
    sessionDir: root,
    sessionName: name,
    systemPrompt: "system",
    model: "model"
  });
  return { root, sessionFile };
}

test("turn identity ignores timestamps and prefers inbound payload or exchange ids", () => {
  assert.equal(
    canonicalRequestHash({ prompt: "hello", timestamp: "2026-01-01T00:00:00.000Z" }),
    canonicalRequestHash({ prompt: "hello", timestamp: "2030-04-05T06:07:08.000Z" })
  );
  const payloadIdentity = deriveTurnIdentity({
    payloadId: "news-17",
    sessionOrdinal: 9,
    request: { prompt: "hello" }
  });
  const exchangeIdentity = deriveTurnIdentity({
    exchangeSentenceId: "exchange-17",
    sessionOrdinal: 9,
    request: { prompt: "hello" }
  });
  const ordinalIdentity = deriveTurnIdentity({
    sessionOrdinal: 9,
    request: { prompt: "hello", timestamp: "2026-01-01T00:00:00.000Z" }
  });
  assert.match(payloadIdentity.turnId, /news-17/);
  assert.match(exchangeIdentity.turnId, /exchange-17/);
  assert.match(ordinalIdentity.turnId, /000009/);
  assert.equal(ordinalIdentity.requestHash, deriveTurnIdentity({
    sessionOrdinal: 9,
    request: { prompt: "hello", timestamp: "2030-04-05T06:07:08.000Z" }
  }).requestHash);
});

test("session turn sentences use typed fields without JSON metadata blobs", () => {
  const sentence = buildSessionTurnSentence({
    role: "user",
    content: "typed request",
    turnId: "turn-payload-typed",
    requestHash: "a".repeat(64),
    ordinal: 3,
    metadata: { sender: "sender", channelId: "room", channelType: "matrix" }
  });
  const rendered = sentenceToPyash(sentence);
  assert.equal(sentence.be, "write");
  assert.equal(sentence.su.name, "user");
  assert.match(rendered, /accordingto text "turn-payload-typed"/);
  assert.match(rendered, /fromtext text "a{64}"/);
  assert.doesNotMatch(rendered, /\{"record"/);
  assert.doesNotMatch(rendered, /session turn/);
});

test("session turn identity falls back to the active exchange sentence id", async () => {
  const { sessionFile } = await makeSession("exchange-id");
  setExchangeSentenceId("evoke-exchange-42");
  try {
    const started = await beginSessionTurn({
      sessionFile,
      userContent: "exchange request",
      request: { prompt: "exchange request" }
    });
    assert.match(started.turnId, /exchange-evoke-exchange-42/);
  } finally {
    setExchangeSentenceId(null);
  }
});

test("replay projector rejects conflicting evidence for one turn id", async () => {
  const { sessionFile } = await makeSession("conflict");
  const metadata = { turnId: "turn-conflict", requestHash: canonicalRequestHash({ prompt: "one" }) };
  await appendSessionEntry({ sessionFile, role: "user", content: "one", metadata });
  await appendSessionEntry({ sessionFile, role: "user", content: "different", metadata });

  await assert.rejects(
    () => readSessionReplay({ sessionFile }),
    (error) => error?.message.startsWith("session replay defective")
  );
});

test("replay projector rejects a checkpoint that disagrees with its assistant record", () => {
  const sentences = [
    { su: { name: "user" }, ob: { text: "request" }, accordingto: { text: "turn-conflict" }, fromtext: { text: JSON.stringify({ requestHash: canonicalRequestHash({ prompt: "request" }) }) }, be: "session turn", mood: "ya" },
    { su: { name: "agent" }, ob: { text: "assistant answer" }, accordingto: { text: "turn-conflict" }, be: "session turn", mood: "ya" },
    { su: { name: "session turn checkpoint" }, ob: { text: "different answer" }, accordingto: { text: "turn-conflict" }, vyah: { ve: { type: "name", values: ["success"] } }, be: "checkpoint", mood: "ya" }
  ];
  assert.throws(
    () => projectSessionReplay({ sentences }),
    (error) => error?.message.startsWith("session replay defective")
  );
});

test("legacy adjacent turns project with synthetic ids without rewriting the transcript", async () => {
  const { sessionFile } = await makeSession("legacy");
  await appendSessionEntry({ sessionFile, role: "user", content: "old question", metadata: { timestamp: "2026-01-01T00:00:00.000Z" } });
  await appendSessionEntry({ sessionFile, role: "agent", content: "old answer", metadata: { timestamp: "2026-01-01T00:00:01.000Z" } });
  const before = await fs.readFile(sessionFile, "utf8");
  const first = await readSessionReplay({ sessionFile, historyWindow: 10 });
  const second = await readSessionReplay({ sessionFile, historyWindow: 10 });
  const after = await fs.readFile(sessionFile, "utf8");

  assert.equal(first.messages.length, 2);
  assert.equal(first.turns.length, 1);
  assert.equal(first.turns[0].legacy, true);
  assert.deepEqual(first.acceptedEvidence, []);
  assert.equal(first.turns[0].turnId, second.turns[0].turnId);
  assert.equal(after, before);
});

test("legacy non-adjacent records are rejected instead of being permissively paired", () => {
  const sentences = [
    { su: { name: "user" }, ob: { text: "old question" }, mood: "ya" },
    { su: { name: "user" }, ob: { text: "new request" }, accordingto: { text: "turn-new" }, be: "session turn", mood: "ya" },
    { su: { name: "agent" }, ob: { text: "old answer" }, mood: "ya" }
  ];
  assert.throws(
    () => projectSessionReplay({ sentences }),
    (error) => error?.message.startsWith("session replay defective")
  );
});

test("compaction keeps only complete recent pairs while retaining checkpoint evidence", () => {
  const sentences = [
    { su: { name: "user" }, ob: { text: "first" }, accordingto: { text: "turn-1" }, be: "session turn", mood: "ya" },
    { su: { name: "agent" }, ob: { text: "one" }, accordingto: { text: "turn-1" }, be: "session turn", mood: "ya" },
    { su: { name: "session turn checkpoint" }, ob: { text: "one" }, accordingto: { text: "turn-1" }, vyah: { ve: { type: "name", values: ["success", "accept"] } }, be: "checkpoint", mood: "ya" },
    { su: { name: "user" }, ob: { text: "incomplete" }, accordingto: { text: "turn-2" }, be: "session turn", mood: "ya" },
    { su: { name: "user" }, ob: { text: "third" }, accordingto: { text: "turn-3" }, be: "session turn", mood: "ya" },
    { su: { name: "agent" }, ob: { text: "three" }, accordingto: { text: "turn-3" }, be: "session turn", mood: "ya" },
    { su: { name: "session turn checkpoint" }, ob: { text: "three" }, accordingto: { text: "turn-3" }, vyah: { ve: { type: "name", values: ["success", "accept"] } }, be: "checkpoint", mood: "ya" }
  ];
  const projected = projectSessionReplay({ sentences, historyWindow: 1 });
  assert.deepEqual(projected.messages.map((message) => message.content), ["first", "three"]);
  assert.deepEqual(projected.pendingTurns.map((turn) => turn.turnId), ["turn-2"]);
  assert.deepEqual(projected.acceptedEvidence.map((entry) => entry.turnId), ["turn-1", "turn-3"]);
  assert.equal(projected.snapshotHash, projectSessionReplay({ sentences, historyWindow: 1 }).snapshotHash);
  const withDifferentTimes = sentences.map((sentence, index) => ({
    ...sentence,
    during: { date: `203${index}-04-05T06:07:08.000Z` }
  }));
  assert.equal(projected.snapshotHash, projectSessionReplay({ sentences: withDifferentTimes, historyWindow: 1 }).snapshotHash);
  assert.equal(sentenceToPyash(sentences[0]).includes("during"), false);
});

test("golden projection keeps the original task and latest explicitly accepted generator/verifier evidence", () => {
  const requestHash = canonicalRequestHash({ prompt: "task" });
  const sentences = [
    buildSessionTurnSentence({ role: "user", content: "original task", turnId: "turn-1", requestHash, ordinal: 1 }),
    buildSessionTurnSentence({ role: "agent", content: "ordinary answer", turnId: "turn-1", requestHash, ordinal: 1 }),
    buildSessionCheckpointSentence({ turnId: "turn-1", requestHash, responseText: "ordinary answer", ordinal: 1 }),
    buildSessionTurnSentence({ role: "user", content: "retry task", turnId: "turn-2", requestHash, ordinal: 2 }),
    buildSessionTurnSentence({ role: "agent", content: "accepted draft", turnId: "turn-2", requestHash, ordinal: 2 }),
    buildSessionCheckpointSentence({
      turnId: "turn-2",
      requestHash,
      responseText: "accepted draft",
      ordinal: 2,
      metadata: {
        accepted: true,
        generatorName: "generator",
        verifierName: "verifier",
        verifierText: "PASS"
      }
    })
  ];
  const projected = projectSessionReplay({ sentences, historyWindow: 10 });
  assert.deepEqual(projected.acceptedEvidence.map((entry) => entry.turnId), ["turn-2"]);
  assert.equal(projected.goldenProjection.originalTask, "original task");
  assert.equal(projected.goldenProjection.latestAcceptedGenerator.content, "accepted draft");
  assert.equal(projected.goldenProjection.latestAcceptedVerifier.content, "PASS");
  assert.deepEqual(projected.messages.map((entry) => entry.content), ["original task", "accepted draft", "PASS"]);
  assert.doesNotMatch(buildCompactSessionSnapshot(projected), /ordinary answer/);
});

test("named-session fallback deduplicates stable turns before projecting the window", async () => {
  const root = path.resolve("/tmp/pyash-agent-session-replay-fallback");
  await fs.rm(root, { recursive: true, force: true });
  const sessionDir = path.join(root, "session");
  await fs.mkdir(sessionDir, { recursive: true });
  const now = new Date();
  const today = now.toISOString().slice(0, 10).replace(/-/g, "");
  const yesterdayDate = new Date(now);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10).replace(/-/g, "");
  const oldFile = await ensureSessionFile({ sessionDir, sessionName: `${yesterday}-named`, systemPrompt: "system", model: "model" });
  const todayFile = await ensureSessionFile({ sessionDir, sessionName: `${today}-named`, systemPrompt: "system", model: "model" });
  const request = { prompt: "shared turn" };
  const oldTurn = await beginSessionTurn({ sessionFile: oldFile, userContent: "shared turn", request, metadata: { payloadId: "shared-turn" } });
  await completeSessionTurn({ sessionFile: oldFile, turn: oldTurn, responseText: "shared answer" });
  const todayTurn = await beginSessionTurn({ sessionFile: todayFile, userContent: "shared turn", request, metadata: { payloadId: "shared-turn" } });
  await completeSessionTurn({ sessionFile: todayFile, turn: todayTurn, responseText: "shared answer" });
  const fallback = await readSessionMessagesWithFallback({ sessionDir, baseName: "named", historyWindow: 10 });
  assert.deepEqual(fallback.messages.map((entry) => entry.content), ["shared turn", "shared answer"]);
});

test("long-run projection remains deterministic across the 200-turn boundary", () => {
  const sentences = [];
  for (let ordinal = 1; ordinal <= 205; ordinal += 1) {
    const requestHash = canonicalRequestHash({ ordinal, prompt: `task-${ordinal}` });
    const turnId = `turn-${String(ordinal).padStart(6, "0")}`;
    sentences.push(buildSessionTurnSentence({ role: "user", content: `task-${ordinal}`, turnId, requestHash, ordinal }));
    sentences.push(buildSessionTurnSentence({ role: "agent", content: `answer-${ordinal}`, turnId, requestHash, ordinal }));
    sentences.push(buildSessionCheckpointSentence({ turnId, requestHash, responseText: `answer-${ordinal}`, ordinal }));
  }
  const first = projectSessionReplay({ sentences, historyWindow: 8 });
  const second = projectSessionReplay({ sentences, historyWindow: 8 });
  assert.equal(first.turns.length, 205);
  assert.equal(first.messages.length, 16);
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.equal(first.messages[0].content, "task-198");
  assert.equal(first.messages.at(-1).content, "answer-205");
});

test("session snapshot artifact replays successfully and rejects tampering", async () => {
  const root = path.resolve("/tmp/pyash-agent-session-replay-artifact");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const sessionFile = await ensureSessionFile({ sessionDir: root, sessionName: "artifact", systemPrompt: "system", model: "model" });
  const newspaper = [];
  setExchangeRecorder({
    runRoot: root,
    record: (sentence) => newspaper.push(sentenceToPyash(sentence))
  });
  setExchangeRunId("session-artifact");
  let artifactLine = "";
  try {
    const started = await beginSessionTurn({
      sessionFile,
      userContent: "artifact request",
      request: { prompt: "artifact request" },
      metadata: { payloadId: "artifact-payload" }
    });
    const completed = await completeSessionTurn({ sessionFile, turn: started, responseText: "artifact response" });
    assert.ok(completed.snapshotArtifact?.hash);
    artifactLine = newspaper.find((line) => line.includes("be artifact"));
    assert.ok(artifactLine);
    assert.ok(newspaper.some((line) => line.includes("be checkpoint") && line.includes(started.turnId)));
  } finally {
    clearExchangeRecorder();
    setExchangeRunId(null);
  }
  const newspaperDir = path.join(root, "newspaper");
  await fs.mkdir(newspaperDir, { recursive: true });
  await fs.writeFile(path.join(newspaperDir, "session-artifact.pya"), `${newspaper.join("\n")}\n`, "utf8");
  const replayPath = path.resolve("command/replay_newspaper.mjs");
  const success = await execFileAsync(process.execPath, [replayPath, "--run-id", "session-artifact", "--run-root", root], {
    cwd: path.resolve(".")
  });
  assert.match(success.stdout, /be replay ya/);
  const hash = artifactLine.match(/fromtext text "([a-f0-9]+)"/)?.[1];
  const locatorMatch = artifactLine.match(/to filename (?:"([^"]+)"|([^ ]+))/);
  const locator = locatorMatch?.[1] || locatorMatch?.[2];
  assert.ok(hash);
  assert.ok(locator);
  const contentAddressed = path.join(root, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${path.extname(locator)}`);
  await fs.writeFile(contentAddressed, "tampered snapshot\n", "utf8");
  await assert.rejects(
    () => execFileAsync(process.execPath, [replayPath, "--run-id", "session-artifact", "--run-root", root], { cwd: path.resolve(".") }),
    /hash inconsistency/
  );
});
