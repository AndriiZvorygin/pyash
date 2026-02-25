import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("discharge as wo qwen say calls qwen say backend free flow", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "qwen say host" }, ob: { text: "http://qwen.local:8188" }, be: "default" });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: String(url), method, body });
    return { ok: true, status: 200, statusText: "OK", async json() { return {}; } };
  };
  try {
    const out = await interpret(parse("be discharge as wo qwen say do"));
    assert.equal(out?.value?.boolean, true);
    assert.ok(calls.some(call => call.url.endsWith("/interrupt") && call.method === "POST"));
    assert.ok(calls.some(call => call.url.endsWith("/queue") && call.method === "POST"));
    assert.ok(calls.some(call => call.url.endsWith("/free") && call.method === "POST"));
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});
