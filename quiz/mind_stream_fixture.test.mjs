import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import fs from "node:fs/promises";

import { doRemember, forget } from "../program/remember/index.mjs";
import { runGenerate } from "../program/verbs/mind/generate.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("mind stream uses config vyah stream and yields chips", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "alpha beta gamma";
  try {
    await run("exists su name helper be mind vyah stream ya");
    const stream = await run('su name helper-stream ob text "prompt" for name helper to name text helper-stream be write do');
    assert.equal(stream?.be, "stream");
    assert.equal(stream?.su?.name, "helper-stream");

    const streamPath = stream?.ob?.filename;
    assert.equal(typeof streamPath, "string");
    const content = await waitForStreamEnd(streamPath);
    const lines = content.split(/\r?\n/).filter(Boolean);
    const chunks = [];
    for (const line of lines) {
      if (line.trim() === "[PYA_STREAM_END]") break;
      chunks.push(JSON.parse(line));
    }
    assert.equal(chunks.join("").trim(), "alpha beta gamma");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("stream terminal marker follows session completion callback", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "durable stream";
  let callbackSawTerminal = null;
  const streamPath = path.join("artifacts", "mind", "durable-stream.stream.txt");
  try {
    doRemember({ mood: "ya", su: { name: "mind response" }, be: "default", ob: { text: "durable stream" } });
    const result = await runGenerate({
      sentence: parse('su name stream prompt be write do'),
      mindName: "stream",
      model: "fixture-model",
      historyMessages: [],
      callPrompt: "stream prompt",
      inputText: "",
      aspect: "stream",
      outputName: "durable-stream",
      debugMind: () => {},
      onComplete: async () => {
        const content = await fs.readFile(streamPath, "utf8");
        callbackSawTerminal = content.includes("[PYA_STREAM_END]");
      }
    });
    const content = await waitForStreamEnd(result.stream.ob.filename);
    assert.equal(callbackSawTerminal, false);
    assert.match(content, /\[PYA_STREAM_END\]/);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

async function waitForStreamEnd(filename, { timeoutMs = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = await fs.readFile(filename, "utf8");
      if (content.includes("[PYA_STREAM_END]")) return content;
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`stream fixture timed out: ${filename}`);
}
