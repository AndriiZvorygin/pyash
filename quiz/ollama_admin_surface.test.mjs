import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("list from wo ollama to ve text warm minds returns running models", async () => {
  forget();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: String(opts?.method ?? "GET") });
    if (String(url).endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            models: [
              { model: "qwen2.5:7b" },
              { name: "llama3.2:3b" }
            ]
          };
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const out = await run("be list from wo ollama to ve text warm minds do");
    assert.deepEqual(out?.value?.ve?.values, ["qwen2.5:7b", "llama3.2:3b"]);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/ps$/);
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});

test("discharge as wo ollama accepts ob ve text models", async () => {
  forget();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: String(url), method, body });
    if (String(url).endsWith("/api/generate")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { response: "" };
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const out = await run('ob ve text "qwen2.5:7b" "llama3.2:3b" as wo ollama be discharge do');
    assert.deepEqual(out?.value?.ve?.values, ["qwen2.5:7b", "llama3.2:3b"]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.body?.model), ["qwen2.5:7b", "llama3.2:3b"]);
    assert.ok(calls.every(c => c.body?.keep_alive === 0));
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});

test("discharge as wo mind helper discharges all warm minds", async () => {
  forget();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts?.method ?? "GET");
    const body = opts?.body ? JSON.parse(String(opts.body)) : null;
    calls.push({ url: String(url), method, body });
    if (String(url).endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { models: [{ model: "qwen2.5:7b" }, { model: "llama3.2:3b" }] };
        }
      };
    }
    if (String(url).endsWith("/api/generate")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { response: "" };
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  try {
    const out = await run("be discharge as wo mind do");
    assert.deepEqual(out?.value?.ve?.values, ["qwen2.5:7b", "llama3.2:3b"]);
    const psCalls = calls.filter(c => c.url.endsWith("/api/ps"));
    const genCalls = calls.filter(c => c.url.endsWith("/api/generate"));
    assert.equal(psCalls.length, 1);
    assert.equal(genCalls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    forget();
  }
});
