import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "../library/pya_config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultSecretPath = path.join(repoRoot, "configure/secret.pya");

function readSecretValue(secretFilePath, name) {
  return String(readPyaTextValues(secretFilePath, [name])[name] || "").trim();
}

export function resolveMiniMaxApiKey({ env = process.env, secretFilePath = defaultSecretPath } = {}) {
  return String(env?.MINIMAX_API_KEY ?? "").trim()
    || readSecretValue(secretFilePath, "minimax api key");
}

function normalizeMiniMaxApiBase(host = "https://api.minimax.io/v1") {
  const base = String(host || "https://api.minimax.io/v1").trim().replace(/\/+$/u, "");
  return /\/v1$/iu.test(base) ? base : `${base}/v1`;
}

export async function fetchMiniMaxModels({
  host = "https://api.minimax.io/v1",
  apiKey = resolveMiniMaxApiKey(),
  fetchFn = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  const key = String(apiKey ?? "").trim();
  if (!key) return { ok: false, error: "MiniMax API key is missing", models: [] };
  if (typeof fetchFn !== "function") return { ok: false, error: "model discovery is unavailable", models: [] };

  const endpoint = `${normalizeMiniMaxApiBase(host)}/models`;
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
