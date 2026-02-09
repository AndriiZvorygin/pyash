import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { ensureSessionFile, appendSessionEntry, readSessionMessages, normalizeHistoryWindow } from "../program/agent/session.mjs";

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
    assert.match(content, /su name assistant ob text/);
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
    const assistantMatches = content.match(/su name assistant ob text/g) ?? [];
    assert.equal(headerMatches.length, 1);
    assert.equal(userMatches.length, 2);
    assert.equal(assistantMatches.length, 2);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("session history window normalization is deterministic", () => {
  assert.equal(normalizeHistoryWindow(undefined, { defaultPairs: 8 }), 8);
  assert.equal(normalizeHistoryWindow(0, { defaultPairs: 8 }), 1);
  assert.equal(normalizeHistoryWindow(-4, { defaultPairs: 8 }), 1);
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
  const allPairs = await readSessionMessages({ sessionFile, historyWindow: 10 });
  assert.equal(allPairs.messages.length, 10);
});
