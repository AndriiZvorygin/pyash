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
      const output = stripTerminalControlSequences(getOutput()).replace(/\s+/gu, " ");
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
      const output = stripTerminalControlSequences(getOutput()).replace(/\s+/gu, " ");
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

function latestFrameRows(transcript) {
  const start = transcript.lastIndexOf("\u001b[?25l\u001b[H");
  if (start < 0) return [];
  const frame = transcript.slice(start);
  const end = frame.indexOf("\u001b[?25h");
  if (end < 0) return [];
  return frame.slice("\u001b[?25l\u001b[H".length, end)
    .split("\u001b[1B\r")
    .map((line) => stripTerminalControlSequences(line).replace(/\r/gu, ""));
}

function waitForVisibleFrame(getOutput, needle, { timeoutMs = 30000 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const rows = latestFrameRows(getOutput());
      const screen = rows.join("\n");
      if (screen.replace(/\s+/gu, " ").includes(needle.replace(/\s+/gu, " "))) {
        resolve({ rows, screen });
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`timed out waiting for visible screen text ${JSON.stringify(needle)}\n${screen.slice(-6000)}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

test("saddle CLI shows an unsent Unicode draft, renders a wide-character response, and switches models in a PTY", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-saddle-pty-"));
  const projectRoot = path.join(tempRoot, "project");
  const projectWorldRoot = resolveSaddleProjectWorldRoot({ runtimeRoot, cwd: projectRoot });
  const usageDir = path.join(tempRoot, "usage");
  const sessionName = `pty-model-switch-${process.pid}-${Date.now()}`;
  const runnerPath = path.relative(projectRoot, path.join(runtimeRoot, "command", "mind_ollama_runner.mjs"));
  const internalRunnerCommand = `PYA_COMMAND_TIMEOUT_MS=900000 node ${runnerPath.split(path.sep).join("/")}`;
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
        message = {
          role: "assistant",
          content: `Qwen first model turn passed. ${"1".repeat(51)} 安德里 okay. The name and the practice are the same statement.`
        };
      } else if (hasToolResult) {
        message = { role: "assistant", content: "Spark first turn passed after the internal runner call was blocked." };
      } else {
        message = {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "pty-internal-runner-attempt",
            type: "function",
            function: {
              name: "be_command_ob_text_to_name_text",
              arguments: JSON.stringify({ ob: internalRunnerCommand })
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

  let transcript = "";
  let child = null;
  let childExit = null;
  let resolveChildExit;
  const exited = new Promise((resolve) => { resolveChildExit = resolve; });
  try {
    child = pty.spawn(process.execPath, [path.join(runtimeRoot, "command", "pyash.mjs"), "saddle"], {
      name: "xterm-256color",
      cols: 58,
      rows: 40,
      cwd: projectRoot,
      env
    });
    child.onData((data) => { transcript += data; });
    child.onExit((event) => {
      childExit = event;
      resolveChildExit(event);
    });

    await waitForOutput(() => transcript, "restored 0 saved messages", { timeoutMs: 90000 });
    await waitForVisibleFrame(() => transcript, "pyash>", { timeoutMs: 90000 });
    const draft = `typed ${"x".repeat(42)} 安德里`;
    child.write(draft);
    const draftScreen = await waitForVisibleFrame(() => transcript, `pyash> ${draft}`);
    assert.equal(submissions.length, 0, "typing a draft must not send a model request before Enter");
    assert.ok(draftScreen.rows.some((line) => line.includes("pyash> ")), "the unsent draft must be visible in the prompt row");
    child.write("\r");
    await waitForOutputAfter(() => transcript, "Qwen first model turn passed.", "pyash>");
    const responseScreen = await waitForVisibleFrame(() => transcript, "The name and the practice are the same statement.");
    const normalizedResponse = responseScreen.screen.replace(/[ \t\n]+/gu, " ");
    assert.ok(normalizedResponse.includes(draft), "the submitted prompt must remain visible in the transcript");
    assert.match(normalizedResponse, /安德里 okay/u, "the response must preserve wide characters and neighboring words");
    assert.equal((normalizedResponse.match(/same statement\./gu) ?? []).length, 1,
      "the PTY screen must render the final response once, without duplicated chunks");
    assert.ok(submissions.some((payload) => payload.model === firstModel
      && payload.messages?.some((message) => message?.role === "user" && message.content === draft)),
    "Enter must submit exactly the visible draft");

    child.write(`/model ${secondModel}\r`);
    await waitForOutput(() => transcript, "saved model selection for session");
    await waitForVisibleFrame(() => transcript, "pyash>");
    child.write("hi\r");
    await waitForOutput(() => transcript, "Spark first turn passed after the internal runner call was blocked.");

    const cleanTranscript = stripTerminalControlSequences(transcript);
    assert.match(cleanTranscript, new RegExp(`model: ${secondModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(cleanTranscript, /command defective: status=1|mind_ollama_runner: missing request payload|EPIPE/u);
    assert.ok(submissions.some((payload) => payload.model === firstModel), "the initial Ollama model must reach Housekeeper");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.messages?.some((message) => message?.content === "hi")),
      "the newly selected Ollama model must receive the first user turn");
    assert.ok(submissions.some((payload) => payload.model === secondModel
      && payload.messages?.some((message) => message?.role === "tool"
        && String(message.content).includes("internal adapters, not shell entry points"))),
    "the CLI must pass the blocked runner attempt result back to the selected model");
    assert.ok(submissions.some((payload) => payload.model === secondModel && payload.options?.num_ctx === 131072),
      "the selected model must retry at the first supported context preset that fits the provider error");
    const commandDebugLines = cleanTranscript.match(/\[command debug\] \{[^\r\n]*\}/gu) ?? [];
    assert.ok(commandDebugLines.length >= 3, "PTY transcript should include debug records for backend runner commands");
    const commandDebug = commandDebugLines.map((line) => JSON.parse(line.slice("[command debug] ".length)));
    assert.ok(commandDebug.some((record) => record.internalMindRunner === true && record.stdinInputBytes > 0),
      "backend runner command must receive its structured stdin payload");
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
