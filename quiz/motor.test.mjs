import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import ollama from "../program/motor/ollama.mjs";

function withMockedFetch(mock, fn) {
  const originalFetch = global.fetch;
  const originalHost = process.env.OLLAMA_HOST;

  global.fetch = mock;

  return fn().finally(() => {
    global.fetch = originalFetch;
    if (originalHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = originalHost;
  });
}

test("generate streams responses from HTTP server", async () => {
  const calls = [];

  delete process.env.OLLAMA_HOST;

  await withMockedFetch(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: Readable.from([
        Buffer.from('{"response":"Hello","done":false}\n'),
        Buffer.from('{"response":" world","done":false}\n'),
        Buffer.from('{"response":"","done":true}\n')
      ])
    };
  }, async () => {
    const result = await ollama.generate("model-x", "say hi");

    assert.equal(result, "Hello world");
    assert.equal(calls[0].url, "http://localhost:11434/api/generate");
    const payload = JSON.parse(calls[0].options.body);
    assert.deepEqual(payload, { model: "model-x", prompt: "say hi", stream: true });
    assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  });
});

test("generate uses configured host and fails on non-ok responses", async () => {
  process.env.OLLAMA_HOST = "http://example.com";

  const calls = [];

  await withMockedFetch(async (url) => {
    calls.push(url);
    return { ok: false, status: 500, statusText: "boom" };
  }, async () => {
    await assert.rejects(ollama.generate("m", "p"), /500/);
    assert.equal(calls[0], "http://example.com/api/generate");
  });
});
