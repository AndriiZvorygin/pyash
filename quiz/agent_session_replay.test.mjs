import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { sentenceToPyash } from "../program/beautiful.mjs";
import { appendSessionEntry, ensureSessionFile, readSessionReplay } from "../program/agent/session.mjs";
import {
  canonicalRequestHash,
  deriveTurnIdentity,
  projectSessionReplay
} from "../program/agent/session_replay.mjs";

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
    { su: { name: "session turn checkpoint" }, ob: { text: "one" }, accordingto: { text: "turn-1" }, vyah: { ve: { type: "name", values: ["success"] } }, be: "checkpoint", mood: "ya" },
    { su: { name: "user" }, ob: { text: "incomplete" }, accordingto: { text: "turn-2" }, be: "session turn", mood: "ya" },
    { su: { name: "user" }, ob: { text: "third" }, accordingto: { text: "turn-3" }, be: "session turn", mood: "ya" },
    { su: { name: "agent" }, ob: { text: "three" }, accordingto: { text: "turn-3" }, be: "session turn", mood: "ya" },
    { su: { name: "session turn checkpoint" }, ob: { text: "three" }, accordingto: { text: "turn-3" }, vyah: { ve: { type: "name", values: ["success"] } }, be: "checkpoint", mood: "ya" }
  ];
  const projected = projectSessionReplay({ sentences, historyWindow: 1 });
  assert.deepEqual(projected.messages.map((message) => message.content), ["third", "three"]);
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
