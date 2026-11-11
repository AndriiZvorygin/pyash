import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "command/mind_openai_runner.mjs");
const zaiMind = path.join(root, "module/mind_zai.pya");

test("Z.AI Pyash mind routes streamed calls through the direct Coding Plan runner", async () => {
  const source = await fs.readFile(zaiMind, "utf8");
  assert.match(source, /mind_openai_runner\.mjs --zai-coding"/u);
  assert.match(source, /mind_openai_runner\.mjs --zai-coding --stream"/u);
  assert.doesNotMatch(source, /--zai-codex/u);
});

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

test("Z.AI Coding Plan uses its Chat Completions endpoint and streams assistant/tool deltas", async () => {
  let requestBody;
  let authorization;
  let requestPath;
  const server = http.createServer((request, response) => {
    requestPath = request.url;
    authorization = request.headers.authorization;
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"reasoning_content":"Inspecting the request. "}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"The result is "}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"ready."}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"be_command","arguments":"{\\"cmd\\":"}}]}}]}\n\n');
      response.end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"pwd\\"}"}}]}}],"usage":{"prompt_tokens":21,"completion_tokens":7,"total_tokens":28}}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const result = await runRunner(["--zai-coding", "--stream"], {
      model: "glm-5.3-flash",
      host: `http://127.0.0.1:${port}/api/coding/paas/v4`,
      toolMapName: "saddle tools",
      tools: [{ type: "function", function: { name: "be_command", parameters: { type: "object", properties: { cmd: { type: "string" } } } } }],
      messages: [{ role: "user", content: "Inspect and report." }]
    }, {
      ...process.env,
      PYA_COMMAND_RESPONSE: "",
      Z_AI_CODING_API_KEY: "test-only-coding-key"
    });
    assert.equal(result.code, 0, result.stderr);
    const records = result.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    assert.deepEqual(records.filter((record) => record.type === "chunk").map((record) => record.text), ["The result is ", "ready."]);
    const terminal = records.at(-1);
    assert.equal(terminal.type, "terminal");
    assert.equal(terminal.envelope.message.content, "The result is ready.");
    assert.equal(terminal.envelope.message.reasoning_content, "Inspecting the request. ");
    assert.equal(terminal.envelope.message.tool_calls[0].function.arguments, '{"cmd":"pwd"}');
    assert.equal(terminal.envelope.usage.total_tokens, 28);
    assert.equal(requestPath, "/api/coding/paas/v4/chat/completions");
    assert.equal(authorization, "Bearer test-only-coding-key");
    assert.equal(requestBody.stream, true);
    assert.equal(requestBody.tool_stream, true);
    assert.equal(requestBody.model, "glm-5.3-flash");
    assert.equal(result.stdout.includes("test-only-coding-key"), false);
    assert.equal(result.stderr.includes("test-only-coding-key"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Z.AI Coding Plan streams provider failures as terminal error records", async () => {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "temporary provider outage" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const result = await runRunner(["--zai-coding", "--stream"], {
      model: "glm-5.3-flash",
      host: `http://127.0.0.1:${port}/api/coding/paas/v4`,
      messages: [{ role: "user", content: "Reply briefly." }]
    }, {
      ...process.env,
      PYA_COMMAND_RESPONSE: "",
      Z_AI_CODING_API_KEY: "test-only-coding-key"
    });
    assert.notEqual(result.code, 0);
    const records = result.stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(records, [{
      type: "terminal",
      ok: false,
      error: {
        name: "Error",
        message: "Z.AI Coding Plan request failed: status=503 error=temporary provider outage"
      }
    }]);
    assert.match(result.stderr, /temporary provider outage/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
