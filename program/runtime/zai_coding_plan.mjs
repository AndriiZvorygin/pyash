import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "../library/pya_config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const codingKeyNames = ["Z_AI_CODING_API_KEY", "Z_A_CODING_API_KEY", "ZAI_CODING_API_KEY"];
const defaultSecretPath = path.join(repoRoot, "configure/secret.pya");

function readSecretValue(secretFilePath, name) {
  return String(readPyaTextValues(secretFilePath, [name])[name] || "").trim();
}

export function resolveZaiApiKey({ env = process.env, secretFilePath = defaultSecretPath } = {}) {
  return String(env?.Z_AI_API_KEY ?? "").trim() || readSecretValue(secretFilePath, "zai api key");
}

export function resolveZaiCodingApiKey({ env = process.env, secretFilePath = defaultSecretPath } = {}) {
  for (const keyName of codingKeyNames) {
    const value = String(env?.[keyName] ?? "").trim();
    if (value) return value;
  }
  return readSecretValue(secretFilePath, "zai coding api key");
}

function quoted(value) {
  return JSON.stringify(String(value ?? ""));
}

export function createZaiCodexHome({ apiKey, model = "glm-5.3-flash", reasoningEffort = "max", projectRoot = process.cwd() } = {}) {
  const selectedModel = String(model || "glm-5.3-flash").trim();
  const selectedEffort = ["low", "high", "max"].includes(String(reasoningEffort).trim())
    ? String(reasoningEffort).trim()
    : "max";
  const homeBase = path.join(os.homedir(), ".local", "state", "pyash", "codex-home");
  fs.mkdirSync(homeBase, { recursive: true, mode: 0o700 });
  fs.chmodSync(homeBase, 0o700);
  const home = fs.mkdtempSync(path.join(homeBase, "zai-"));
  fs.chmodSync(home, 0o700);
  const modelsPath = path.join(home, "models.json");
  const models = {
    models: [{
      slug: selectedModel,
      display_name: selectedModel,
      description: "Z.AI GLM Coding Plan model",
      default_reasoning_level: selectedEffort,
      supported_reasoning_levels: [
        { effort: "low", description: "Light reasoning" },
        { effort: "high", description: "Enhanced reasoning" },
        { effort: "max", description: "Deep reasoning" }
      ],
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: 0,
      base_instructions: "",
      supports_reasoning_summaries: true,
      default_reasoning_summary: "none",
      support_verbosity: false,
      apply_patch_tool_type: "freeform",
      truncation_policy: { mode: "bytes", limit: 10000 },
      context_window: 1048576,
      max_context_window: 1048576,
      effective_context_window_percent: 95,
      supports_parallel_tool_calls: true,
      experimental_supported_tools: [],
      input_modalities: ["text"]
    }]
  };
  fs.writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`, { mode: 0o600 });
  const config = [
    'model_provider = "ZAI"',
    `model = ${quoted(selectedModel)}`,
    `model_reasoning_effort = ${quoted(selectedEffort)}`,
    `model_catalog_json = ${quoted(modelsPath)}`,
    "",
    "[model_providers.ZAI]",
    'name = "ZAI"',
    'base_url = "https://api.z.ai/api/v1"',
    `experimental_bearer_token = ${quoted(apiKey)}`,
    'wire_api = "responses"',
    "",
    `[projects.${quoted(path.resolve(projectRoot))}]`,
    'trust_level = "trusted"',
    ""
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.toml"), config, { mode: 0o600 });
  return home;
}

export function removeZaiCodexHome(home) {
  if (home) fs.rmSync(home, { recursive: true, force: true });
}
