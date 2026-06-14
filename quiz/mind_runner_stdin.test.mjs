import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { queueDepth } from "../program/runtime/gpu/queue.mjs";
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
