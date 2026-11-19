import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRuntime } from "../command/pyash_mcp_server.mjs";
import { requestManagedTerminal } from "../program/agent/managed_terminal_ipc.mjs";
import { parse } from "../program/understand/index.mjs";
import { doRemember, forget } from "../program/remember/index.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";
import { buildToolSchemas } from "../program/verbs/mind/tooling.mjs";
import { runToolChat } from "../program/verbs/mind/tool_chat.mjs";

test("saddle gives the model command output and the directory behind list results", async () => {
  const configRoot = process.cwd();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mind-command-results-"));
  const project = path.join(temporary, "project");
  const worldRoot = path.join(temporary, "world");
  const fixtureEnvNames = ["PYA_COMMAND_RESPONSE", "PYA_MIND_RESPONSE"];
  const previousFixtureEnv = new Map(fixtureEnvNames.map((name) => [name, process.env[name]]));
  for (const name of fixtureEnvNames) delete process.env[name];
  let sessionId = "";

  try {
    await fs.mkdir(path.join(project, "artifacts"), { recursive: true });
    await fs.mkdir(path.join(project, "manual"), { recursive: true });
    await fs.mkdir(worldRoot, { recursive: true });
    const runtime = await buildRuntime({ root: project, configRoot, toolsMap: "saddle tools" });
    doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });
    doRemember({ mood: "ya", su: { name: "agent cwd" }, be: "cwd", ob: { filename: project } });
    doRemember({ mood: "ya", su: { name: "agent sandbox" }, be: "truth", ob: { boolean: true } });
    doRemember({ mood: "ya", su: { name: "command configure" }, be: "map", ob: { map: {
      "policy mode": { ob: { wo: "allow" } },
      "classifier enabled": { ob: { bool: true } }
    } } });
    const { tools, toolMap, toolBlock } = buildToolSchemas("saddle tools");
    const startTool = tools.find((tool) => tool.function.name === "command_session_start");
    const readTool = tools.find((tool) => tool.function.name === "command_session_read");
    const listTool = tools.find((tool) => tool.function.name === "be_list_from_filename");
    assert.ok(startTool, "expected the command session start tool");
    assert.ok(readTool, "expected the command session read tool");
    assert.ok(listTool, "expected the project list tool");

    const requests = [];
    let backendCall = 0;
    const response = await runToolChat({
      sentence: parse('be write ob text "question" for name helper to name helper-out do'),
      ob: {},
      mindName: "helper",
      model: "fixture-model",
      dialogue: "helper command result context test",
      callPrompt: "Inspect this project and report the command result and project entries.",
      resolvedConfigPrompt: "Use the supplied project tools.",
      historyMessages: [],
      toolMapName: "saddle tools",
      toolMap,
      tools,
      toolBlock,
      backendName: "ollama command mind",
      mindDebug: false,
      debugMind: (label, payload) => {
        if (label === "request") requests.push(payload);
      },
      inputs: { inputText: "Inspect this project and report the command result and project entries." },
      callBackend: async () => {
        backendCall += 1;
        if (backendCall === 1) {
          return { message: { content: "", tool_calls: [{
            id: "start-project-command",
            function: {
              name: startTool.function.name,
              arguments: { request: {
                command: process.execPath,
                args: ["-e", "process.stdout.write('stdout marker\\n'); process.stderr.write('stderr marker\\n'); process.exitCode = 7;"],
                cwd: project
              } }
            }
          }] } };
        }
        if (backendCall === 2) {
          assert.ok(sessionId, "the start tool must return the session id before the model requests a read");
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const status = await requestManagedTerminal(worldRoot, project, {
              action: "read", id: sessionId, after: 0, maxBytes: 4096
            });
            if (status.status !== "running") break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return { message: { content: "", tool_calls: [{
            id: "read-project-command",
            function: {
              name: readTool.function.name,
              arguments: { request: { id: sessionId, after: 0, maxBytes: 4096 } }
            }
          }] } };
        }
        if (backendCall === 3) {
          return { message: { content: "", tool_calls: [{
            id: "list-project-directory",
            function: {
              name: listTool.function.name,
              arguments: { from: project }
            }
          }] } };
        }
        return { message: { content: "The command exited with its output, and the project contains artifacts and manual." } };
      },
      onToolCall: async (event) => {
        if (event.stage === "result" && event.toolName === startTool.function.name) {
          try {
            sessionId = JSON.parse(event.resultSentence?.ob?.text ?? "{}").id ?? "";
          } catch {
            sessionId = "";
          }
        }
      },
      stream: false
    });

    assert.equal(response, "The command exited with its output, and the project contains artifacts and manual.");
    assert.equal(backendCall, 4);
    assert.match(requests[2].prompt, /Command session read/u);
    assert.ok(requests[2].prompt.includes(`Working directory: ${project}`));
    assert.match(requests[2].prompt, /Exit code: 7/u);
    assert.match(requests[2].prompt, /Terminal output:[\s\S]*stdout marker[\s\S]*stderr marker/u);
    assert.ok(requests[3].prompt.includes(`Directory: ${project}`));
    assert.match(requests[3].prompt, /Entries \(2\):[\s\S]*artifacts[\s\S]*manual/u);
  } finally {
    if (sessionId) await requestManagedTerminal(worldRoot, project, { action: "shutdown" }).catch(() => {});
    process.chdir(configRoot);
    forget();
    await fs.rm(temporary, { recursive: true, force: true });
    for (const [name, value] of previousFixtureEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
