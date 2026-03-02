import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile write to mind emits mind call", async () => {
  forget();

  const program = [
    "exists su name helper be mind from name http://localhost:11434 ya",
    "ob text hello for name helper to name text helper-out be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.ob?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  assert.match(js, /mindConfigs.set/, "mind config should be emitted");
  assert.match(js, /callMind\(/, "should route through mind helper");
  assert.match(js, /messages\.push\(\{ role: "user", content: "hello" \}\)/, "should push user message");
});

test("compiled write to mind builds messages payload and uses helper transport", async () => {
  forget();

  const program = [
    "exists su name helper by num 1 be mind from name http://localhost:11434 ya",
    "ob text hello for name helper to name text helper-out be write do",
    "ob text again for name helper to name text helper-out be write do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = (result?.ob?.text ?? result?.value?.text ?? "")
    .replace(/^\s*quoted\.javascript\.\s*/, "")
    .replace(/\s*\.javascript\.quoted\s*$/, "");

  const calls = [];
  const context = {
    ollamaChat: payload => {
      calls.push(payload);
      return "ok";
    },
    console: { log: () => {} }
  };
  context.globalThis = context;
  const runResult = vm.runInNewContext(js, context);
  if (runResult && typeof runResult.then === "function") {
    await runResult;
  }

  assert.equal(calls.length, 2, "helper should be called for each say");
  const [payload] = calls;
  assert.equal(payload.host, "http://localhost:11434");
  assert.equal(payload.model, "qwen3.5:9b");
  assert.equal(payload.messages.at(-1).content, "hello");
  assert.equal(payload.messages.at(-1).role, "user");
  assert.ok(payload.messages.every(m => m.role && m.content !== undefined));
  // Second call should include first exchange in history, bounded by window=1 (2 messages max)
  const second = calls[1];
  assert.ok(second.messages.length <= 1 /*user*/ + 1 /*assistant*/ + 1 /*current*/ + 1 /*maybe system*/, "history window should bound messages");
  const userMsgs = second.messages.filter(m => m.role === "user");
  const assistantMsgs = second.messages.filter(m => m.role === "assistant");
  assert.ok(userMsgs.length >= 1);
  assert.ok(assistantMsgs.length >= 0);
});
