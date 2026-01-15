import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

function decodeMindPayload(records, name, label = "request") {
  const entry = [...records].reverse().find(s => s.su?.name?.startsWith(`${name} ${label} `));
  const raw = entry?.ob?.text ?? "";
  const prefix = "quoted.json.";
  const suffix = ".json.quoted";
  const jsonText = raw.startsWith(prefix) && raw.endsWith(suffix)
    ? raw.slice(prefix.length, -suffix.length)
    : raw;
  return JSON.parse(jsonText || "{}");
}

test("mind registration stores engine/model/prompt contexts", async () => {
  forget();

  const sentence = parse(
    'exists su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya'
  );

  await interpret(sentence);

  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "generator");

  assert.ok(fact);
  assert.equal(fact.be, "mind");
  assert.equal(fact.from?.name, "http://localhost:11434");
  assert.equal(fact.as?.name, "qwen3:8b");
  assert.equal(fact.accordingto?.name, "orchestrator");
});

test("mind invocation pulls model + prompt from registered mind", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    // Register the mind
    await interpret(
      parse('exists su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya')
    );

    // Ask the mind (no model/prompt on the call; should resolve from memory)
    const sentence = parse('su question ob discourse "Hello" for name generator to name text generator-out be write do');

    await interpret(sentence);

    const mem = allRemember();
    const fact = mem.find(s => s.su?.name === "generator");
    const answer = mem.find(s => s.su?.name === "generator answer 1");
    const payload = decodeMindPayload(records, "generator");

    assert.ok(fact);
    assert.equal(fact.be, "mind");
    assert.ok(answer);
    assert.equal(answer.be, "answer");
    assert.equal(answer.from?.name, "generator");
    assert.equal(payload.model, "qwen3:8b");
    assert.ok(payload.prompt?.includes("Hello"));
    assert.ok(payload.prompt?.includes("orchestrator"));
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind invocation includes recent history in prompt with per-mind window", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(
      parse('exists su generator by num 1 be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya')
    );

    await interpret(parse('be write ob text "Hi" for name generator to name text generator-out do'));
    await interpret(parse('su question ob discourse "Hello" for name generator to name text generator-out be write do'));

    const payload = decodeMindPayload(records, "generator");
    // With window 1, we keep at most 1 user+assistant pair
    assert.match(payload.prompt ?? "", /USER: Hi/);
    assert.match(payload.prompt ?? "", /ASSISTANT:/);
    assert.match(payload.prompt ?? "", /Hello/);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind history is isolated by fromtext bucket", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    // Mind A with custom bucket
    await interpret(
      parse('exists su helperA from text bucketA be mind via state "qwen3:8b" ya')
    );
    // Mind B with different bucket
    await interpret(
      parse('exists su helperB from text bucketB be mind via state "qwen3:8b" ya')
    );

    await interpret(parse('be write ob text "Hi A" for name helperA to name text helperA-out do'));
    await interpret(parse('be write ob text "Hi B" for name helperB to name text helperB-out do'));

    await interpret(parse('su q ob discourse "Hello A" for name helperA to name text helperA-out be write do'));
    await interpret(parse('su q ob discourse "Hello B" for name helperB to name text helperB-out be write do'));

    const payloadA = decodeMindPayload(records, "helperA");
    const payloadB = decodeMindPayload(records, "helperB");

    assert.match(payloadA.prompt ?? "", /Hi A/);
    assert.doesNotMatch(payloadA.prompt ?? "", /Hi B/);
    assert.match(payloadB.prompt ?? "", /Hi B/);
    assert.doesNotMatch(payloadB.prompt ?? "", /Hi A/);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind history defaults to `<name> story` bucket when fromtext absent", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse('exists su helper be mind via state "qwen3:8b" ya'));
    await interpret(parse('be write ob text "Ping" for name helper to name text helper-out do'));
    await interpret(parse('su q ob discourse "Hello" for name helper to name text helper-out be write do'));

    const payload = decodeMindPayload(records, "helper");
    assert.match(payload.prompt ?? "", /Ping/, "default bucket should contain earlier say");
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test.todo("mind call can override bucket with fromtext on invocation (pending signature/case support)");
