import test from "node:test";
import assert from "node:assert/strict";

import { readOllamaMetadata } from "../../program/runtime/criterion/ollama.mjs";

test("Ollama metadata falls back to the matching /api/tags digest", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/api/version")) return { ok: true, json: async () => ({ version: "0.11.0" }) };
    if (url.endsWith("/api/show")) return { ok: true, json: async () => ({ details: { quantization_level: "Q4_K_M" } }) };
    if (url.endsWith("/api/tags")) return { ok: true, json: async () => ({ models: [{ name: "qwen3.5:9b", digest: "sha256:qwen" }] }) };
    throw new Error(`unexpected URL ${url}`);
  };
  const metadata = await readOllamaMetadata({ model: "qwen3.5:9b", baseUrl: "http://ollama.test", fetchImpl });
  assert.equal(metadata.modelDigest, "sha256:qwen");
  assert.equal(metadata.quantization, "Q4_K_M");
  assert.ok(calls.some(url => url.endsWith("/api/tags")));
});
