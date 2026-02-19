import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";
import { runToolChat } from "../program/verbs/mind/tool_chat.mjs";

test("mind tool calling executes allowed tool and returns final answer", async () => {
  forget();
  resetMindLogs();

  const toolSentence = parse("su name plus num be plus ob num 1 to name num can");
  const toolName = joinSignatureWords(deriveSignatureFromCall(toolSentence));

  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = JSON.stringify([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            type: "function",
            function: {
              name: toolName,
              arguments: { ob: 2, to: "total" }
            }
          }
        ]
      }
    },
    { message: { role: "assistant", content: "done" } }
  ]);

  try {
    await interpret(parse("su name tools be map def"));
    await interpret(parse("su name plus num be plus ob num 1 to name num can"));
    await interpret(parse("prah"));
    await interpret(parse('exists su name helper be mind via state "qwen3" ya'));
    await interpret(parse("exists su name total ob num 3 be number ya"));

    await interpret(parse("ob text \"plus\" for name helper to name text helper-out with name tools be write do"));

    const mem = allRemember();
    const total = mem.find(s => s.su?.name === "total");
    const answer = mem.find(s => s.su?.name === "helper answer 1");

    assert.equal(total?.ob?.num, 5);
    assert.equal(answer?.ob?.text, "done");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("mind tool chat forwards observed codex tool events without local re-execution", async () => {
  forget();
  resetMindLogs();

  const observed = [];
  const responseText = await runToolChat({
    sentence: parse('be write ob text "hi" for name helper to name text helper-out do'),
    ob: {},
    mindName: "helper",
    model: "gpt-5.3-codex",
    dialogue: "helper story",
    callPrompt: "hi",
    resolvedConfigPrompt: "",
    historyMessages: [],
    toolMap: new Map(),
    tools: [],
    toolBlock: "",
    backendName: "",
    ollamaHost: "",
    reasoningEffort: "",
    mindDebug: false,
    debugMind: () => {},
    onToolCall: async (payload) => { observed.push(payload); },
    inputs: {
      inputText: "hi",
      mockResponseRaw: JSON.stringify({
        message: {
          content: "done",
          observed_tool_events: [
            {
              stage: "call",
              toolName: "command",
              toolCall: {
                id: "item_2",
                type: "function",
                function: { name: "command", arguments: "{\"command\":\"ls -1\"}" }
              },
              toolText: "ls -1"
            },
            {
              stage: "result",
              toolName: "command",
              toolText: "exit=0 output=README.md"
            }
          ]
        }
      })
    }
  });

  assert.equal(responseText, "done");
  assert.equal(observed.length, 2);
  assert.equal(observed[0]?.stage, "call");
  assert.equal(observed[0]?.toolName, "command");
  assert.equal(observed[1]?.stage, "result");
  assert.match(String(observed[1]?.toolText ?? ""), /exit=0/);
});
