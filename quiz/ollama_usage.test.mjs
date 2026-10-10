import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildOllamaUsageRecord,
  listOllamaUsageRecords,
  sha256Text,
  summarizeOllamaUsage,
  writeOllamaUsageRecord
} from "../program/library/ollama_usage.mjs";

function runRunner(payload, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["command/mind_ollama_runner.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test("Ollama usage records are immutable PYA artifacts and aggregate by model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ollama-usage-"));
  const first = buildOllamaUsageRecord({
    callId: "call-one",
    runId: "usage-test",
    payload: { model: "qwen-test", mode: "generate", stream: false },
    endpoint: "http://user:secret@127.0.0.1:11434/api/generate",
    response: { model: "qwen-test", prompt_eval_count: 12, eval_count: 5, total_duration: 100 },
    requestHash: sha256Text("request-one"),
    responseHash: sha256Text("response-one"),
    startedAt: "2026-10-10T20:00:00.000Z",
    finishedAt: "2026-10-10T20:00:00.100Z",
    elapsedMs: 100
  });
  const second = buildOllamaUsageRecord({
    callId: "call-two",
    runId: "usage-test",
    payload: { model: "qwen-test", mode: "chat", stream: false },
    response: { model: "qwen-test", prompt_eval_count: 3, eval_count: 7, total_duration: 200 },
    status: "failed",
    failureKind: "transport",
    error: "connection reset"
  });
  const firstPath = await writeOllamaUsageRecord({ record: first, usageDir: root });
  const secondPath = await writeOllamaUsageRecord({ record: second, usageDir: root });
  assert.match(firstPath, /\.pya$/u);
  assert.match(secondPath, /\.pya$/u);
  assert.equal((await fs.readdir(root)).length, 2);

  const records = await listOllamaUsageRecords(root);
  assert.equal(records.length, 2);
  assert.equal(records[0].ollama_host, "http://127.0.0.1:11434");
  assert.equal(records[0].endpoint, "http://127.0.0.1:11434/api/generate");
  assert.equal(records[0].prompt_eval_count, 12);
  assert.equal(records[1].status, "failed");
  assert.equal(records[1].error, "connection reset");

  const summary = summarizeOllamaUsage(records);
  assert.deepEqual(summary.record_count, 2);
  assert.deepEqual(summary.completed_count, 1);
  assert.deepEqual(summary.failed_count, 1);
  assert.deepEqual(summary.prompt_eval_count, 15);
  assert.deepEqual(summary.eval_count, 12);
  assert.equal(summary.models[0].model, "qwen-test");
  assert.equal(summary.models[0].calls, 2);
});

test("streaming Ollama final metadata is preserved in the PYA usage ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ollama-stream-usage-"));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.write(`${JSON.stringify({ model: "qwen-test", response: "hello ", done: false })}\n`);
    response.end(`${JSON.stringify({
      model: "qwen-test",
      response: "world",
      done: true,
      done_reason: "stop",
      prompt_eval_count: 9,
      eval_count: 4,
      prompt_eval_duration: 10,
      eval_duration: 20,
      total_duration: 30
    })}\n`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const result = await runRunner({
    mode: "generate",
    model: "qwen-test",
    prompt: "hello",
    host: `http://127.0.0.1:${address.port}`,
    stream: true
  }, { PYA_OLLAMA_USAGE_DIR: root });
  await new Promise(resolve => server.close(resolve));

  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
  assert.deepEqual(lines.map(line => line.type), ["chunk", "chunk", "terminal"]);
  assert.equal(lines[2].envelope.response, "hello world");

  const records = await listOllamaUsageRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "completed");
  assert.equal(records[0].stream, true);
  assert.equal(records[0].eval_count, 4);
  assert.equal(records[0].prompt_eval_count, 9);
  assert.equal(records[0].total_duration, 30);
  assert.equal(records[0].response_sha256.length, 64);
});
