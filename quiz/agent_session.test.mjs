import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { mind_to_name_text } from "../program/verbs/mind/mind.mjs";
import {
  ensureSessionFile,
  appendSessionEntry,
  readSessionMessages,
  normalizeHistoryWindow,
  beginSessionTurn,
  completeSessionTurn
} from "../program/agent/session.mjs";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function todayCompact() {
  return todayDate().replace(/-/g, "");
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("agent session writes append-only session file with system entry", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";

  const tmpRoot = path.resolve("/tmp/pyash-agent-session-test");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  doRemember({
    mood: "ya",
    be: "root",
    su: { name: "world root" },
    ob: { filename: tmpRoot }
  });

  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" from discourse "You are concise." ya'));
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name agent ob bool truth ya"));
    await interpret(parse('su name session name ob text "draft review" ya'));
    await interpret(parse("prah"));
    await interpret(parse('su name prompt ob text "Hello" for name helper to name text out with name tools be write do'));

    const sessionName = `${todayCompact()}-draft_review`;
    const sessionFile = path.join(tmpRoot, "house", "helper", "session", `${sessionName}.pya`);
    assert.ok(await exists(sessionFile));
    const content = await fs.readFile(sessionFile, "utf8");
    assert.match(content, new RegExp(`su name ${sessionName} since date ${todayDate()} be series def`));
    assert.match(content, /su name system ob text/);
    assert.match(content, /as name qwen3-vl:8b-instruct/);
    assert.match(content, /su name user ob text/);
    assert.match(content, /su name agent ob text/);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("agent session appends subsequent turns without rewriting header", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";

  const tmpRoot = path.resolve("/tmp/pyash-agent-session-append-test");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  doRemember({
    mood: "ya",
    be: "root",
    su: { name: "world root" },
    ob: { filename: tmpRoot }
  });

  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" from discourse "You are concise." ya'));
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name agent ob bool truth ya"));
    await interpret(parse('su name session name ob text "draft review" ya'));
    await interpret(parse("prah"));
    await interpret(parse('su name prompt ob text "Hello" for name helper to name text out with name tools be write do'));
    await interpret(parse('su name prompt ob text "Second turn" for name helper to name text out with name tools be write do'));

    const sessionName = `${todayCompact()}-draft_review`;
    const sessionFile = path.join(tmpRoot, "house", "helper", "session", `${sessionName}.pya`);
    const content = await fs.readFile(sessionFile, "utf8");
    const headerMatches = content.match(new RegExp(`su name ${sessionName} since date ${todayDate()} be series def`, "g")) ?? [];
    const userMatches = content.match(/su name user ob text/g) ?? [];
    const agentMatches = content.match(/su name agent ob text/g) ?? [];
    assert.equal(headerMatches.length, 1);
    assert.equal(userMatches.length, 2);
    assert.equal(agentMatches.length, 2);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("agent session restores generated naming after the user turn is durable", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "generated label";
  const tmpRoot = path.resolve("/tmp/pyash-agent-session-generated-name-test");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
  doRemember({ mood: "ya", be: "root", su: { name: "world root" }, ob: { filename: tmpRoot } });
  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" from discourse "You are concise." ya'));
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name agent ob bool truth ya"));
    await interpret(parse("prah"));
    await interpret(parse('su name prompt ob text "Generated name" for name helper to name text out with name tools be write do'));
    const generatedFile = path.join(tmpRoot, "house", "helper", "session", `${todayCompact()}-generated-label.pya`);
    assert.ok(await exists(generatedFile));
    const content = await fs.readFile(generatedFile, "utf8");
    assert.match(content, /su name user ob text "Generated name"/);
    assert.doesNotMatch(content, /fromtext text "\{"/);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("session history window normalization is deterministic", () => {
  assert.equal(normalizeHistoryWindow(undefined, { defaultPairs: 8 }), 8);
  assert.equal(normalizeHistoryWindow(0, { defaultPairs: 8 }), 0);
  assert.equal(normalizeHistoryWindow(-4, { defaultPairs: 8 }), 0);
  assert.equal(normalizeHistoryWindow(3.7, { defaultPairs: 8 }), 3);
  assert.equal(normalizeHistoryWindow(9999, { defaultPairs: 8, maxPairs: 200 }), 200);
});

test("readSessionMessages enforces stable truncation by pair window", async () => {
  const tempRoot = path.resolve("/tmp/pyash-agent-session-window-test");
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  const sessionDir = path.join(tempRoot, "session");
  const sessionFile = await ensureSessionFile({
    sessionDir,
    sessionName: `${todayCompact()}-window_test`,
    systemPrompt: "system",
    model: "qwen3-vl:8b-instruct"
  });
  for (let i = 1; i <= 5; i += 1) {
    await appendSessionEntry({ sessionFile, role: "user", content: `u${i}` });
    await appendSessionEntry({ sessionFile, role: "assistant", content: `a${i}` });
  }
  const onePair = await readSessionMessages({ sessionFile, historyWindow: 1 });
  assert.equal(onePair.messages.length, 2);
  assert.equal(onePair.messages[0].content, "u5");
  assert.equal(onePair.messages[1].content, "a5");
  const noPairs = await readSessionMessages({ sessionFile, historyWindow: 0 });
  assert.equal(noPairs.messages.length, 0);
  const allPairs = await readSessionMessages({ sessionFile, historyWindow: 10 });
  assert.equal(allPairs.messages.length, 10);
});

test("session turn user record is durable before completion and pending tails stay out of history", async () => {
  const tempRoot = path.resolve("/tmp/pyash-agent-session-turn-test");
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  const sessionFile = await ensureSessionFile({
    sessionDir: tempRoot,
    sessionName: "turns",
    systemPrompt: "system",
    model: "model"
  });

  const request = { prompt: "pending request", timestamp: "2026-01-01T00:00:00.000Z" };
  const started = await beginSessionTurn({
    sessionFile,
    userContent: "pending request",
    request,
    metadata: { payloadId: "payload-pending" }
  });
  assert.equal(started.status, "pending");
  const before = await fs.readFile(sessionFile, "utf8");
  assert.match(before, /su name user ob text "pending request"/);
  assert.equal((before.match(/su name user/g) ?? []).length, 1);

  const history = await readSessionMessages({ sessionFile, historyWindow: 10 });
  assert.deepEqual(history.messages, []);

  const resumed = await beginSessionTurn({
    sessionFile,
    userContent: "pending request",
    request: { prompt: "pending request", timestamp: "2030-04-05T06:07:08.000Z" },
    metadata: { payloadId: "payload-pending" }
  });
  assert.equal(resumed.status, "pending");
  assert.equal(resumed.turnId, started.turnId);
  const resumedText = await fs.readFile(sessionFile, "utf8");
  assert.equal((resumedText.match(/su name user/g) ?? []).length, 1);
});

test("completed session turn replays without appending another turn", async () => {
  const tempRoot = path.resolve("/tmp/pyash-agent-session-complete-test");
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  const sessionFile = await ensureSessionFile({
    sessionDir: tempRoot,
    sessionName: "complete",
    systemPrompt: "system",
    model: "model"
  });

  const started = await beginSessionTurn({
    sessionFile,
    userContent: "same request",
    request: { prompt: "same request" },
    metadata: { payloadId: "payload-complete" }
  });
  await completeSessionTurn({ sessionFile, turn: started, responseText: "recorded response" });
  const first = await fs.readFile(sessionFile, "utf8");
  const replay = await beginSessionTurn({
    sessionFile,
    userContent: "same request",
    request: { prompt: "same request", timestamp: "2030-04-05T06:07:08.000Z" },
    metadata: { payloadId: "payload-complete" }
  });
  const second = await fs.readFile(sessionFile, "utf8");

  assert.equal(replay.status, "completed");
  assert.equal(replay.responseText, "recorded response");
  assert.equal(second, first);
  assert.equal((second.match(/su name user/g) ?? []).length, 1);
  assert.equal((second.match(/be checkpoint ya/g) ?? []).length, 1);
});

test("ordinal fallback creates a new turn for a later identical request", async () => {
  const tempRoot = path.resolve("/tmp/pyash-agent-session-ordinal-test");
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  const sessionFile = await ensureSessionFile({
    sessionDir: tempRoot,
    sessionName: "ordinal",
    systemPrompt: "system",
    model: "model"
  });

  const first = await beginSessionTurn({
    sessionFile,
    userContent: "repeatable request",
    request: { prompt: "repeatable request" }
  });
  await completeSessionTurn({ sessionFile, turn: first, responseText: "first response" });
  const second = await beginSessionTurn({
    sessionFile,
    userContent: "repeatable request",
    request: { prompt: "repeatable request" }
  });

  assert.equal(first.ordinal, 1);
  assert.equal(second.ordinal, 2);
  assert.notEqual(second.turnId, first.turnId);
});

test("completion resumes an assistant tail by adding only its missing checkpoint", async () => {
  const tempRoot = path.resolve("/tmp/pyash-agent-session-assistant-tail-test");
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  const sessionFile = await ensureSessionFile({
    sessionDir: tempRoot,
    sessionName: "assistant-tail",
    systemPrompt: "system",
    model: "model"
  });
  const started = await beginSessionTurn({
    sessionFile,
    userContent: "tail request",
    request: { prompt: "tail request" }
  });
  await appendSessionEntry({
    sessionFile,
    role: "agent",
    content: "tail response",
    metadata: { turnId: started.turnId, requestHash: started.requestHash }
  });
  const history = await readSessionMessages({ sessionFile, historyWindow: 10 });
  assert.deepEqual(history.messages, []);
  await completeSessionTurn({ sessionFile, turn: started, responseText: "tail response" });
  const content = await fs.readFile(sessionFile, "utf8");
  assert.equal((content.match(/su name agent ob text/g) ?? []).length, 1);
  assert.equal((content.match(/be checkpoint ya/g) ?? []).length, 1);
});

test("agent mind returns the durable response when a completed request is replayed", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "first durable response";
  const tmpRoot = path.resolve("/tmp/pyash-agent-session-runtime-replay-test");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
  doRemember({
    mood: "ya",
    be: "root",
    su: { name: "world root" },
    ob: { filename: tmpRoot }
  });

  const responseText = (result) => String(result?.ob?.text ?? result?.value?.text ?? result?.result?.text ?? "");
  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" from discourse "You are concise." ya'));
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name agent ob bool truth ya"));
    await interpret(parse('su name session name ob text "replay" ya'));
    await interpret(parse("prah"));
    const replaySentence = parse('su name prompt ob text "Replay me" for name helper to name text out with name tools be write do');
    const first = await mind_to_name_text(replaySentence, {
      sessionUserMetadata: { payloadId: "replay-payload" },
      sessionAssistantMetadata: { payloadId: "replay-payload" }
    });
    process.env.PYA_MIND_RESPONSE = "should not be called";
    const second = await mind_to_name_text(replaySentence, {
      sessionUserMetadata: { payloadId: "replay-payload" },
      sessionAssistantMetadata: { payloadId: "replay-payload" }
    });
    assert.equal(responseText(first), "first durable response");
    assert.equal(responseText(second), "first durable response");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
