import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("discharge as wo say frees comfyui when say backend is comfyui", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "say backend default" }, ob: { text: "comfyui" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say host" }, ob: { text: "http://say.local:8188" }, be: "default" });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: String(url), method, body });
    if (String(url).endsWith("/free")) {
      return { ok: true, status: 200, statusText: "OK", async json() { return {}; } };
    }
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const out = await interpret(parse("be discharge as wo say do"));
    assert.equal(out?.value?.boolean, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/free"));
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});

test("discharge as wo say is no-op success for piper backend", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "say backend default" }, ob: { text: "piper" }, be: "default" });
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch should not be called for piper");
  };
  try {
    const out = await interpret(parse("be discharge as wo say do"));
    assert.equal(out?.value?.boolean, true);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});
