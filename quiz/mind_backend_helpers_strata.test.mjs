import test from "node:test";
import assert from "node:assert/strict";
import {
  MIND_BACKEND_CHOICES,
  canonicalizeMindBackend,
  defaultMindHostForSource,
  defaultMindModelForSource,
  fetchStrataHealth,
  fetchStrataRuntime,
  fetchStrataModels,
  classifyStrataRuntime,
  findMindBackendChoice
} from "../command/pyash/mind_backend_helpers.mjs";

test("Strata is selectable without changing the default Ollama backend", () => {
  assert.equal(MIND_BACKEND_CHOICES[0].key, "ollama");
  assert.equal(findMindBackendChoice("strata")?.value, "strata command mind");
  assert.equal(canonicalizeMindBackend("strata"), "strata command mind");
  assert.equal(defaultMindHostForSource("strata"), "http://127.0.0.1:8081");
  assert.equal(defaultMindModelForSource("strata"), "strata");
});

test("Strata configure health probe uses the loopback server health endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, async json() { return { status: "ok", loaded: true }; } };
  };
  try {
    const health = await fetchStrataHealth("http://127.0.0.1:8081/");
    assert.deepEqual(calls, ["http://127.0.0.1:8081/health"]);
    assert.deepEqual(health, { ok: true, health: { status: "ok", loaded: true } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Strata model discovery reads OpenAI-compatible model IDs", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return { data: [{ id: "qwen3.8:27b" }, { id: "qwen3.5:9b" }, { id: "qwen3.8:27b" }] };
      }
    };
  };
  try {
    const models = await fetchStrataModels("http://swac:8081/");
    assert.deepEqual(calls, ["http://swac:8081/v1/models"]);
    assert.deepEqual(models, { ok: true, models: ["qwen3.8:27b", "qwen3.5:9b"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Strata readiness requires both the model catalogue and loaded health state", () => {
  assert.equal(classifyStrataRuntime({ modelsOk: true, healthOk: true, health: { loaded: true } }).status, "ready");
  assert.deepEqual(
    classifyStrataRuntime({ modelsOk: false, healthOk: true, health: { loaded: false, etaSeconds: 42 } }),
    {
      ready: false,
      available: false,
      status: "loading",
      etaSeconds: 42,
      statusMessage: "Strata runtime is loading"
    }
  );
});

test("Strata runtime reports an explicit loading state without fabricating an ETA", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/models")) {
      return { ok: true, async json() { return { data: [{ id: "qwen3.8:27b" }] }; } };
    }
    return { ok: true, async json() { return { status: "loading", loaded: false }; } };
  };
  try {
    const runtime = await fetchStrataRuntime("http://swac:8081");
    assert.equal(runtime.ready, false);
    assert.equal(runtime.status, "loading");
    assert.equal(runtime.etaSeconds, null);
    assert.equal(runtime.models[0], "qwen3.8:27b");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
