import test from "node:test";
import assert from "node:assert/strict";

import { enforceAutoDischarge } from "../program/motor/provider_auto_discharge.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { setExchangeRecorder, clearExchangeRecorder } from "../program/bridge/exchange.mjs";

test("auto discharge mind frees draw backend", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: true }, be: "default" });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://draw.local:8188" }, be: "default" });

  const calls = [];
  const exchange = [];
  setExchangeRecorder({ record: (s) => exchange.push(s), runRoot: process.cwd() });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
  };
  try {
    const result = await enforceAutoDischarge({ activatingClass: "mind" });
    assert.equal(result.changed, true);
    assert.ok(calls.some(url => url.endsWith("/free")));
    assert.ok(exchange.some(s => s?.be === "discharge" && s?.su?.name === "provider auto discharge"));
  } finally {
    globalThis.fetch = priorFetch;
    clearExchangeRecorder();
  }
});

test("auto discharge draw unloads warm ollama minds", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: true }, be: "default" });
  doRemember({ mood: "ya", su: { name: "ollama host" }, ob: { text: "http://ollama.local:11434" }, be: "default" });

  const calls = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const asText = String(url);
    calls.push(`${init?.method ?? "GET"} ${asText}`);
    if (asText.endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ models: [{ model: "a" }, { model: "b" }] })
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
  };
  try {
    const result = await enforceAutoDischarge({ activatingClass: "draw" });
    assert.equal(result.changed, true);
    assert.ok(calls.some(line => line.includes("/api/ps")));
    assert.ok(calls.filter(line => line.includes("/api/generate")).length >= 2);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("auto discharge qwen say unloads draw and warm ollama minds", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: true }, be: "default" });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://draw.local:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "ollama host" }, ob: { text: "http://ollama.local:11434" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "hear backend default" }, ob: { text: "whisperx" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "hear host" }, ob: { text: "http://hear.local:8000" }, be: "default" });

  const calls = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init?.method ?? "GET";
    const asText = String(url);
    calls.push(`${method} ${asText}`);
    if (asText.endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ models: [{ model: "qwen3-vl:8b-instruct" }] })
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
  };
  try {
    const result = await enforceAutoDischarge({ activatingClass: "qwen say" });
    assert.equal(result.changed, true);
    assert.ok(result.released.includes("draw"));
    assert.ok(result.released.includes("mind"));
    assert.ok(result.released.includes("hear"));
    assert.ok(calls.some(line => line.includes("POST http://draw.local:8188/free")));
    assert.ok(calls.some(line => line.includes("GET http://ollama.local:11434/api/ps")));
    assert.ok(calls.some(line => line.includes("POST http://ollama.local:11434/api/generate")));
    assert.ok(calls.some(line => line.includes("POST http://hear.local:8000/discharge")));
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("auto discharge qwen say stays enabled when configured gpu classes omit qwen say", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: true }, be: "default" });
  doRemember({
    mood: "ya",
    su: { name: "gpu exclusive classes" },
    ob: { ve: { type: "text", values: ["mind", "draw", "hear"] } },
    be: "default"
  });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://draw.local:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "ollama host" }, ob: { text: "http://ollama.local:11434" }, be: "default" });

  const calls = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init?.method ?? "GET";
    const asText = String(url);
    calls.push(`${method} ${asText}`);
    if (asText.endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ models: [{ model: "qwen3-vl:8b-instruct" }] })
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
  };
  try {
    const result = await enforceAutoDischarge({ activatingClass: "qwen say" });
    assert.equal(result.changed, true);
    assert.ok(result.released.includes("mind"));
    assert.ok(calls.some(line => line.includes("GET http://ollama.local:11434/api/ps")));
    assert.ok(calls.some(line => line.includes("POST http://ollama.local:11434/api/generate")));
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("auto discharge can be disabled", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: false }, be: "default" });
  const result = await enforceAutoDischarge({ activatingClass: "mind" });
  assert.equal(result.changed, false);
});

test("auto discharge mind keeps target ollama model warm", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: true }, be: "default" });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://draw.local:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "ollama host" }, ob: { text: "http://ollama.local:11434" }, be: "default" });

  const calls = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init?.method ?? "GET";
    const asText = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url: asText, body });
    if (asText.endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ models: [{ model: "qwen3-vl:8b-instruct" }, { model: "llama3.2:3b" }] })
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
  };
  try {
    const result = await enforceAutoDischarge({ activatingClass: "mind", activatingModel: "qwen3-vl:8b-instruct" });
    assert.equal(result.changed, true);
    assert.ok(result.released.includes("mind"));
    const psCalls = calls.filter(call => call.url.endsWith("/api/ps"));
    const unloadCalls = calls.filter(call => call.url.endsWith("/api/generate"));
    assert.equal(psCalls.length, 1);
    assert.equal(unloadCalls.length, 1);
    assert.equal(unloadCalls[0]?.body?.model, "llama3.2:3b");
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("auto discharge hear unloads draw and warm ollama minds", async () => {
  forget();
  doRemember({ mood: "ya", su: { name: "provider auto discharge" }, ob: { boolean: true }, be: "default" });
  doRemember({ mood: "ya", su: { name: "draw host" }, ob: { text: "http://draw.local:8188" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "ollama host" }, ob: { text: "http://ollama.local:11434" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "hear backend default" }, ob: { text: "whisperx" }, be: "default" });
  doRemember({ mood: "ya", su: { name: "hear host" }, ob: { text: "http://hear.local:8000" }, be: "default" });

  const calls = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init?.method ?? "GET";
    const asText = String(url);
    calls.push(`${method} ${asText}`);
    if (asText.endsWith("/api/ps")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ models: [{ model: "a" }] })
      };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}) };
  };
  try {
    const result = await enforceAutoDischarge({ activatingClass: "hear" });
    assert.equal(result.changed, true);
    assert.ok(calls.some(line => line.includes("POST http://draw.local:8188/free")));
    assert.ok(calls.some(line => line.includes("GET http://ollama.local:11434/api/ps")));
    assert.ok(calls.some(line => line.includes("POST http://ollama.local:11434/api/generate")));
    assert.ok(!calls.some(line => line.includes("POST http://hear.local:8000/free")));
  } finally {
    globalThis.fetch = priorFetch;
  }
});
