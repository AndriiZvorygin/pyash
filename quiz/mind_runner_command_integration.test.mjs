import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

const FIXTURE_ENV = [
  "PYA_COMMAND_RESPONSE",
  "PYA_MIND_RESPONSE",
  "PYA_GPU_MANAGER_REQUIRED",
  "PYA_GPU_MIND_QUEUE",
  "PYA_OLLAMA_USAGE_DIR",
  "PYA_OLLAMA_REQUEST_TIMEOUT_MS"
];

test("Ollama mind module invokes its provider runner through command", async () => {
  forget();
  const savedEnv = new Map(FIXTURE_ENV.map((key) => [key, process.env[key]]));
  for (const key of FIXTURE_ENV) delete process.env[key];
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-mind-runner-integration-"));
  process.env.PYA_OLLAMA_USAGE_DIR = path.join(temporaryRoot, "usage");
  process.env.PYA_OLLAMA_REQUEST_TIMEOUT_MS = "5000";

  let requestBody = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      model: requestBody.model,
      message: { role: "assistant", content: "Hello from the local provider" },
      done: true
    }));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}`;

    await interpret(parse('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do'));
    await interpret(parse("exists su name mind backend be default ob name ollama command mind ya"));
    await interpret(parse(`exists su name ollama host ob text "${endpoint}" be default ya`));
    await interpret(parse('exists su name mind be mind via state "integration-model" ya'));

    const answer = await interpret(parse('su name prompt ob text "Say hello" for name mind to name text out be write do'));

    assert.equal(answer?.ob?.text, "Hello from the local provider");
    assert.equal(requestBody?.model, "integration-model");
    assert.equal(requestBody?.messages?.at(-1)?.content, "Say hello");
    assert.equal(requestBody?.stream, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    forget();
  }
});
