import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "command/mind_openai_runner.mjs");

async function startServer(respond) {
  const calls = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      calls.push({ method: request.method, path: request.url, authorization: request.headers.authorization, body });
      respond(request, response);
    });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const address = server.address();
  return {
    calls,
    host: `http://127.0.0.1:${address.port}`,
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

function localStrataEnv(host) {
  const env = { ...process.env, AI_HOST: host, PYA_COMMAND_RESPONSE: "" };
  for (const key of ["OPENAI_API_KEY", "AI_API_KEY", "STRATA_API_KEY"]) delete env[key];
  return env;
}

test("Strata backend sends tools and image data to local OpenAI-compatible chat endpoint", async () => {
  const api = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: {
        role: "assistant",
        content: "I can inspect this image.",
        tool_calls: [{ id: "call-1", type: "function", function: { name: "inspect", arguments: "{}" } }]
      } }]
    }));
  });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-strata-image-"));
  const imagePath = path.join(tempDir, "fixture.png");
  await fs.writeFile(imagePath, Buffer.from([137, 80, 78, 71]));
  try {
    const result = await runRunner(["--strata"], {
      host: api.host,
      model: "strata",
      messages: [{ role: "user", content: "What is in this picture?", imageFiles: [{ filename: imagePath, mimeType: "image/png" }] }],
      tools: [{ type: "function", function: { name: "inspect", parameters: { type: "object", properties: {} } } }]
    }, localStrataEnv(api.host));

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.response, "I can inspect this image.");
    assert.equal(output.message.tool_calls[0].function.name, "inspect");
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].path, "/v1/chat/completions");
    assert.equal(api.calls[0].authorization, "Bearer pyash-local");
    const body = JSON.parse(api.calls[0].body);
    assert.equal(body.model, "strata");
    assert.equal(body.tools[0].function.name, "inspect");
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  } finally {
    await api.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("Strata backend preserves OpenAI-compatible streaming", async () => {
  const api = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"local "}}]}\n\ndata: {"choices":[{"delta":{"content":"stream"}}]}\n\ndata: [DONE]\n\n');
  });
  try {
    const result = await runRunner(["--strata", "--stream"], {
      host: api.host,
      model: "strata",
      messages: [{ role: "user", content: "Say hello" }]
    }, localStrataEnv(api.host));
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /"local "/);
    assert.match(result.stdout, /"stream"/);
    assert.match(result.stdout, /\[STREAM_END\]/);
    assert.equal(api.calls[0].path, "/v1/chat/completions");
    assert.equal(JSON.parse(api.calls[0].body).stream, true);
  } finally {
    await api.close();
  }
});
