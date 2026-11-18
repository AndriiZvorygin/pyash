import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { stripTerminalControlSequences } from "../program/agent/coding_saddle_tui.mjs";
import { resolveSaddleProjectWorldRoot } from "../command/pyash_saddle.mjs";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const firstModel = "qwen3.5:9b";
const secondModel = "SparkLLM/Spark-X2.6-4B:q4_k_m";

function waitForOutput(getOutput, needle, { timeoutMs = 30000, afterIndex = 0 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const output = stripTerminalControlSequences(getOutput());
      if (output.indexOf(needle, afterIndex) >= 0) {
        resolve(output);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for ${JSON.stringify(needle)}\n${output.slice(-6000)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForOutputAfter(getOutput, marker, needle, { timeoutMs = 30000 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const output = stripTerminalControlSequences(getOutput());
      const markerIndex = output.indexOf(marker);
      if (markerIndex >= 0 && output.indexOf(needle, markerIndex + marker.length) >= 0) {
        resolve(output);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for ${JSON.stringify(needle)} after ${JSON.stringify(marker)}\n${output.slice(-6000)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

test("saddle CLI switches Ollama models in a PTY and runs the default Bash tool", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-pty-"));
  const projectRoot = path.join(tempRoot, "project");
  const projectWorldRoot = resolveSaddleProjectWorldRoot({ runtimeRoot, cwd: projectRoot });
  const usageDir = path.join(tempRoot, "usage");
  const sessionName = `pty-model-switch-${process.pid}-${Date.now()}`;
  const bashMarker = "SADDLE_BASH_PTY_OK";
  const submissions = [];
  const jobs = new Map();
  let nextJobId = 0;
  const housekeeper = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : null;
    res.setHeader("content-type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "GET" && req.url === "/snapshot") {
      res.end(JSON.stringify({ hostId: "pty-test", queueDepth: 0, queuedCount: 0, runningCount: 0 }));
      return;
    }
    if (req.method === "GET" && req.url === "/queue") {
      res.end(JSON.stringify({ available: true, queueDepth: 0, queuedCount: 0, runningCount: 0 }));
      return;
    }
    if (req.method === "GET" && req.url === "/runtime/ollama/models") {
      res.end(JSON.stringify({ models: [{ name: firstModel }, { name: secondModel }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/submit") {
      const remoteJobId = `pty-saddle-job-${++nextJobId}`;
      const payload = body?.jobSpec?.payload ?? {};
      submissions.push(payload);
      jobs.set(remoteJobId, payload);
      res.end(JSON.stringify({ remoteJobId }));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/job/pty-saddle-job-")) {
      const remoteJobId = decodeURIComponent(req.url.slice("/job/".length));
      const payload = jobs.get(remoteJobId) ?? {};
      if (payload.model === secondModel && !Number(payload.options?.num_ctx)) {
        res.end(JSON.stringify({
          status: "failed",
          error: {
            message: "Ollama inference request failed: ollama request failed 400: {\"error\":\"request (66958 tokens) exceeds the available context size (32768 tokens), try increasing it\"}"
          }
        }));
        return;
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const hasToolResult = messages.some((message) => message?.role === "tool");
      let message;
      if (payload.model === firstModel) {
        message = { role: "assistant", content: "Qwen first model turn passed." };
      } else if (hasToolResult) {
        message = { role: "assistant", content: "Spark first turn passed after the Bash command returned its output." };
      } else {
        message = {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "pty-bash-command",
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: `printf '${bashMarker}\\n'` })
            }
          }]
        };
      }
      res.end(JSON.stringify({ status: "success", result: { message } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await new Promise((resolve) => housekeeper.listen(0, "127.0.0.1", resolve));
  const address = housekeeper.address();
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    PYA_SADDLE_CWD: projectRoot,
    PYA_SADDLE_SESSION_NAME: sessionName,
    PYA_SADDLE_MIND: "mind",
    PYA_SADDLE_MODEL: firstModel,
    PYA_SADDLE_HOST: "http://127.0.0.1:1",
    PYA_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${address.port}`,
    PYA_GPU_MANAGER_REQUIRED: "true",
    PYA_GPU_MANAGER_POLL_MS: "1",
    PYA_GPU_MANAGER_TIMEOUT_MS: "30000",
    PYA_OLLAMA_USAGE_DIR: usageDir,
    PYA_WORLD_ROOT: path.join(tempRoot, "gpu-world"),
    PYA_COMMAND_DEBUG: "true",
    PYA_NEWSPAPER: "false",
    PYA_NEWSPAPER_MIND_AUTO: "false"
  };
  for (const key of ["PYA_MIND_RESPONSE", "PYA_COMMAND_RESPONSE", "PYA_HEAR_FIXTURE", "PYA_PIPER_FIXTURE"]) {
    delete env[key];
  }
  const baseIdentityDir = path.join(projectWorldRoot, "house", "base", "identity");
  await fs.mkdir(baseIdentityDir, { recursive: true });
  await fs.copyFile(
    path.join(runtimeRoot, "world", "house", "base", "identity", "TOOLS.md"),
    path.join(baseIdentityDir, "TOOLS.md")
  );

  let transcript = "";
  let child = null;
  let childExit = null;
  let resolveChildExit;
  const exited = new Promise((resolve) => { resolveChildExit = resolve; });
  try {
    child = pty.spawn(process.execPath, [path.join(runtimeRoot, "command", "pyash.mjs"), "saddle"], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: projectRoot,
      env
    });
    child.onData((data) => { transcript += data; });
    child.onExit((event) => {
      childExit = event;
      resolveChildExit(event);
    });

    const restoredMarker = `session: ${sessionName} | restored 0 saved messages`;
    await waitForOutputAfter(() => transcript, restoredMarker, "pyash>", { timeoutMs: 90000 });
    child.write("first model check\r");
    await waitForOutputAfter(() => transcript, "Qwen first model turn passed.", "pyash>");

    child.write(`/model ${secondModel}\r`);
    const selectionMarker = `saved model selection for session: ${sessionName}`;
    await waitForOutputAfter(() => transcript, selectionMarker, "pyash>");
    child.write("hi\r");
    await waitForOutput(() => transcript, "Spark first turn passed after the Bash command returned its output.");

    const cleanTranscript = stripTerminalControlSequences(transcript);
    assert.match(cleanTranscript, new RegExp(`model: ${secondModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(cleanTranscript, /command defective: status=1|mind_ollama_runner: missing request payload|EPIPE/u);
    assert.ok(submissions.some((payload) => payload.model === firstModel), "the initial Ollama model must reach Housekeeper");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.content === "hi")),
      "the newly selected Ollama model must receive the first user turn");
    const secondModelSubmissions = submissions.filter((payload) => payload.model === secondModel);
    assert.ok(secondModelSubmissions.length > 0);
    assert.deepEqual(secondModelSubmissions[0].tools.map((tool) => tool.function?.name), ["bash"],
      "the selected model must receive exactly one Bash tool");
    const secondModelContext = secondModelSubmissions[0].messages.map((message) => String(message?.content ?? "")).join("\n");
    assert.match(secondModelContext, /Bash-only Saddle/u, "the agent-home tool guide must reach the model context");
    assert.match(secondModelContext, /pyash run --gross --no-newspaper/u,
      "the model context must include the documented Pyash web-search workflow");
    assert.ok(secondModelSubmissions.some((payload) => payload.messages?.some((message) => message?.role === "tool"
      && String(message.content).includes(bashMarker))),
    "the real command runner output must be returned to the selected model");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.options?.num_ctx === 131072),
      "the selected model must retry at the first supported context preset that fits the provider error");
    const commandDebugLines = cleanTranscript.match(/\[command debug\] \{[^\r\n]*\}/gu) ?? [];
    assert.ok(commandDebugLines.length >= 1, "PTY transcript should include a debug record for the Bash command");
    const commandDebug = commandDebugLines.map((line) => JSON.parse(line.slice("[command debug] ".length)));
    assert.ok(commandDebug.some((record) => record.cmd.includes(bashMarker) && record.status === 0
      && record.internalMindRunner === false), "Bash scenario must finish successfully through the command runner");
    assert.equal(childExit, null, "the saddle should remain open after both model turns");
  } finally {
    if (child && !childExit) {
      child.write("\u0004");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (!childExit) child.kill();
    }
    await new Promise((resolve) => housekeeper.close(resolve));
    await fs.rm(projectWorldRoot, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
