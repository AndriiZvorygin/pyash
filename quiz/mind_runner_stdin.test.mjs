import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueInputEnvelope, queueDepth } from "../program/runtime/gpu/queue.mjs";
import { readGpuHandleStatus, writeGpuHandleStatus } from "../program/runtime/gpu/handle_status.mjs";
import { runGpuWorkerOnce } from "../program/runtime/gpu/worker.mjs";

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
