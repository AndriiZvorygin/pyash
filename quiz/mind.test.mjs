import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";
import { jsonObjectFromMapName } from "../program/verbs/exchange/json_map_export.mjs";

function buildMapIndex(records) {
  const index = new Map();
  for (let i = 0; i < records.length; i += 1) {
    const sentence = records[i];
    if (sentence?.mood !== "def" || sentence?.be !== "json map" || !sentence?.su?.name) continue;
    const name = sentence.su.name;
    const map = {};
    i += 1;
    for (; i < records.length; i += 1) {
      const entry = records[i];
      if (entry?.mood === "prah" && entry?.su?.name === name) break;
      if (entry?.mood === "ya" && entry?.su?.name) {
        map[entry.su.name] = entry.ob ?? {};
      }
    }
    index.set(name, { mood: "ya", su: { name }, be: "json map", ob: { map } });
  }
  return index;
}

function decodeMindPayload(records, name, label = "request") {
  const index = buildMapIndex(records);
  const mapName = [...index.keys()].reverse().find(key => key.startsWith(`${name} ${label} `));
  if (!mapName) return {};
  const remember = (map) => index.get(map);
  return jsonObjectFromMapName(mapName, { remember, seen: new Set(), sourceName: "mind test", allowHollowVector: true });
}

test("mind registration stores engine/model/prompt contexts", async () => {
  forget();

  const sentence = parse(
    'exists su generator be mind from space "http://localhost:11434" from discourse "orchestrator" via state "qwen3:8b" ya'
  );

  await interpret(sentence);

  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "generator");

  assert.ok(fact);
  assert.equal(fact.be, "mind");
  assert.equal(fact.from?.name, "http://localhost:11434");
  assert.equal(fact.as?.name, "qwen3:8b");
  assert.equal(fact.fromtext?.name, "orchestrator");
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
      parse('exists su generator be mind from space "http://localhost:11434" from discourse "orchestrator" via state "qwen3:8b" ya')
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
      parse('exists su generator by num 1 be mind from space "http://localhost:11434" from discourse "orchestrator" via state "qwen3:8b" ya')
    );

    await interpret(parse('be write ob text "Hi" for name generator to name text generator-out do'));
    await interpret(parse('su question ob discourse "Hello" for name generator to name text generator-out be write do'));

    const payload = decodeMindPayload(records, "generator");
    // With window 1, we keep at most 1 user+agent pair
    assert.match(payload.prompt ?? "", /USER: Hi/);
    assert.match(payload.prompt ?? "", /AGENT:/);
    assert.match(payload.prompt ?? "", /Hello/);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind invocation with by num 0 sends no prior dialogue history", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(
      parse('exists su generator be mind from discourse "orchestrator" via state "qwen3:8b" ya')
    );
    await interpret(parse('be write ob text "first turn" for name generator to name text generator-out do'));
    await interpret(parse('su question ob discourse "second turn" for name generator to name text generator-out by num 0 be write do'));

    const payload = decodeMindPayload(records, "generator");
    assert.doesNotMatch(payload.prompt ?? "", /first turn/);
    assert.match(payload.prompt ?? "", /second turn/);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind invocation uses configured mind model when per-mind model is absent", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse('exists su name mind model ob text "gpt-5.3-codex" be default ya'));
    await interpret(parse("exists su name helper be mind ya"));
    await interpret(parse('be write ob text "hello" for name helper to name text helper-out do'));

    const payload = decodeMindPayload(records, "helper");
    assert.equal(payload.model, "gpt-5.3-codex");
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind history can be injected from a series via accordingto", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse("su name session be series def"));
    await interpret(parse('su name user ob text "Hi from series" be text ya'));
    await interpret(parse('su name assistant ob text "Series reply" be text ya'));
    await interpret(parse("prah"));
    await interpret(parse('exists su helper be mind accordingto name session via state "qwen3:8b" ya'));

    await interpret(parse('su q ob discourse "Hello" for name helper to name text helper-out be write do'));

    const payload = decodeMindPayload(records, "helper");
    assert.match(payload.prompt ?? "", /USER: Hi from series/);
    assert.match(payload.prompt ?? "", /AGENT: Series reply/);

    const mem = allRemember();
    const session = mem.find(s => s.su?.name === "session");
    assert.ok(session);
    assert.ok(Array.isArray(session.ob?.series));
    assert.equal(session.ob.series.length, 4);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind accordingto series honors by num 0 and suppresses series history", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse("su name session be series def"));
    await interpret(parse('su name user ob text "Hi from series" be text ya'));
    await interpret(parse('su name assistant ob text "Series reply" be text ya'));
    await interpret(parse("prah"));
    await interpret(parse('exists su helper be mind accordingto name session via state "qwen3:8b" ya'));
    await interpret(parse('su q ob discourse "Hello" for name helper to name text helper-out by num 0 be write do'));

    const payload = decodeMindPayload(records, "helper");
    assert.doesNotMatch(payload.prompt ?? "", /Hi from series/);
    assert.doesNotMatch(payload.prompt ?? "", /Series reply/);
    assert.match(payload.prompt ?? "", /Hello/);
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

test("mind session map exposes per-dialogue series", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";

  try {
    await interpret(parse('exists su helper be mind via state "qwen3:8b" ya'));
    await interpret(parse('su q ob discourse "Hello" for name helper to name text helper-out be write do'));

    const mem = allRemember();
    const mapFact = mem.find(s => s.su?.name === "mind session map");
    assert.ok(mapFact);
    assert.equal(mapFact.be, "map");
    const entry = mapFact.ob?.map?.["helper story"];
    assert.ok(entry);
    assert.equal(entry.ob?.name, "helper story session");

    const series = mem.find(s => s.su?.name === "helper story session");
    assert.ok(series);
    assert.equal(series.be, "series");
    assert.equal(series.ob?.series?.length, 2);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test.todo("mind call can override series with accordingto on invocation (pending spec)");
