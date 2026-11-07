import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";
import { extractExplicitToolCalls, runToolChat } from "../program/verbs/mind/tool_chat.mjs";

test("mind tool chat normalizes explicit textual tool-call encodings", () => {
  const tools = [{ function: { name: "search" } }];
  const calls = extractExplicitToolCalls(
    'I will search now. <tool_call>{"name":"search","arguments":{"input":"Pyash"}}</tool_call>',
    tools
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "search");
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { input: "Pyash" });
});

test("mind tool chat ignores prose that is not an explicit allowed tool call", () => {
  assert.deepEqual(
    extractExplicitToolCalls("I should search the web before answering.", [{ function: { name: "search" } }]),
    []
  );
});

test("mind tool chat preserves repeated explicit calls for the call limit", () => {
  const call = JSON.stringify({ name: "search", arguments: { input: "Pyash" } });
  const calls = extractExplicitToolCalls(
    `<tool_call>${call}</tool_call><tool_call>${call}</tool_call>`,
    [{ function: { name: "search" } }]
  );
  assert.equal(calls.length, 2);
});

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
        content: `<tool_call>${JSON.stringify({
          name: toolName,
          arguments: { ob: 2, to: "total" }
        })}</tool_call>`
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

test("mind tool chat requests a user-facing summary instead of returning the last tool result", async () => {
  forget();
  resetMindLogs();

  const capability = parse("su name plus num be plus ob num 1 to name num can");
  const toolName = joinSignatureWords(deriveSignatureFromCall(capability));
  await interpret(parse("su name tools be map def"));
  await interpret(capability);
  await interpret(parse("prah"));
  const requests = [];
  const responseText = await runToolChat({
    sentence: parse('be write ob text "add" for name helper to name helper-out do'),
    ob: {},
    mindName: "helper",
    model: "fixture-model",
    dialogue: "helper tool-summary test",
    callPrompt: "Run a calculation and summarize the result.",
    resolvedConfigPrompt: "",
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
    stream: true,
    inputs: {
      inputText: "Run a calculation and summarize the result.",
      mockResponseRaw: JSON.stringify([
        {
          message: {
            content: "",
            tool_calls: [{
              id: "add-1",
              function: { name: toolName, arguments: { ob: 2, to: "total" } }
            }]
          }
        },
        { message: { content: "" } },
        { message: { content: "The result is 2." } }
      ])
    }
  });

  assert.equal(responseText, "The result is 2.");
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[2].tools, []);
  assert.match(requests[2].prompt, /tool actions.*complete/u);
});

test("mind tool chat explains when both the completion and summary are empty", async () => {
  forget();
  resetMindLogs();

  const capability = parse("su name plus num be plus ob num 1 to name num can");
  const toolName = joinSignatureWords(deriveSignatureFromCall(capability));
  await interpret(parse("su name tools be map def"));
  await interpret(capability);
  await interpret(parse("prah"));
  const responseText = await runToolChat({
    sentence: parse('be write ob text "add" for name helper to name helper-out do'),
    ob: {},
    mindName: "helper",
    model: "fixture-model",
    dialogue: "helper empty-summary test",
    callPrompt: "Run a calculation and summarize the result.",
    resolvedConfigPrompt: "",
    historyMessages: [],
    toolMap: new Map([[toolName, capability]]),
    tools: [{ function: { name: toolName } }],
    toolBlock: "",
    backendName: "",
    ollamaHost: "",
    reasoningEffort: "",
    mindDebug: false,
    debugMind: () => {},
    stream: true,
    inputs: {
      inputText: "Run a calculation and summarize the result.",
      mockResponseRaw: JSON.stringify([
        {
          message: {
            content: "",
            tool_calls: [{
              id: "add-2",
              function: { name: toolName, arguments: { ob: 2, to: "total" } }
            }]
          }
        },
        { message: { content: "" } },
        { message: { content: "" } }
      ])
    }
  });

  assert.equal(responseText, "I completed the tool calls, but the model did not provide a final summary. The tool results are shown above.");
  assert.doesNotMatch(responseText, /^su name/u);
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

test("Z.AI prompt-length rejection retries after trimming old history and keeps the active request", async () => {
  const historyMessages = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `saved exchange ${index}`
  }));
  const requests = [];
  const events = [];
  const responseText = await runToolChat({
    sentence: parse('be write ob text "question" for name helper to name text helper-out do'),
    ob: {},
    mindName: "helper",
    model: "glm-5.3-flash",
    dialogue: "helper prompt-size test",
    callPrompt: "Who is the biggest billionaire with C?",
    resolvedConfigPrompt: "Answer the current user using available tools.",
    historyMessages,
    toolMapName: "test tools",
    toolMap: new Map(),
    tools: [{ type: "function", function: { name: "be_read_from_filename" } }],
    toolBlock: "TOOLS: be read from filename",
    backendName: "zai command mind",
    ollamaHost: "https://api.z.ai/api/coding/paas/v4",
    reasoningEffort: "low",
    mindDebug: false,
    debugMind: () => {},
    stream: true,
    inputs: { inputText: "Who is the biggest billionaire with C?" },
    onToolCall: async (event) => events.push(event),
    callStream: async ({ payload }) => {
      requests.push(payload);
      const activeHistory = payload.messages.filter((message) => /^saved exchange /u.test(message.content ?? ""));
      if (activeHistory.length > 2) {
        throw new Error("Z.AI Coding Plan request failed: status=400 code=1261 error=Prompt exceeds max length");
      }
      return { message: { role: "assistant", content: "I will check the current candidates." } };
    }
  });

  assert.equal(responseText, "I will check the current candidates.");
  assert.ok(requests.length >= 2);
  assert.equal(requests.at(-1).messages.filter((message) => /^saved exchange /u.test(message.content ?? "")).length, 2);
  assert.ok(requests.at(-1).messages.some((message) => message.role === "user" && message.content.includes("Who is the biggest billionaire with C?")));
  assert.equal(events.filter((event) => event.stage === "context_compacted").length, requests.length - 1);
  assert.match(events.at(-1).toolText, /current request retained/u);
  assert.equal(events.at(-1).historyWindow, 1);
});

test("Z.AI reports when prompt limits persist after all saved history is removed", async () => {
  await assert.rejects(runToolChat({
    sentence: parse('be write ob text "question" for name helper to name text helper-out do'),
    ob: {},
    mindName: "helper",
    model: "glm-5.3-flash",
    dialogue: "helper irreducible prompt test",
    callPrompt: "Keep this active request.",
    resolvedConfigPrompt: "System instructions.",
    historyMessages: [{ role: "user", content: "old" }, { role: "assistant", content: "history" }],
    toolMapName: "test tools",
    toolMap: new Map(),
    tools: [{ type: "function", function: { name: "be_read_from_filename" } }],
    toolBlock: "TOOLS: read",
    backendName: "zai command mind",
    mindDebug: false,
    debugMind: () => {},
    stream: false,
    inputs: { inputText: "Keep this active request." },
    callBackend: async () => {
      throw new Error("Z.AI Coding Plan request failed: status=400 code=1261 error=Prompt exceeds max length");
    }
  }), /retried after removing 2 older conversation messages, but the remaining current-turn context, system instructions, and tool schemas still exceed the provider limit/u);
});

test("prompt-length recovery does not change non-Z.AI backend behavior", async () => {
  let calls = 0;
  await assert.rejects(runToolChat({
    sentence: parse('be write ob text "question" for name helper to name text helper-out do'),
    ob: {},
    mindName: "helper",
    model: "example-model",
    dialogue: "helper non-ZAI prompt limit test",
    callPrompt: "Keep this active request.",
    resolvedConfigPrompt: "System instructions.",
    historyMessages: [{ role: "user", content: "old" }],
    toolMapName: "test tools",
    toolMap: new Map(),
    tools: [{ type: "function", function: { name: "be_read_from_filename" } }],
    toolBlock: "TOOLS: read",
    backendName: "openai command mind",
    mindDebug: false,
    debugMind: () => {},
    stream: false,
    inputs: { inputText: "Keep this active request." },
    callBackend: async () => {
      calls += 1;
      throw new Error("provider request failed: status=400 code=1261 error=Prompt exceeds max length");
    }
  }), /Prompt exceeds max length/u);
  assert.equal(calls, 1);
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
