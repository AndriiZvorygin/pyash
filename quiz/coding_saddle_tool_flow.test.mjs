import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { runToolChat } from "../program/verbs/mind/tool_chat.mjs";
import { DEFAULT_CODING_SADDLE_SYSTEM_PROMPT } from "../program/agent/coding_saddle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadSaddleTools() {
  forget();
  await interpret(parse(
    `from filename ${JSON.stringify(path.join(repoRoot, "module", "saddle_tools.pya"))} ob name saddle tools to name saddle tools be import do`
  ));
  return buildToolSchemas("saddle tools");
}

function toolByDescription(tools, text) {
  return tools.find((tool) => String(tool?.function?.description ?? "").includes(text));
}

function toolResponse(toolName, args, id) {
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{
        id,
        type: "function",
        function: { name: toolName, arguments: JSON.stringify(args) }
      }]
    }
  };
}

async function runMockedSaddleTurn({ inputText, tools, toolMap, responses, runtimeContext = {} }) {
  const events = [];
  const result = await runToolChat({
    sentence: {},
    ob: {},
    mindName: "coding saddle",
    model: "test-model",
    dialogue: [],
    callPrompt: "",
    resolvedConfigPrompt: DEFAULT_CODING_SADDLE_SYSTEM_PROMPT,
    historyMessages: [],
    toolMapName: "saddle tools",
    toolMap,
    tools,
    backendName: "ollama command mind",
    ollamaHost: "http://localhost:11434",
    runtimeContext: { agentName: "coding saddle", ...runtimeContext },
    inputs: { inputText, mockResponseRaw: JSON.stringify(responses) },
    debugMind: () => {},
    onToolCall: async (event) => { events.push(event); }
  });
  return { result, events };
}

test("saddle rejects an internal runner tool call then finishes the user turn", async () => {
  const { tools, toolMap } = await loadSaddleTools();
  const commandTool = toolByDescription(tools, "saddle tools internal command");
  assert.ok(commandTool);

  const { result, events } = await runMockedSaddleTurn({
    inputText: "hi",
    tools,
    toolMap,
    responses: [
      toolResponse(commandTool.function.name, {
        ob: "PYA_COMMAND_TIMEOUT_MS=900000 node command/mind_ollama_runner.mjs"
      }, "invalid-runtime-call"),
      { message: { role: "assistant", content: "Hi! What can I help with?" } }
    ]
  });

  assert.equal(result, "Hi! What can I help with?");
  assert.deepEqual(events.map((event) => event.stage), ["call", "result"]);
  assert.match(events[1].toolText, /internal adapters, not shell entry points/u);
  forget();
});

test("URL news request downloads the supplied URL and reads the downloaded page", async (t) => {
  const oldCwd = process.cwd();
  const oldDownloadResponse = process.env.PYA_DOWNLOAD_RESPONSE;
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-url-flow-"));
  const worldRoot = path.join(cwd, "world");
  const sourceUrl = "https://yago.zvorygin.ca";
  const outputFile = path.join(cwd, "artifacts", "yago.html");
  process.chdir(cwd);
  process.env.PYA_DOWNLOAD_RESPONSE = "<html><body><h1>Tech News</h1><p>Current technology headlines.</p></body></html>";
  t.after(async () => {
    process.chdir(oldCwd);
    if (oldDownloadResponse === undefined) delete process.env.PYA_DOWNLOAD_RESPONSE;
    else process.env.PYA_DOWNLOAD_RESPONSE = oldDownloadResponse;
    forget();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const { tools, toolMap } = await loadSaddleTools();
  doRemember({ mood: "ya", be: "cwd", su: { name: "agent cwd" }, ob: { filename: cwd } });
  doRemember({ mood: "ya", be: "sandbox", su: { name: "agent sandbox" }, ob: { boolean: true } });
  doRemember({ mood: "ya", be: "directory", su: { name: "world root" }, ob: { filename: worldRoot } });
  const downloadTool = toolByDescription(tools, "saddle tools internal download");
  const readMarkdownTool = toolByDescription(tools, "saddle tools internal read markdown");
  assert.ok(downloadTool);
  assert.ok(readMarkdownTool);

  const { result, events } = await runMockedSaddleTurn({
    inputText: `Can you pull from ${sourceUrl} tech news?`,
    tools,
    toolMap,
    runtimeContext: { agentCwd: cwd, cwd },
    responses: [
      toolResponse(downloadTool.function.name, { from: sourceUrl, to: outputFile }, "download-yago"),
      toolResponse(readMarkdownTool.function.name, { from: outputFile }, "read-yago"),
      { message: { role: "assistant", content: "The downloaded page contains the Tech News heading and current technology headlines." } }
    ]
  });

  const calls = events.filter((event) => event.stage === "call");
  assert.deepEqual(calls.map((event) => event.toolName), [downloadTool.function.name, readMarkdownTool.function.name]);
  assert.equal(calls[0].toolSentence.from.filename, sourceUrl);
  assert.equal(calls[0].toolSentence.to.filename, outputFile);
  assert.equal(calls[1].toolSentence.from.filename, outputFile);
  assert.match(await fs.readFile(outputFile, "utf8"), /Tech News/u);
  assert.match(events.find((event) => event.stage === "result" && event.toolName === readMarkdownTool.function.name)?.toolText ?? "", /Tech News/u);
  assert.match(result, /current technology headlines/u);
});
