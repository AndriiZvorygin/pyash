import test from "node:test";
import assert from "node:assert/strict";
import { resolveMindBackendHost } from "../program/verbs/mind/backend.mjs";

test("mind host follows the selected backend while keeping agent host precedence", () => {
  assert.equal(resolveMindBackendHost({
    backendName: "strata command mind",
    ollamaHost: "http://localhost:11434",
    aiHost: "http://127.0.0.1:8081"
  }), "http://127.0.0.1:8081");
  assert.equal(resolveMindBackendHost({
    backendName: "openai command mind",
    ollamaHost: "http://localhost:11434",
    aiHost: "https://api.openai.com"
  }), "https://api.openai.com");
  assert.equal(resolveMindBackendHost({
    backendName: "ollama command mind",
    ollamaHost: "http://localhost:11434",
    aiHost: "http://127.0.0.1:8081"
  }), "http://localhost:11434");
  assert.equal(resolveMindBackendHost({
    backendName: "strata command mind",
    runtimeHost: "http://agent-host:8081",
    aiHost: "http://127.0.0.1:8081"
  }), "http://agent-host:8081");
});
