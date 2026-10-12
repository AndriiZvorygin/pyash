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

test("mind tool chat gives models readable errors instead of Pyash protocol sentences", async () => {
  forget();
  resetMindLogs();

  const capability = parse("su name list files be list from filename input can");
  const toolName = joinSignatureWords(deriveSignatureFromCall(capability));
  const requests = [];
  const responseText = await runToolChat({
    sentence: parse('be write ob text "inspect" for name helper to name text helper-out do'),
    ob: {},
    mindName: "helper",
    model: "qwen3.8:27b",
    dialogue: "helper story",
    callPrompt: "inspect",
    resolvedConfigPrompt: "Use tools and explain failures plainly.",
    historyMessages: [],
    toolMap: new Map([[toolName, capability]]),
    tools: [{ function: { name: toolName } }],
    toolBlock: "",
    backendName: "",
    ollamaHost: "",
    reasoningEffort: "",
    mindDebug: false,
    debugMind: (label, payload) => {
      if (label === "request") requests.push(payload);
    },
    inputs: {
      inputText: "inspect",
      mockResponseRaw: JSON.stringify([
        {
          message: {
            content: "",
            tool_calls: [{
              function: { name: toolName, arguments: { from: "missing-directory-for-test" } }
            }]
          }
        },
        { message: { content: "I could not access that directory." } }
      ])
    }
  });

  assert.equal(responseText, "I could not access that directory.");
  assert.equal(requests.length, 2);
  const secondPrompt = String(requests[1]?.prompt ?? "");
  assert.match(secondPrompt, /file or directory unavailable: .*missing-directory-for-test/);
  assert.doesNotMatch(secondPrompt, /su name file or directory unavailable/);
  assert.doesNotMatch(secondPrompt, /call: be_/);
});

test("runtime status tool receives the current model context", async () => {
  forget();
  resetMindLogs();

  const capability = parse("su name runtime status be status as wo runtime can");
  const toolName = joinSignatureWords(deriveSignatureFromCall(capability));
  const requests = [];
  const responseText = await runToolChat({
    sentence: parse('be write ob text "status" for name helper to name text helper-out do'),
    ob: {},
    mindName: "helper",
    model: "qwen3.8:27b",
    dialogue: "helper story",
    callPrompt: "tell me which model and settings are active",
    resolvedConfigPrompt: "Use the runtime status tool when asked about the active model.",
    historyMessages: [],
    toolMap: new Map([[toolName, capability]]),
    tools: [{ function: { name: toolName } }],
    toolBlock: "",
    backendName: "",
    ollamaHost: "http://mriczo:11434",
    reasoningEffort: "high",
    modelTuning: { think: false, temperature: 0.2, topP: 0.8, topK: 20, numPredict: 512 },
    runtimeContext: {
      model: "qwen3.8:27b",
      backend: "ollama",
      host: "http://mriczo:11434",
      reasoningEffort: "high",
      modelTuning: { think: false, temperature: 0.2, topP: 0.8, topK: 20, numPredict: 512 },
      toolMap: "agent tools",
      agentName: "helper"
    },
    mindDebug: false,
    debugMind: (label, payload) => {
      if (label === "request") requests.push(payload);
    },
    inputs: {
      inputText: "tell me which model and settings are active",
      mockResponseRaw: JSON.stringify([
        {
          message: {
            content: "",
            tool_calls: [{ function: { name: toolName, arguments: {} } }]
          }
        },
        { message: { content: "qwen3.8:27b is active." } }
      ])
    }
  });

  assert.equal(responseText, "qwen3.8:27b is active.");
  assert.equal(requests.length, 2);
  const toolResultPrompt = String(requests[1]?.prompt ?? "");
  assert.match(toolResultPrompt, /qwen3\.8:27b/);
  assert.match(toolResultPrompt, /temperature/);
  assert.match(toolResultPrompt, /think/);
  assert.match(toolResultPrompt, /mriczo/);
});
