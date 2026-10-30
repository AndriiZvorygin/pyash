import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createZaiCodexHome,
  removeZaiCodexHome,
  resolveZaiApiKey,
  resolveZaiCodingApiKey
} from "../program/runtime/zai_coding_plan.mjs";

test("Z.AI standard and Coding Plan keys resolve from distinct Pyash secret facts", () => {
  const secretFilePath = path.join(os.tmpdir(), `pyash-zai-secret-${process.pid}.pya`);
  fs.writeFileSync(secretFilePath, [
    'exists su name zai api key ob text "standard-key" be default ya',
    'exists su name zai coding api key ob text "coding-plan-key" be default ya',
    ""
  ].join("\n"), { mode: 0o600 });
  try {
    assert.equal(resolveZaiApiKey({ env: {}, secretFilePath }), "standard-key");
    assert.equal(resolveZaiApiKey({ env: { Z_AI_API_KEY: "runtime-standard" }, secretFilePath }), "runtime-standard");
    assert.equal(resolveZaiCodingApiKey({ env: {}, secretFilePath }), "coding-plan-key");
    assert.equal(resolveZaiCodingApiKey({ env: { Z_AI_CODING_API_KEY: "runtime-coding" }, secretFilePath }), "runtime-coding");
    assert.equal(resolveZaiCodingApiKey({ env: { Z_AI_API_KEY: "standard-key" }, secretFilePath: `${secretFilePath}.missing` }), "");
    assert.equal(resolveZaiApiKey({ env: { Z_AI_CODING_API_KEY: "coding-plan-key" }, secretFilePath: `${secretFilePath}.missing` }), "");
  } finally {
    fs.rmSync(secretFilePath, { force: true });
  }
});

test("isolated Codex profile uses Z.AI Responses and trusts only the active project", () => {
  const home = createZaiCodexHome({
    apiKey: "test-only-key",
    model: "glm-5.3",
    reasoningEffort: "max",
    projectRoot: "/workspace/pyash"
  });
  try {
    const configPath = path.join(home, "config.toml");
    const modelsPath = path.join(home, "models.json");
    const config = fs.readFileSync(configPath, "utf8");
    const models = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    assert.match(config, /base_url = "https:\/\/api\.z\.ai\/api\/v1"/u);
    assert.match(config, /wire_api = "responses"/u);
    assert.match(config, /experimental_bearer_token = "test-only-key"/u);
    assert.match(config, /\[projects\."\/workspace\/pyash"\]\s+trust_level = "trusted"/u);
    assert.equal(models.models[0].slug, "glm-5.3");
    assert.equal(models.models[0].context_window, 1048576);
    assert.equal(fs.statSync(home).mode & 0o777, 0o700);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(modelsPath).mode & 0o777, 0o600);
  } finally {
    removeZaiCodexHome(home);
  }
  assert.equal(fs.existsSync(home), false);
});
