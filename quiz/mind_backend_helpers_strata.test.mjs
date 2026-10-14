import test from "node:test";
import assert from "node:assert/strict";
import {
  MIND_BACKEND_CHOICES,
  canonicalizeMindBackend,
  defaultMindHostForSource,
  defaultMindModelForSource,
  fetchStrataHealth,
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
