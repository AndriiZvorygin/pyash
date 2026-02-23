import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";

test("stop as wo say interrupts queue for comfyui backend", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "say backend default" }, ob: { text: "comfyui" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "say host" }, ob: { text: "http://say.local:8188" }, be: "default" });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: String(url), method, body });
    if (String(url).endsWith("/interrupt")) return { ok: true, status: 200, statusText: "OK", async json() { return {}; } };
    if (String(url).endsWith("/queue")) return { ok: true, status: 200, statusText: "OK", async json() { return {}; } };
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const out = await interpret(parse("be stop as wo say do"));
    assert.equal(out?.value?.boolean, true);
    assert.equal(calls.filter(c => c.url.endsWith("/interrupt")).length, 1);
    assert.equal(calls.filter(c => c.url.endsWith("/queue")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});
