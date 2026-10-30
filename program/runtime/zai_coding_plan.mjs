import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "../library/pya_config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const codingKeyNames = ["Z_AI_CODING_API_KEY", "Z_A_CODING_API_KEY", "ZAI_CODING_API_KEY"];
const defaultSecretPath = path.join(repoRoot, "configure/secret.pya");
const DEFAULT_ZAI_CONTEXT_WINDOW = 131072;
const ZAI_CONTEXT_WINDOW_PRESETS = [16384, 32768, 65536, 131072, 262144, 524288, 1048576];
// The Coding Plan catalog returns IDs only, so keep verified provider limits here.
const ZAI_MODEL_CONTEXT_LIMITS = new Map([
  ["glm-4.5", 131072],
  ["glm-4.5-air", 131072],
  ["glm-4.6", 204800],
  ["glm-4.7", 204800],
  ["glm-5", 204800],
  ["glm-5-turbo", 204800],
  ["glm-5.1", 204800],
  ["glm-5.2", 1048576],
  ["glm-5.3", 1048576],
  ["glm-5.3-flash", 1048576],
  ["glm-5.3-flashx", 1048576]
]);

function zaiModelContextLimit(slug) {
  return ZAI_MODEL_CONTEXT_LIMITS.get(String(slug ?? "").trim().toLowerCase()) ?? DEFAULT_ZAI_CONTEXT_WINDOW;
}

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

export async function fetchZaiCodingPlanModels({
  host = "https://api.z.ai/api/v1",
  apiKey = resolveZaiCodingApiKey(),
  fetchFn = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  const key = String(apiKey ?? "").trim();
  if (!key) return { ok: false, error: "Z.AI Coding Plan key is missing", models: [] };
  if (typeof fetchFn !== "function") return { ok: false, error: "model discovery is unavailable", models: [] };

  let endpoint;
  try {
    endpoint = new URL("/api/coding/paas/v4/models", String(host)).toString();
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), models: [] };
  }

  const controller = new AbortController();
  const timer = Number.isFinite(Number(timeoutMs))
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;
  try {
    const response = await fetchFn(endpoint, {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal
    });
    if (!response?.ok) throw new Error(`model catalogue returned HTTP ${response?.status ?? "unknown"}`);
    const payload = await response.json();
    const entries = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
    const models = [...new Set(entries.map((entry) => {
      if (typeof entry === "string") return entry.trim();
      return String(entry?.id ?? entry?.name ?? entry?.model ?? "").trim();
    }).filter(Boolean))];
    return models.length
      ? { ok: true, models }
      : { ok: false, error: "provider returned no models", models: [] };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), models: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function defaultZaiCodexModelEntry(slug) {
  return {
    slug,
    display_name: slug,
    description: "Z.AI Coding Plan model",
    default_reasoning_level: "max",
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
    context_window: zaiModelContextLimit(slug),
    max_context_window: zaiModelContextLimit(slug),
    effective_context_window_percent: 95,
    supports_parallel_tool_calls: true,
    experimental_supported_tools: [],
    input_modalities: ["text"]
  };
}

function zaiCodexPaths(codexHome) {
  const home = codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return {
    home,
    configPath: path.join(home, "zai.config.toml")
  };
}

function readZaiCodexProfile(codexHome) {
  const { home, configPath } = zaiCodexPaths(codexHome);
  if (!fs.existsSync(configPath)) return { home, configPath, config: "", catalogPath: "", catalog: {} };
  const config = fs.readFileSync(configPath, "utf8");
  const pathMatch = config.match(/^\s*model_catalog_json\s*=\s*("(?:\\.|[^"])*")\s*$/m);
  let catalogPath = "";
  let catalog = {};
  if (pathMatch) {
    try {
      catalogPath = path.resolve(home, JSON.parse(pathMatch[1]));
      if (fs.existsSync(catalogPath)) catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    } catch {
      catalogPath = "";
      catalog = {};
    }
  }
  return { home, configPath, config, catalogPath, catalog };
}

export function getZaiModelContextLimit({ model = "glm-5.3-flash", codexHome } = {}) {
  return zaiModelContextLimit(model);
}

export function getZaiContextWindowOptions({ model = "glm-5.3-flash", codexHome } = {}) {
  const limit = getZaiModelContextLimit({ model, codexHome });
  const options = ZAI_CONTEXT_WINDOW_PRESETS.filter((value) => value <= limit);
  if (!options.includes(limit)) options.push(limit);
  return [...new Set(options)].sort((left, right) => left - right);
}

export function formatZaiContextWindow(value) {
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return "unknown";
  if (tokens % 1048576 === 0) return `${tokens / 1048576}M`;
  if (tokens % 1024 === 0) return `${tokens / 1024}K`;
  return tokens.toLocaleString("en-CA");
}

export function getZaiCodexContextWindow({ model = "glm-5.3-flash", codexHome } = {}) {
  const { config, catalog } = readZaiCodexProfile(codexHome);
  const configured = config.match(/^\s*model_context_window\s*=\s*(\d+)\s*$/m);
  const configuredValue = configured ? Number(configured[1]) : NaN;
  const entry = (Array.isArray(catalog?.models) ? catalog.models : [])
    .find((candidate) => String(candidate?.slug ?? "") === String(model ?? ""));
  const defaultValue = Number(entry?.context_window ?? zaiModelContextLimit(model));
  const selected = Number.isSafeInteger(configuredValue) && configuredValue > 0
    ? configuredValue
    : defaultValue;
  return Math.min(selected, getZaiModelContextLimit({ model, codexHome }));
}

export function setZaiCodexContextWindow({ model = "glm-5.3-flash", contextWindow, codexHome } = {}) {
  const requested = Number(contextWindow);
  const options = getZaiContextWindowOptions({ model, codexHome });
  if (!Number.isSafeInteger(requested) || !options.includes(requested)) {
    return { updated: false, reason: `context window must be one of: ${options.map(formatZaiContextWindow).join(", ")}`, options };
  }

  const { configPath, config } = readZaiCodexProfile(codexHome);
  if (!config) return { updated: false, reason: "Z.AI Codex profile is not configured", options };
  const setting = /^\s*model_context_window\s*=\s*\d+\s*$/m;
  const nextConfig = setting.test(config)
    ? config.replace(setting, `model_context_window = ${requested}`)
    : config.replace(/^(\s*model\s*=\s*"(?:\\.|[^"])*"\s*)$/m, `$1\nmodel_context_window = ${requested}`);
  if (nextConfig === config) {
    if (setting.test(config)) return { updated: true, unchanged: true, contextWindow: requested, options, configPath };
    return { updated: false, reason: "could not locate the model setting in the Z.AI Codex profile", options };
  }

  const mode = fs.statSync(configPath).mode & 0o777;
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, nextConfig, { mode });
    fs.chmodSync(temporaryPath, mode);
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    return { updated: false, reason: `could not update Z.AI Codex context setting: ${String(error?.message ?? error)}`, options };
  }
  return { updated: true, contextWindow: requested, options, configPath };
}

export function syncZaiCodexModelCatalog({
  models = [],
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
} = {}) {
  const ids = [...new Set((Array.isArray(models) ? models : [])
    .map((model) => String(model ?? "").trim())
    .filter(Boolean))];
  if (ids.length === 0) return { updated: false, reason: "empty model catalogue" };

  const configPath = path.join(codexHome, "zai.config.toml");
  if (!fs.existsSync(configPath)) return { updated: false, reason: "Z.AI Codex profile is not configured" };
  const config = fs.readFileSync(configPath, "utf8");
  const pathMatch = config.match(/^\s*model_catalog_json\s*=\s*("(?:\\.|[^"])*")\s*$/m);
  if (!pathMatch) return { updated: false, reason: "Z.AI Codex profile has no model catalog path" };

  let catalogPath;
  try {
    catalogPath = path.resolve(codexHome, JSON.parse(pathMatch[1]));
  } catch (error) {
    return { updated: false, reason: `invalid Z.AI model catalog path: ${String(error?.message ?? error)}` };
  }

  let catalog = { models: [] };
  let mode = 0o600;
  if (fs.existsSync(catalogPath)) {
    try {
      catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
      mode = fs.statSync(catalogPath).mode & 0o777;
    } catch (error) {
      return { updated: false, reason: `could not read Z.AI model catalog: ${String(error?.message ?? error)}` };
    }
  }
  const existing = Array.isArray(catalog?.models) ? catalog.models : [];
  const bySlug = new Map(existing.map((entry) => [String(entry?.slug ?? ""), entry]));
  const template = bySlug.get("glm-5.3-flash") || existing[0] || null;
  catalog = {
    ...catalog,
    models: ids.map((slug) => {
      const prior = bySlug.get(slug) || template || defaultZaiCodexModelEntry(slug);
      const contextLimit = zaiModelContextLimit(slug);
      return {
        ...prior,
        slug,
        display_name: slug,
        context_window: contextLimit,
        max_context_window: contextLimit
      };
    })
  };

  const temporaryPath = `${catalogPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode });
    fs.chmodSync(temporaryPath, mode);
    fs.renameSync(temporaryPath, catalogPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    return { updated: false, reason: `could not write Z.AI model catalog: ${String(error?.message ?? error)}` };
  }
  return { updated: true, path: catalogPath, models: ids };
}

function quoted(value) {
  return JSON.stringify(String(value ?? ""));
}

export function createZaiCodexHome({ apiKey, model = "glm-5.3-flash", reasoningEffort = "max", contextWindow, projectRoot = process.cwd() } = {}) {
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
  const modelEntry = defaultZaiCodexModelEntry(selectedModel);
  modelEntry.context_window = zaiModelContextLimit(selectedModel);
  modelEntry.max_context_window = zaiModelContextLimit(selectedModel);
  modelEntry.default_reasoning_level = selectedEffort;
  const models = { models: [modelEntry] };
  fs.writeFileSync(modelsPath, `${JSON.stringify(models, null, 2)}\n`, { mode: 0o600 });
  const config = [
    'model_provider = "ZAI"',
    `model = ${quoted(selectedModel)}`,
    ...(Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0
      ? [`model_context_window = ${Math.min(Number(contextWindow), modelEntry.max_context_window)}`]
      : []),
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
