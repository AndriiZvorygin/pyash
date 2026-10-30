import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  MIND_BACKEND_CHOICES,
  canonicalizeMindBackend,
  defaultMindHostForSource,
  defaultMindModelForSource
} from "../command/pyash/mind_backend_helpers.mjs";
import { normalizeMindBackendName } from "../program/verbs/mind/backend.mjs";
import {
  discoverSaddleModels,
  normalizeSaddleBackend,
  normalizeSaddleThinkSelection,
  resolveSaddleMindProfile
} from "../program/agent/coding_saddle.mjs";
import { fetchMiniMaxModels, resolveMiniMaxApiKey } from "../program/runtime/minimax.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "command/mind_openai_runner.mjs");

async function startServer(respond) {
  const calls = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      calls.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8")
      });
      respond(request, response);
    });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const address = server.address();
  return {
    calls,
    host: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function runRunner(args, payload, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, ...args], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test("MiniMax is selectable without changing Pyash's Ollama default", () => {
  assert.equal(MIND_BACKEND_CHOICES[0].key, "ollama");
  assert.equal(canonicalizeMindBackend("minimax"), "minimax command mind");
  assert.equal(normalizeMindBackendName("minimax"), "minimax command mind");
  assert.equal(normalizeSaddleBackend("minimax command mind"), "minimax");
  assert.equal(defaultMindHostForSource("minimax"), "https://api.minimax.io/v1");
  assert.equal(defaultMindModelForSource("minimax"), "MiniMax-M3.1-Flash");
  assert.deepEqual(normalizeSaddleThinkSelection("xhigh", "minimax"), {
    value: "xhigh", think: null, reasoningEffort: "xhigh"
  });
  assert.equal(normalizeSaddleThinkSelection("off", "minimax"), null);
  assert.ok(MIND_BACKEND_CHOICES.some((choice) => choice.key === "minimax"));
  assert.deepEqual(resolveSaddleMindProfile({
    mindName: "minimax",
    profile: {
      be: "mind",
      fromstate: { text: "minimax" },
      from: { text: "https://api.minimax.io/v1" },
      as: { text: "MiniMax-M3.1-Flash" }
    }
  }), {
    mindName: "minimax",
    backend: "minimax",
    host: "https://api.minimax.io/v1",
    model: "MiniMax-M3.1-Flash"
  });
});

test("default configuration imports MiniMax but keeps Ollama globally selected", async () => {
  const source = await readFile(path.join(root, "configure/default.pya"), "utf8");
  assert.match(source, /exists su name mind backend be default ob name ollama command mind ya/);
  assert.match(source, /module\/mind_minimax\.pya.*minimax command mind be import do/);
  assert.match(source, /exists su name minimax be mind from state "minimax" from space "https:\/\/api\.minimax\.io\/v1" via state "MiniMax-M3\.1-Flash" ya/);
});

test("MiniMax API key resolves from environment or Pyash secret fact", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-minimax-secret-"));
  const secretPath = path.join(tempDir, "secret.pya");
  try {
    await fs.writeFile(secretPath, 'exists su name minimax api key ob text "pya-secret-key" be default ya\n');
    assert.equal(resolveMiniMaxApiKey({ env: { MINIMAX_API_KEY: "env-key" }, secretFilePath: secretPath }), "env-key");
    assert.equal(resolveMiniMaxApiKey({ env: {}, secretFilePath: secretPath }), "pya-secret-key");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("MiniMax model discovery uses the authenticated OpenAI-compatible models endpoint", async () => {
  const calls = [];
  const result = await fetchMiniMaxModels({
    host: "https://api.minimax.io/v1",
    apiKey: "fixture-key",
    fetchFn: async (url, options) => {
      calls.push({ url, authorization: options.headers.authorization });
      return { ok: true, async json() { return { data: [{ id: "MiniMax-M3.1-Flash" }, { id: "MiniMax-M3" }] }; } };
    }
  });
  assert.deepEqual(calls, [{
    url: "https://api.minimax.io/v1/models",
    authorization: "Bearer fixture-key"
  }]);
  assert.deepEqual(result, { ok: true, models: ["MiniMax-M3.1-Flash", "MiniMax-M3"] });
});

test("coding saddle discovers MiniMax models using its secret-backed provider catalog", async () => {
  const result = await discoverSaddleModels({
    backend: "minimax",
    host: "https://api.minimax.io/v1",
    currentModel: "MiniMax-M3.1-Flash",
    apiKey: "fixture-key",
    fetchFn: async (url, options) => {
      assert.equal(url, "https://api.minimax.io/v1/models");
      assert.equal(options.headers.authorization, "Bearer fixture-key");
      return { ok: true, async json() { return { data: [{ id: "MiniMax-M3.1-Flash" }, { id: "MiniMax-M3" }] }; } };
    }
  });
  assert.deepEqual(result.models, ["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  assert.deepEqual(result.catalogModels, ["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  assert.equal(result.available, true);
});

test("MiniMax runner posts to /v1/chat/completions and preserves reasoning tool history", async () => {
  const api = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: {
        role: "assistant",
        content: "Tool result considered.",
        reasoning_content: "I checked the tool result.",
        tool_calls: [{ id: "call-1", type: "function", function: { name: "inspect", arguments: "{}" } }]
      } }]
    }));
  });
  try {
    const result = await runRunner(["--minimax"], {
      host: api.host,
      model: "MiniMax-M3.1-Flash",
      reasoningEffort: "high",
      messages: [
        { role: "user", content: "Inspect this." },
        {
          role: "assistant",
          content: "Checking now.",
          reasoning_content: "I should inspect the input.",
          tool_calls: [{ id: "prior-call", type: "function", function: { name: "inspect", arguments: "{}" } }]
        },
        { role: "tool", tool_call_id: "prior-call", content: "Observed a fixture." }
      ],
      tools: [{ type: "function", function: { name: "inspect", parameters: { type: "object", properties: {} } } }]
    }, { ...process.env, MINIMAX_API_KEY: "fixture-key", PYA_COMMAND_RESPONSE: "" });

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.response, "Tool result considered.");
    assert.equal(output.message.reasoning_content, "I checked the tool result.");
    assert.equal(output.message.tool_calls[0].function.name, "inspect");
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].path, "/v1/chat/completions");
    assert.equal(api.calls[0].authorization, "Bearer fixture-key");
    const body = JSON.parse(api.calls[0].body);
    assert.equal(body.model, "MiniMax-M3.1-Flash");
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.tools[0].function.name, "inspect");
    assert.equal(body.messages[1].reasoning_content, "I should inspect the input.");
    assert.equal(body.messages[1].tool_calls[0].id, "prior-call");
    assert.equal(body.messages[2].tool_call_id, "prior-call");
  } finally {
    await api.close();
  }
});

test("MiniMax runner supports streaming responses", async () => {
  const api = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"MiniMax "}}]}\n\ndata: {"choices":[{"delta":{"content":"stream"}}]}\n\ndata: [DONE]\n\n');
  });
  try {
    const result = await runRunner(["--minimax", "--stream"], {
      host: api.host,
      model: "MiniMax-M3.1-Flash",
      messages: [{ role: "user", content: "Say hello" }]
    }, { ...process.env, MINIMAX_API_KEY: "fixture-key", PYA_COMMAND_RESPONSE: "" });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"MiniMax "/);
    assert.match(result.stdout, /"stream"/);
    assert.match(result.stdout, /\[STREAM_END\]/);
    assert.equal(JSON.parse(api.calls[0].body).stream, true);
  } finally {
    await api.close();
  }
});
