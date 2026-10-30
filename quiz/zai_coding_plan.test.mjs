import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  createZaiCodexHome,
  fetchZaiCodingPlanModels,
  formatZaiContextWindow,
  getZaiCodexContextWindow,
  getZaiContextWindowOptions,
  getZaiModelContextLimit,
  removeZaiCodexHome,
  resolveZaiApiKey,
  resolveZaiCodingApiKey,
  setZaiCodexContextWindow,
  syncZaiCodexModelCatalog
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

test("Codex auth helper emits the configured key only on stdout", () => {
  const result = spawnSync(process.execPath, ["command/zai_codex_auth.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, Z_AI_CODING_API_KEY: "fixture-coding-key" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "fixture-coding-key\n");
  assert.equal(result.stderr, "");
});

test("Z.AI Coding Plan discovery reads model IDs from the account catalog endpoint", async () => {
  const result = await fetchZaiCodingPlanModels({
    host: "https://api.z.ai/api/v1",
    apiKey: "catalog-test-key",
    fetchFn: async (url, options) => {
      assert.equal(url, "https://api.z.ai/api/coding/paas/v4/models");
      assert.equal(options.headers.authorization, "Bearer catalog-test-key");
      assert.ok(options.signal instanceof AbortSignal);
      return {
        ok: true,
        async json() {
          return {
            object: "list",
            data: [
              { id: "glm-5.3-flash" },
              { id: "glm-5.3" },
              { id: "glm-5.3-flash" }
            ]
          };
        }
      };
    }
  });

  assert.deepEqual(result, { ok: true, models: ["glm-5.3-flash", "glm-5.3"] });
});

test("Z.AI model discovery fails safely without a key or provider response", async () => {
  let calls = 0;
  const missingKey = await fetchZaiCodingPlanModels({ apiKey: "", fetchFn: async () => { calls += 1; } });
  assert.deepEqual(missingKey, { ok: false, error: "Z.AI Coding Plan key is missing", models: [] });
  assert.equal(calls, 0);

  const unavailable = await fetchZaiCodingPlanModels({
    apiKey: "catalog-test-key",
    fetchFn: async () => ({ ok: false, status: 503 })
  });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /HTTP 503/u);
  assert.deepEqual(unavailable.models, []);
});

test("Z.AI discovery refreshes the configured Codex catalog without losing model metadata", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), `pyash-zai-codex-catalog-${process.pid}-`));
  const catalogPath = path.join(codexHome, "models-zai.json");
  const profilePath = path.join(codexHome, "zai.config.toml");
  fs.writeFileSync(profilePath, `model_catalog_json = ${JSON.stringify(catalogPath)}\n`, { mode: 0o600 });
  fs.writeFileSync(catalogPath, `${JSON.stringify({
    models: [
      { slug: "glm-5.3-flash", display_name: "GLM Flash", context_window: 1048576, max_context_window: 1048576 },
      { slug: "glm-4.5", display_name: "old stale entry", context_window: 1048576, max_context_window: 1048576 }
    ],
    source: "zai"
  })}\n`, { mode: 0o600 });
  try {
    const refreshed = syncZaiCodexModelCatalog({
      codexHome,
      models: ["glm-5.3-flash", "glm-5.3", "glm-4.5", "glm-5.3-flashx", "glm-new-preview", "glm-5.3"]
    });
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assert.equal(refreshed.updated, true);
    assert.deepEqual(refreshed.models, ["glm-5.3-flash", "glm-5.3", "glm-4.5", "glm-5.3-flashx", "glm-new-preview"]);
    assert.deepEqual(catalog.models.map(({ slug }) => slug), refreshed.models);
    assert.equal(catalog.models[0].display_name, "glm-5.3-flash");
    assert.equal(catalog.models[1].context_window, 1048576);
    assert.equal(catalog.models[2].context_window, 131072);
    assert.equal(catalog.models[2].max_context_window, 131072);
    assert.equal(catalog.models[3].max_context_window, 1048576);
    assert.equal(catalog.models[4].max_context_window, 131072);
    assert.equal(catalog.source, "zai");
    assert.equal(fs.statSync(catalogPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("Z.AI context choices use the published per-model cap and conservative unknown-model fallback", () => {
  assert.equal(getZaiModelContextLimit({ model: "glm-4.5-air" }), 131072);
  assert.deepEqual(getZaiContextWindowOptions({ model: "glm-4.5" }), [16384, 32768, 65536, 131072]);
  assert.equal(getZaiModelContextLimit({ model: "glm-4.7" }), 204800);
  assert.deepEqual(getZaiContextWindowOptions({ model: "glm-5-turbo" }).at(-1), 204800);
  assert.equal(getZaiModelContextLimit({ model: "glm-5.3-flashx" }), 1048576);
  assert.equal(getZaiModelContextLimit({ model: "future-model" }), 131072);
  assert.deepEqual(getZaiContextWindowOptions({ model: "future-model" }), [16384, 32768, 65536, 131072]);
});

test("Z.AI context presets honor each Codex model maximum and persist to the profile", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), `pyash-zai-context-${process.pid}-`));
  const catalogPath = path.join(codexHome, "models-zai.json");
  const profilePath = path.join(codexHome, "zai.config.toml");
  fs.writeFileSync(profilePath, `model = "glm-4.7"\nmodel_catalog_json = ${JSON.stringify(catalogPath)}\n`, { mode: 0o600 });
  fs.writeFileSync(catalogPath, `${JSON.stringify({ models: [{
    slug: "glm-4.7",
    context_window: 204800,
    max_context_window: 204800
  }] })}\n`, { mode: 0o600 });
  try {
    assert.equal(getZaiModelContextLimit({ model: "glm-4.7", codexHome }), 204800);
    assert.deepEqual(getZaiContextWindowOptions({ model: "glm-4.7", codexHome }), [16384, 32768, 65536, 131072, 204800]);
    assert.equal(formatZaiContextWindow(131072), "128K");
    assert.equal(getZaiCodexContextWindow({ model: "glm-4.7", codexHome }), 204800);

    const saved = setZaiCodexContextWindow({ model: "glm-4.7", contextWindow: 131072, codexHome });
    assert.equal(saved.updated, true);
    assert.equal(getZaiCodexContextWindow({ model: "glm-4.7", codexHome }), 131072);
    assert.match(fs.readFileSync(profilePath, "utf8"), /^model_context_window = 131072$/mu);
    assert.equal(fs.statSync(profilePath).mode & 0o777, 0o600);

    const rejected = setZaiCodexContextWindow({ model: "glm-4.7", contextWindow: 524288, codexHome });
    assert.equal(rejected.updated, false);
    assert.match(rejected.reason, /one of/u);
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("isolated Codex profile uses Z.AI Responses and trusts only the active project", () => {
  const home = createZaiCodexHome({
    apiKey: "test-only-key",
    reasoningEffort: "max",
    contextWindow: 131072,
    projectRoot: "/workspace/pyash"
  });
  try {
    const configPath = path.join(home, "config.toml");
    const modelsPath = path.join(home, "models.json");
    const config = fs.readFileSync(configPath, "utf8");
    const models = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    assert.match(config, /base_url = "https:\/\/api\.z\.ai\/api\/v1"/u);
    assert.match(config, /wire_api = "responses"/u);
    assert.match(config, /^model_context_window = 131072$/mu);
    assert.match(config, /experimental_bearer_token = "test-only-key"/u);
    assert.match(config, /\[projects\."\/workspace\/pyash"\]\s+trust_level = "trusted"/u);
    assert.equal(models.models[0].slug, "glm-5.3-flash");
    assert.equal(home.startsWith(os.tmpdir()), false);
    assert.equal(models.models[0].context_window, 1048576);
    assert.equal(fs.statSync(home).mode & 0o777, 0o700);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(modelsPath).mode & 0o777, 0o600);
  } finally {
    removeZaiCodexHome(home);
  }
  assert.equal(fs.existsSync(home), false);
});
