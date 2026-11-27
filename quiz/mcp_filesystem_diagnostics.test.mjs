import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRuntime, handleToolsCall } from "../command/pyash_mcp_server.mjs";
import { parse } from "../program/understand/index.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";
import { runToolChat } from "../program/verbs/mind/tool_chat.mjs";
import { doRemember } from "../program/remember/index.mjs";

test("MCP and saddle explain a file blocking a directory while read still works", async () => {
  const configRoot = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mcp-filesystem-diagnostics-"));
  const publicationPath = path.join(root, "publication");
  const publicationContents = "Publication metadata instructions\n";
  const fixtureEnvNames = [
    "PYA_COMMAND_RESPONSE",
    "PYA_DOWNLOAD_RESPONSE",
    "PYA_HEAR_FIXTURE",
    "PYA_MIND_RESPONSE",
    "PYA_PIPER_FIXTURE",
    "PYA_WEB_SEARCH_FIXTURE"
  ];
  const previousFixtureEnv = new Map(fixtureEnvNames.map((name) => [name, process.env[name]]));
  for (const name of fixtureEnvNames) delete process.env[name];

  try {
    await fs.writeFile(publicationPath, publicationContents, "utf8");
    const runtime = await buildRuntime({ root, configRoot, toolsMap: "agent tools" });
    doRemember({ mood: "ya", su: { name: "agent cwd" }, be: "cwd", ob: { filename: root } });
    doRemember({ mood: "ya", su: { name: "agent sandbox" }, be: "truth", ob: { boolean: true } });
    const writeTool = runtime.tools.find((tool) => tool.name === "be_write_ob_text_to_filename");
    const listTool = runtime.tools.find((tool) => tool.name === "be_list_from_filename");
    const readTool = runtime.tools.find((tool) => tool.name === "be_read_from_filename");
    assert.ok(writeTool, "expected the MCP write capability");
    assert.ok(listTool, "expected the MCP list capability");
    assert.ok(readTool, "expected the MCP read capability");

    const nestedPath = path.join(publicationPath, "metadata", "01.json");
    const writeResult = await handleToolsCall(runtime, {
      name: writeTool.name,
      arguments: { ob: "{\"status\":\"draft\"}\n", to: nestedPath }
    });
    const listResult = await handleToolsCall(runtime, {
      name: listTool.name,
      arguments: { from: publicationPath }
    });
    const readResult = await handleToolsCall(runtime, {
      name: readTool.name,
      arguments: { from: publicationPath }
    });

    assert.equal(writeResult.isError, true);
    assert.match(writeResult.content[0].text, /blocking path component.*publication.*regular file/iu);
    assert.match(writeResult.content[0].text, /expected a directory/iu);
    assert.match(writeResult.content[0].text, /read the existing file|choose a different destination/iu);

    assert.equal(listResult.isError, true);
    assert.match(listResult.content[0].text, /cannot list.*publication/iu);
    assert.match(listResult.content[0].text, /found a regular file.*expected a directory/iu);
    assert.match(listResult.content[0].text, /read this file|list its parent/iu);

    assert.equal(readResult.isError, undefined, readResult.content[0].text);
    assert.equal(readResult.content[0].text, publicationContents);
    assert.equal(await fs.readFile(publicationPath, "utf8"), publicationContents);

    const { tools, toolMap, toolBlock } = buildToolSchemas("agent tools");
    const events = [];
    const requests = [];
    resetMindLogs();
    const response = await runToolChat({
      sentence: parse('be write ob text "question" for name helper to name helper-out do'),
      ob: {},
      mindName: "helper",
      model: "fixture-model",
      dialogue: "helper filesystem diagnostic test",
      callPrompt: "Save the metadata file.",
      resolvedConfigPrompt: "Use tools to complete requested actions.",
      historyMessages: [],
      toolMapName: "agent tools",
      toolMap,
      tools,
      toolBlock,
      backendName: "ollama command mind",
      mindDebug: false,
      debugMind: (label, payload) => {
        if (label === "request") requests.push(payload);
      },
      inputs: {
        inputText: "Save the metadata file.",
        mockResponseRaw: JSON.stringify([
          {
            message: {
              content: "",
              tool_calls: [{
                id: "blocked-write",
                function: {
                  name: writeTool.name,
                  arguments: { ob: "{}", to: nestedPath }
                }
              }]
            }
          },
          { message: { content: "The existing file blocks this directory path." } }
        ])
      },
      onToolCall: async (event) => events.push(event),
      stream: false
    });

    assert.equal(response, "The existing file blocks this directory path.");
    const writeEvent = events.find((event) => event.stage === "result" && event.toolName === writeTool.name);
    assert.match(writeEvent?.toolText ?? "", /publication.*regular file/iu);
    assert.equal(requests.length, 2);
    assert.match(requests[1].prompt, /Blocking path component/iu);
    assert.match(requests[1].prompt, /Read the existing entry.*choose a different destination/iu);
    assert.equal(await fs.readFile(publicationPath, "utf8"), publicationContents);
  } finally {
    process.chdir(configRoot);
    await fs.rm(root, { recursive: true, force: true });
    for (const [name, value] of previousFixtureEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
