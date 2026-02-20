import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("restart as wo draw interrupts queue and frees comfyui models", async () => {
  forget();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: String(url), method, body });
    if (String(url).endsWith("/interrupt")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { response: "" };
        }
      };
    }
    if (String(url).endsWith("/queue")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {};
        }
      };
    }
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
    const out = await interpret(parse("be restart as wo draw do"));
    assert.equal(out?.value?.boolean, true);
    const interruptCalls = calls.filter(c => c.url.endsWith("/interrupt"));
    const queueCalls = calls.filter(c => c.url.endsWith("/queue"));
    const freeCalls = calls.filter(c => c.url.endsWith("/free"));
    assert.equal(interruptCalls.length, 1);
    assert.equal(queueCalls.length, 1);
    assert.equal(freeCalls.length, 1);
    assert.deepEqual(queueCalls[0].body, { clear: true });
    assert.deepEqual(freeCalls[0].body, { unload_models: true, free_memory: true });
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});
