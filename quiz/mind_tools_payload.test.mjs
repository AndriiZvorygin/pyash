import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
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

test("mind tool adapter loads default tools for with wo tools", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));
    await interpret(parse("ob text \"use tools\" for name helper to name text helper-out with wo tools be write do"));

    const payload = decodeMindPayload(records, "helper");
    const capturedTools = payload.tools ?? [];
    const names = capturedTools.map(tool => tool?.function?.name).filter(Boolean);
    assert.ok(names.includes("be_read_from_filename"), "default tools should include read");
    assert.ok(names.includes("be_write_ob_text_to_filename"), "default tools should include write");
    assert.ok(names.includes("be_repair_ob_text_to_name_map"), "default tools should include repair");
    assert.ok(names.includes("be_repair_as_wo_check_ob_text_to_name_map"), "default tools should include repair check");
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind tool adapter includes propose tools and skips denied proposals via ratify policy", async () => {
  forget();
  resetMindLogs();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ratify-deny-"));
  const worldRoot = path.join(tmp, "world");
  const conductDir = path.join(worldRoot, "house", "helper", "conduct");
  await fs.mkdir(conductDir, { recursive: true });
  await fs.writeFile(path.join(conductDir, "ratify.pya"), "su name be_command_ob_text ob bool lie ya\n", "utf8");
  doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });

  const deniedPath = path.join(tmp, "denied.txt");
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    {
      message: {
        content: "",
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "be_command_ob_text",
              arguments: JSON.stringify({ ob: `printf denied > "${deniedPath}"` })
            }
          }
        ]
      }
    },
    { message: { content: "done" } }
  ]);
  const records = [];
  setExchangeRecorder({ record: (sentence) => records.push(sentence) });

  try {
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name run shell be command ob text input propose"));
    await interpret(parse("prah"));
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));
    const res = await interpret(parse("ob text \"do it\" for name helper to name text helper-out with name tools be write do"));
    assert.equal(res?.ob?.text, "done");

    const payload = decodeMindPayload(records, "helper");
    const names = (payload.tools ?? []).map(tool => tool?.function?.name).filter(Boolean);
    assert.ok(names.includes("be_command_ob_text"), "propose tool should be exported to tools list");
    assert.match(String(payload.prompt ?? ""), /be ratify ya/, "denied proposal should be surfaced as ratify tool result");

    await assert.rejects(fs.access(deniedPath), { code: "ENOENT" });
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind tool adapter executes propose tools when ratify policy allows", async () => {
  forget();
  resetMindLogs();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ratify-allow-"));
  const worldRoot = path.join(tmp, "world");
  const conductDir = path.join(worldRoot, "house", "helper", "conduct");
  await fs.mkdir(conductDir, { recursive: true });
  await fs.writeFile(path.join(conductDir, "ratify.pya"), "su name be_command_ob_text ob bool truth ya\n", "utf8");
  doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });

  const allowedPath = path.join(tmp, "allowed.txt");
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    {
      message: {
        content: "",
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "be_command_ob_text",
              arguments: JSON.stringify({ ob: `printf allowed > "${allowedPath}"` })
            }
          }
        ]
      }
    },
    { message: { content: "done" } }
  ]);
  setExchangeRecorder({ record: () => {} });

  try {
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name run shell be command ob text input propose"));
    await interpret(parse("prah"));
    await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));
    const res = await interpret(parse("ob text \"do it\" for name helper to name text helper-out with name tools be write do"));
    assert.equal(res?.ob?.text, "done");
    const content = await fs.readFile(allowedPath, "utf8");
    assert.equal(content, "allowed");
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
