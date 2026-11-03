import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { forget } from "../program/remember/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { parse } from "../program/understand/index.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { runToolChat } from "../program/verbs/mind/tool_chat.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("saddle plan capability dispatches to the session callback instead of generic interpretation", async () => {
  forget();
  await interpret(parse(`from filename ${JSON.stringify(path.join(root, "module/saddle_tools.pya"))} ob name saddle tools to name saddle tools be import do`));
  const schema = buildToolSchemas("saddle tools");
  const planTool = schema.tools.find(({ function: fn }) => fn.signature === "be write fromstate text ob text");
  assert.ok(planTool);
  assert.match(planTool.function.description, /JSON-encoded object string/u);
  assert.match(planTool.function.description, /"action":"create"/u);
  assert.match(planTool.function.description, /"action":"update_step"/u);

  const action = {
    action: "create",
    objective: "Stream the response",
    steps: [{ title: "Add streamed chunks" }]
  };
  const events = [];
  const callbackInputs = [];
  const mockResponseRaw = JSON.stringify([
    {
      message: {
        content: "",
        tool_calls: [{
          id: "plan-1",
          function: { name: planTool.function.name, arguments: JSON.stringify({ ob: JSON.stringify(action) }) }
        }]
      }
    },
    { message: { content: "Plan saved for this session." } }
  ]);
  const response = await runToolChat({
    sentence: {},
    ob: {},
    mindName: "coding saddle",
    model: "test-model",
    dialogue: "coding-saddle-plan-test",
    callPrompt: "Create the plan.",
    resolvedConfigPrompt: "Use the plan capability.",
    historyMessages: [],
    toolMapName: "saddle tools",
    toolMap: schema.toolMap,
    tools: schema.tools,
    toolBlock: schema.toolBlock,
    backendName: "ollama command mind",
    debugMind: () => {},
    inputs: { inputText: "", mockResponseRaw },
    saddlePlanTool: async (input) => {
      callbackInputs.push(input);
      return {
        mood: "ya",
        su: { name: "coding saddle plan result" },
        be: "text",
        ob: { text: "plan · Stream the response\nstep-001 [pending] Add streamed chunks" }
      };
    },
    onToolCall: (event) => events.push(event)
  });

  assert.equal(response, "Plan saved for this session.");
  assert.deepEqual(callbackInputs, [JSON.stringify(action)]);
  assert.deepEqual(events.map(({ stage }) => stage), ["call", "result"]);
  assert.match(events[1].toolText, /Add streamed chunks/u);
});

test("invalid saddle plan input is returned to the model as a recoverable tool result", async () => {
  forget();
  await interpret(parse(`from filename ${JSON.stringify(path.join(root, "module/saddle_tools.pya"))} ob name saddle tools to name saddle tools be import do`));
  const schema = buildToolSchemas("saddle tools");
  const planTool = schema.tools.find(({ function: fn }) => fn.signature === "be write fromstate text ob text");
  const events = [];
  const requests = [];
  const response = await runToolChat({
    sentence: {},
    ob: {},
    mindName: "coding saddle",
    model: "test-model",
    dialogue: "coding-saddle-invalid-plan-test",
    callPrompt: "Create a concise session plan.",
    resolvedConfigPrompt: "Use the session plan tool for multi-step work.",
    historyMessages: [],
    toolMapName: "saddle tools",
    toolMap: schema.toolMap,
    tools: schema.tools,
    toolBlock: schema.toolBlock,
    backendName: "ollama command mind",
    debugMind: (label, payload) => {
      if (label === "request") requests.push(payload);
    },
    inputs: {
      inputText: "Create a concise session plan.",
      mockResponseRaw: JSON.stringify([
        {
          message: {
            content: "",
            tool_calls: [{
              id: "invalid-plan-1",
              function: { name: planTool.function.name, arguments: JSON.stringify({ ob: "not JSON" }) }
            }]
          }
        },
        { message: { content: "The plan payload was invalid, so I will retry with a structured object." } }
      ])
    },
    saddlePlanTool: async () => {
      throw new Error("plan tool input must be a JSON object with action, objective, and steps or a step update");
    },
    onToolCall: (event) => events.push(event)
  });

  assert.equal(response, "The plan payload was invalid, so I will retry with a structured object.");
  assert.equal(requests.length, 2);
  assert.match(String(requests[1]?.prompt ?? ""), /coding saddle plan update failed/u);
  assert.match(String(requests[1]?.prompt ?? ""), /JSON object with action, objective, and steps/u);
  assert.deepEqual(events.map(({ stage }) => stage), ["call", "result"]);
  assert.match(events[1].toolText, /coding saddle plan update failed/u);
});
