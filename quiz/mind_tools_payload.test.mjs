import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
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
    assert.ok(tool.parameters?.properties?.ob, "tool should include ob");
    assert.ok(tool.parameters?.properties?.to, "tool should include to");
  } finally {
    clearExchangeRecorder();
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
