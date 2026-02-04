import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
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
  return jsonObjectFromMapName(mapName, { remember, seen: new Set(), sourceName: "mind tool test", allowHollowVector: true });
}

test("mind tool adapter sends non-empty tools array for with name map", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name plus num be plus ob num 1 to name num can"));
    await interpret(parse("prah"));
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));

    await interpret(parse("ob text \"use plus\" for name helper to name text helper-out with name tools be write do"));

    const payload = decodeMindPayload(records, "helper");
    const capturedTools = payload.tools;
    assert.ok(Array.isArray(capturedTools), "tools should be passed to chat");
    assert.ok(capturedTools.length > 0, "tools should be non-empty");
    const tool = capturedTools[0]?.function ?? {};
    assert.equal(tool.name, "be_plus_ob_num_to_name_num");
    assert.equal(tool.signature, "be plus ob num to name num");
    assert.ok(tool.parameters?.properties?.to, "tool should include to");
    assert.ok(!tool.parameters?.properties?.ob, "tool should not include ob when fixed");
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind tool adapter respects input markers in can sentences", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name write note be write ob text input to filename \"/tmp/example.txt\" can"));
    await interpret(parse("prah"));
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));

    await interpret(parse("ob text \"use write\" for name helper to name text helper-out with name tools be write do"));

    const payload = decodeMindPayload(records, "helper");
    const capturedTools = payload.tools;
    assert.ok(Array.isArray(capturedTools), "tools should be passed to chat");
    assert.ok(capturedTools.length > 0, "tools should be non-empty");
    const tool = capturedTools[0]?.function ?? {};
    assert.equal(tool.name, "be_write_ob_text_to_filename");
    assert.ok(tool.parameters?.properties?.ob, "tool should include ob");
    assert.ok(!tool.parameters?.properties?.to, "tool should not include to when not marked input");
    assert.deepEqual(tool.parameters?.required ?? [], ["ob"]);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind tool adapter exposes open slots when no input markers", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name read file be read from name filename can"));
    await interpret(parse("prah"));
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));

    await interpret(parse("ob text \"use read\" for name helper to name text helper-out with name tools be write do"));

    const payload = decodeMindPayload(records, "helper");
    const capturedTools = payload.tools;
    assert.ok(Array.isArray(capturedTools), "tools should be passed to chat");
    assert.ok(capturedTools.length > 0, "tools should be non-empty");
    const tool = capturedTools[0]?.function ?? {};
    assert.equal(tool.name, "be_read_from_name_filename");
    assert.ok(tool.parameters?.properties?.from, "tool should include from");
    assert.deepEqual(tool.parameters?.required ?? [], ["from"]);
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
