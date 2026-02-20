import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("discharge as wo draw frees comfyui models", async () => {
  forget();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: String(url), method, body });
    if (String(url).endsWith("/free")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {};
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const out = await interpret(parse("be discharge as wo draw do"));
    assert.equal(out?.value?.boolean, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/free"));
    assert.deepEqual(calls[0].body, { unload_models: true, free_memory: true });
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});
