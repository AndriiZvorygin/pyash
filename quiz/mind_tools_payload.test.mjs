import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import motor from "../program/motor/ollama.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

test("mind tool adapter sends non-empty tools array for with name map", async () => {
  forget();
  resetMindLogs();

  let capturedTools = null;
  const originalChat = motor.chat;
  motor.chat = async ({ tools }) => {
    capturedTools = tools;
    return { message: { role: "assistant", content: "ok" } };
  };

  await interpret(parse("su name tools be map def"));
  await interpret(parse("su name add num be add ob num 1 to name num can"));
  await interpret(parse("prah"));
  await interpret(parse("exists su name helper be mind via state \"qwen3\" ya"));

  await interpret(parse("ob text \"use add\" for name helper to name text helper-out with name tools be write do"));

  motor.chat = originalChat;

  assert.ok(Array.isArray(capturedTools), "tools should be passed to chat");
  assert.ok(capturedTools.length > 0, "tools should be non-empty");
  const tool = capturedTools[0]?.function ?? {};
  assert.equal(tool.name, "be_add_ob_num_to_name_num");
  assert.equal(tool.signature, "be add ob num to name num");
  assert.ok(tool.parameters?.properties?.ob, "tool should include ob");
  assert.ok(tool.parameters?.properties?.to, "tool should include to");
});
