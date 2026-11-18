import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueInputEnvelope, queueDepth } from "../program/runtime/gpu/queue.mjs";
import { readGpuHandleStatus, writeGpuHandleStatus } from "../program/runtime/gpu/handle_status.mjs";
import { runGpuWorkerOnce } from "../program/runtime/gpu/worker.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { doRemember, forget, remember } from "../program/remember/index.mjs";
import { configureSaddleSelection, prepareSaddleContextForTurn, runSaddleTurn } from "../command/pyash_saddle.mjs";

function runWithStdin(script, payload, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", code => resolve({ code, stdout, stderr }));
    proc.stdin.end(payload);
  });
}

test("mind ollama runner reads stdin payload when spawned as child process", async () => {
  const payload = JSON.stringify({
    mode: "generate",
    model: "qwen3.5:9b",
    prompt: "hello",
    keep_alive: 0,
    host: "http://127.0.0.1:1"
  });
  const res = await runWithStdin("command/mind_ollama_runner.mjs", payload);
  assert.equal(/missing request payload/i.test(res.stderr), false);
});

test("switching Ollama models from a project cwd resolves the runner and completes the first turn", async () => {
  const previousModel = "qwen3.5:9b";
  const selectedModel = "SparkLLM/Spark-X2.6-4B:q4_k_m";
  const directRunnerPrompt = "runner path from external project cwd";
  const modelSwitchSystemPrompt = `Coding saddle model-switch scenario\n${"large-context ".repeat(25000)}`;
  const calls = [];
  const jobs = new Map();
  let nextJobId = 0;
  const manager = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    calls.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/submit") {
      const remoteJobId = `ceremony-runner-job-${++nextJobId}`;
      jobs.set(remoteJobId, calls.at(-1).body.jobSpec.payload);
      res.end(JSON.stringify({ remoteJobId }));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/job/ceremony-runner-job-")) {
      const remoteJobId = req.url.slice("/job/".length);
      const payload = jobs.get(remoteJobId);
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const text = messages.map((message) => String(message?.content ?? "")).join("\n");
      let message = { role: "assistant", content: "ceremony model reply" };
      if (text.includes("Create a compact continuity note")) {
        message = { role: "assistant", content: "Compacted scenario history." };
      } else if (text.includes(directRunnerPrompt)) {
        message = { role: "assistant", content: "External project runner path verified." };
      } else if (messages.some((entry) => entry?.role === "tool")) {
        message = { role: "assistant", content: "I answered directly after the internal runner request was blocked." };
      } else if (messages.some((entry) => entry?.role === "user" && entry?.content === "what do you think?")) {
        message = {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "selected-model-runner-attempt",
            type: "function",
            function: {
              name: "be_command_ob_text_to_name_text",
              arguments: JSON.stringify({ ob: "PYA_COMMAND_TIMEOUT_MS=900000 node ../../pyac/pyash/command/mind_ollama_runner.mjs" })
            }
          }]
        };
      }
      res.end(JSON.stringify({
        status: "success",
        result: { message }
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => manager.listen(0, "127.0.0.1", resolve));
  const address = manager.address();
  const usageDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ollama-ceremony-usage-"));
  const agentHouse = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ollama-ceremony-house-"));
  const worldRoot = path.join(usageDir, "world");
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ollama-saddle-project-"));
  const envKeys = ["PYA_COMMAND_RESPONSE", "PYA_GPU_MANAGER_REQUIRED", "PYA_GPU_HOUSEKEEPER_URL", "PYA_GPU_MANAGER_POLL_MS", "PYA_OLLAMA_USAGE_DIR", "PYA_WORLD_ROOT"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.PYA_GPU_MANAGER_REQUIRED = "true";
  process.env.PYA_GPU_HOUSEKEEPER_URL = `http://127.0.0.1:${address.port}`;
  process.env.PYA_GPU_MANAGER_POLL_MS = "1";
  process.env.PYA_OLLAMA_USAGE_DIR = usageDir;
  process.env.PYA_WORLD_ROOT = worldRoot;
  delete process.env.PYA_COMMAND_RESPONSE;
  forget();
  doRemember({ mood: "ya", su: { name: "run root" }, be: "default", ob: { filename: process.cwd() } });
  doRemember({ mood: "ya", su: { name: "world root" }, be: "root", ob: { filename: worldRoot } });
  doRemember({ mood: "ya", su: { name: "agent cwd" }, be: "cwd", ob: { filename: projectRoot } });
  doRemember({ mood: "ya", su: { name: "agent sandbox" }, be: "truth", ob: { boolean: true } });
  doRemember({ mood: "ya", su: { name: "agent name" }, be: "text", ob: { text: "coding saddle" } });

  try {
    await interpret(parse('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do'));
    await interpret(parse('from filename "./module/saddle_tools.pya" ob name saddle tools to name saddle tools be import do'));
    await interpret(parse(`exists su name coding saddle be mind as name "${previousModel}" ya`));
    configureSaddleSelection({
      cwd: projectRoot,
      runtimeRoot: process.cwd(),
      worldRoot,
      model: previousModel,
      backend: "ollama",
      host: "http://127.0.0.1:1",
      systemPrompt: modelSwitchSystemPrompt
    }, { model: selectedModel });
    assert.equal(path.resolve(remember("run root")?.ob?.filename ?? ""), process.cwd());
    const runnerResult = await interpret({
      mood: "do",
      be: "command",
      ob: { text: "PYA_COMMAND_TIMEOUT_MS=900000 node ./command/mind_ollama_runner.mjs" },
      fromtext: { text: JSON.stringify({
        mode: "chat",
        model: selectedModel,
        host: "http://127.0.0.1:1",
        messages: [{ role: "user", content: directRunnerPrompt }]
      }) }
    });
    assert.equal(JSON.parse(runnerResult?.ob?.text ?? "{}").message?.content, "External project runner path verified.");
    const directRunnerSubmission = calls.find((call) => call.method === "POST" && call.path === "/submit"
      && call.body.jobSpec?.payload?.messages?.[0]?.content?.startsWith("runner path from external project cwd"));
    assert.equal(directRunnerSubmission?.body?.jobSpec?.payload?.messages?.[0]?.content?.length, directRunnerPrompt.length);

    const sessionName = `stdin-scenario-${process.pid}-${Date.now()}`;
    const context = await prepareSaddleContextForTurn({
      agentHouse,
      sessionName,
      backend: "ollama",
      model: selectedModel,
      host: "http://127.0.0.1:1",
      contextWindow: 100,
      systemPrompt: "Coding saddle scenario",
      userInput: `first request after switching to ${selectedModel}`,
      housekeeperUrl: `http://127.0.0.1:${address.port}`,
      loadHistory: async () => ({
        messages: Array.from({ length: 24 }, (_, index) => ({
          role: index % 2 ? "assistant" : "user",
          content: `older conversation detail ${index} ` + "confirmed model-switch scenario fact ".repeat(3)
        }))
      })
    });
    assert.equal(context.compacted, true);

    const turnEvents = [];
    const result = await runSaddleTurn({
      input: "what do you think?",
      model: selectedModel,
      backend: "ollama",
      host: "http://127.0.0.1:1",
      housekeeperUrl: `http://127.0.0.1:${address.port}`,
      sessionContextSummary: context.summary,
      historyWindow: context.historyWindow,
      sessionName,
      onToolCall: async (event) => turnEvents.push(event)
    });

    assert.equal(result?.ob?.text, "I answered directly after the internal runner request was blocked.", JSON.stringify(result));
    assert.match(turnEvents.find((event) => event.stage === "result")?.toolText ?? "", /internal adapters, not shell entry points/u);
    const submissions = calls.filter((call) => call.method === "POST" && call.path === "/submit"
      && call.body.jobSpec?.payload?.model === selectedModel);
    const compactedHistory = submissions.find((call) => JSON.stringify(call.body.jobSpec.payload).includes("Create a compact continuity note"));
    const selectedModelTurn = submissions.find((call) => JSON.stringify(call.body.jobSpec.payload).includes("what do you think?"));
    assert.ok(compactedHistory, "compaction should call the newly selected model with old history");
    assert.ok(JSON.stringify(compactedHistory.body.jobSpec.payload).includes("older conversation detail"));
    assert.ok(selectedModelTurn, "the first turn should also reach the newly selected model");
    assert.ok(selectedModelTurn.body.jobSpec.payload.messages.some((message) =>
      message?.role === "system" && message.content.includes(modelSwitchSystemPrompt)),
    "the model-switch request must preserve the complete large stdin payload");
  } finally {
    forget();
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    await new Promise((resolve) => manager.close(resolve));
    await fs.rm(usageDir, { recursive: true, force: true });
    await fs.rm(agentHouse, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("mind openai runner reads stdin payload when spawned as child process", async () => {
  const payload = JSON.stringify({
    mode: "generate",
    model: "gpt-test",
    prompt: "hello",
    host: "http://127.0.0.1:1"
  });
  const res = await runWithStdin("command/mind_openai_runner.mjs", payload, {
    OPENAI_API_KEY: "test-key"
  });
  assert.equal(/missing request payload/i.test(res.stderr), false);
});

async function waitForQueuedGpuJob(worldRoot) {
  const deadline = Date.now() + 5000;
  while (Date.now() <= deadline) {
    const depth = await queueDepth(worldRoot);
    if (depth.input > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for queued gpu job");
}

async function waitForQueueDepth(worldRoot, expected) {
  const deadline = Date.now() + 5000;
  while (Date.now() <= deadline) {
    const depth = await queueDepth(worldRoot);
    if (depth.total >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for gpu queue depth ${expected}`);
}

test("mind ollama runner enqueues non-streaming payload when GPU queue mode is enabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mind-runner-gpu-"));
  const worldRoot = path.join(root, "world");
  const payload = JSON.stringify({
    mode: "generate",
    model: "qwen-test",
    prompt: "hello",
    worldRoot
  });

  const proc = spawn(process.execPath, ["command/mind_ollama_runner.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYA_GPU_MIND_QUEUE: "truth",
      PYA_GPU_MIND_TIMEOUT_MS: "10000",
      PYA_WORLD_ROOT: worldRoot
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
  proc.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  proc.stdin.end(payload);

  await waitForQueuedGpuJob(worldRoot);
  const worker = await runGpuWorkerOnce({
    worldRoot,
    pollIntervalMs: 1,
    maxPolls: 5,
    adapter: {
      async submitJob(args) {
        assert.equal(args.runtimeName, "ollama");
        assert.equal(args.profileName, "qwen-test");
        assert.equal(args.jobSpec.kind, "ollama-generate");
        return { remoteJobId: "remote-runner" };
      },
      async getJobStatus() {
        return {
          status: "success",
          message: "completed",
          result: { response: "queued hello" },
          finishedAt: "2026-03-10T10:02:00.000Z"
        };
      }
    }
  });
  assert.equal(worker.handled, 1);

  const closed = await new Promise((resolve) => {
    proc.on("close", code => resolve(code));
  });
  assert.equal(closed, 0, stderr);
  assert.deepEqual(JSON.parse(stdout.trim()), { response: "queued hello" });
});

test("manager-required mind calls submit to the GPU Housekeeper without contacting Ollama directly", async () => {
  const calls = [];
  const manager = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    calls.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/submit") {
      res.end(JSON.stringify({ remoteJobId: "web-chat-job" }));
      return;
    }
    if (req.method === "GET" && req.url === "/job/web-chat-job") {
      res.end(JSON.stringify({ status: "success", result: { message: { role: "assistant", content: "managed reply" } } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => manager.listen(0, "127.0.0.1", resolve));
  const address = manager.address();
  const usageDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-managed-usage-"));
  try {
    const payload = JSON.stringify({
      mode: "chat",
      model: "qwen3.5:9b",
      host: "http://127.0.0.1:1",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "be_search" } }]
    });
    const result = await runWithStdin("command/mind_ollama_runner.mjs", payload, {
      PYA_GPU_MANAGER_REQUIRED: "true",
      PYA_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${address.port}`,
      PYA_GPU_MANAGER_POLL_MS: "1",
      PYA_OLLAMA_USAGE_DIR: usageDir
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { message: { role: "assistant", content: "managed reply" } });
    assert.deepEqual(calls.map(({ method, path: requestPath }) => `${method} ${requestPath}`), [
      "POST /submit",
      "GET /job/web-chat-job"
    ]);
    assert.equal(calls[0].body.runtimeName, "ollama");
    assert.equal(calls[0].body.profileName, "qwen3.5:9b");
    assert.equal(calls[0].body.jobSpec.kind, "ollama-chat");
    assert.equal(calls[0].body.jobSpec.payload.tools[0].function.name, "be_search");
    assert.equal(calls[0].body.jobSpec.payload.model, "qwen3.5:9b");
  } finally {
    await new Promise((resolve) => manager.close(resolve));
    await fs.rm(usageDir, { recursive: true, force: true });
  }
});

test("manager-required Ollama retries a reported context overflow at a fitting request window", async () => {
  const calls = [];
  let nextJobId = 0;
  const manager = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = bodyText ? JSON.parse(bodyText) : null;
    calls.push({ method: req.method, path: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/submit") {
      res.end(JSON.stringify({ remoteJobId: `context-retry-job-${++nextJobId}` }));
      return;
    }
    if (req.method === "GET" && req.url === "/job/context-retry-job-1") {
      res.end(JSON.stringify({
        status: "failed",
        error: {
          message: "Ollama inference request failed: ollama request failed 400: {\"error\":\"request (66958 tokens) exceeds the available context size (32768 tokens), try increasing it\"}"
        }
      }));
      return;
    }
    if (req.method === "GET" && req.url === "/job/context-retry-job-2") {
      res.end(JSON.stringify({
        status: "success",
        result: { message: { role: "assistant", content: "context retry succeeded" } }
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => manager.listen(0, "127.0.0.1", resolve));
  const address = manager.address();
  const usageDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-context-retry-usage-"));
  try {
    const payload = JSON.stringify({
      mode: "chat",
      model: "SparkLLM/Spark-X2.6-4B:q4_k_m",
      host: "http://127.0.0.1:1",
      messages: [{ role: "user", content: "first request after switching models" }]
    });
    const result = await runWithStdin("command/mind_ollama_runner.mjs", payload, {
      PYA_GPU_MANAGER_REQUIRED: "true",
      PYA_GPU_HOUSEKEEPER_URL: `http://127.0.0.1:${address.port}`,
      PYA_GPU_MANAGER_POLL_MS: "1",
      PYA_GPU_MANAGER_TIMEOUT_MS: "5000",
      PYA_OLLAMA_USAGE_DIR: usageDir
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      message: { role: "assistant", content: "context retry succeeded" }
    });
    const submissions = calls.filter((call) => call.method === "POST" && call.path === "/submit");
    assert.equal(submissions.length, 2);
    assert.equal(submissions[0].body.jobSpec.payload.options?.num_ctx, undefined);
    assert.equal(submissions[1].body.jobSpec.payload.options.num_ctx, 131072);
  } finally {
    await new Promise((resolve) => manager.close(resolve));
    await fs.rm(usageDir, { recursive: true, force: true });
  }
});

test("manager-required streaming fails closed instead of bypassing the GPU Housekeeper", async () => {
  const usageDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-managed-stream-usage-"));
  const result = await runWithStdin("command/mind_ollama_runner.mjs", JSON.stringify({
    mode: "chat",
    model: "qwen3.5:9b",
    stream: true,
    host: "http://127.0.0.1:1",
    messages: [{ role: "user", content: "hello" }]
  }), {
    PYA_GPU_MANAGER_REQUIRED: "true",
    PYA_GPU_HOUSEKEEPER_URL: "http://127.0.0.1:1",
    PYA_OLLAMA_USAGE_DIR: usageDir
  });
  try {
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /streaming cannot bypass the required GPU Housekeeper queue/u);
  } finally {
    await fs.rm(usageDir, { recursive: true, force: true });
  }
});

test("mind ollama queued wait scales to requests already ahead in the durable queue", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mind-runner-gpu-backlog-"));
  const worldRoot = path.join(root, "world");
  for (let index = 0; index < 3; index += 1) {
    await enqueueInputEnvelope(worldRoot, {
      queuedAt: `2026-03-10T10:00:0${index}.000Z`,
      handleId: `backlog-${index}`,
      agentName: "mind-ollama-runner",
      gpuId: "gpu-0",
      intent: "mind",
      lane: "durable",
      payloadSentence: { mood: "do", be: "gpu mind", ob: { text: "earlier queued request" } },
      serviceName: "ollama",
      residencyName: "qwen-test",
      residencyRequired: true,
      beginRequired: true,
      dischargeAllowed: true,
      jobSpec: {
        kind: "ollama-generate",
        payload: { mode: "generate", model: "qwen-test", prompt: "earlier queued request" }
      }
    });
  }

  const payload = JSON.stringify({ mode: "generate", model: "qwen-test", prompt: "behind backlog", worldRoot });
  const proc = spawn(process.execPath, ["command/mind_ollama_runner.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYA_GPU_MIND_QUEUE: "truth",
      PYA_COMMAND_TIMEOUT_MS: "50",
      PYA_GPU_MIND_TIMEOUT_MS: "",
      PYA_WORLD_ROOT: worldRoot
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let closedCode = null;
  proc.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
  proc.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  proc.on("close", code => { closedCode = code; });
  proc.stdin.end(payload);

  await waitForQueueDepth(worldRoot, 4);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(closedCode, null, stderr);

  const handleFiles = await fs.readdir(path.join(worldRoot, "holding", "gpu", "artifacts", "handle"));
  const handleIds = await Promise.all(handleFiles.map(async filename => {
    const text = await fs.readFile(path.join(worldRoot, "holding", "gpu", "artifacts", "handle", filename), "utf8");
    return text.match(/su name handle id ob text "([^"]+)" ya/u)?.[1] ?? "";
  }));
  const handleId = handleIds.find(id => id && !id.startsWith("backlog-"));
  assert.ok(handleId, "runner should have recorded its queued handle id");
  await writeGpuHandleStatus(worldRoot, handleId, {
    status: "success",
    outcome: "success",
    message: "completed",
    result: JSON.stringify({ response: "waited behind backlog" }),
    error: ""
  });

  const code = await new Promise(resolve => proc.once("close", resolve));
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout.trim()), { response: "waited behind backlog" });
  assert.equal((await readGpuHandleStatus(worldRoot, handleId))?.status, "success");
});
