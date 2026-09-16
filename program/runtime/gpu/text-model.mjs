import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPyaTextValues } from "../../../command/pya_lookup.mjs";

/**
 * Canonical local text-generation model used by Pyash text-processing lanes.
 * The value is deliberately read from configure/default.pya so model policy
 * lives in the declarative configuration rather than in individual programs.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULTS_PATH = path.join(ROOT, "configure", "default.pya");
function optionValues(options = {}) {
  // Older callers passed an environment object as the second argument. Keep
  // that shape working while new callers can provide { env, cwd, runtimePath }
  // explicitly.
  const value = options && typeof options === "object" ? options : {};
  const looksLikeEnv = !Object.prototype.hasOwnProperty.call(value, "env")
    && (Object.prototype.hasOwnProperty.call(value, "PYA_TEXT_MODEL")
      || Object.prototype.hasOwnProperty.call(value, "PYA_VISION_MODEL")
      || Object.prototype.hasOwnProperty.call(value, "PYA_SEE_MODEL")
      || Object.prototype.hasOwnProperty.call(value, "PYA_RUNTIME_FILE")
      || Object.prototype.hasOwnProperty.call(value, "OLLAMA_HOST"));
  return looksLikeEnv ? { env: value } : value;
}

function discoverRuntimePath(cwd = process.cwd()) {
  let cursor = path.resolve(String(cwd || process.cwd()));
  while (true) {
    const candidate = path.join(cursor, "conduct", "runtime.pya");
    if (requireFile(candidate)) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) return "";
    cursor = parent;
  }
}

function requireFile(filePath) {
  return fs.existsSync(filePath);
}

function configuredModel({ env = process.env, cwd = process.cwd(), runtimePath = "" } = {}) {
  const selectedRuntimePath = String(runtimePath || env?.PYA_RUNTIME_FILE || "").trim()
    || discoverRuntimePath(cwd)
    || path.join(cwd, "conduct", "runtime.pya");
  const runtimeValues = readPyaTextValues(selectedRuntimePath, ["model"]);
  const defaultValues = readPyaTextValues(DEFAULTS_PATH, ["mind model"]);
  return String(runtimeValues.model || defaultValues["mind model"] || "").trim();
}

export function resolveTextModel(explicit = "", options = {}) {
  const { env = process.env, cwd = process.cwd(), runtimePath = "" } = optionValues(options);
  const requested = String(explicit || "").trim();
  if (requested) return requested;
  const configured = String(env?.PYA_TEXT_MODEL || "").trim();
  return configured || configuredModel({ env, cwd, runtimePath });
}

/** Resolve the independently configured vision model used by image requests. */
export function resolveVisionModel(explicit = "", options = {}) {
  const { env = process.env, cwd = process.cwd(), runtimePath = "" } = optionValues(options);
  const requested = String(explicit || "").trim();
  if (requested) return requested;
  const configured = String(env?.PYA_VISION_MODEL || env?.PYA_SEE_MODEL || "").trim();
  if (configured) return configured;
  const selectedRuntimePath = String(runtimePath || env?.PYA_RUNTIME_FILE || "").trim()
    || discoverRuntimePath(cwd)
    || path.join(cwd, "conduct", "runtime.pya");
  const runtimeValues = readPyaTextValues(selectedRuntimePath, ["see default mind"]);
  const defaultValues = readPyaTextValues(DEFAULTS_PATH, ["see default mind"]);
  return String(runtimeValues["see default mind"] || defaultValues["see default mind"] || "").trim();
}

// Kept as a compatibility export for callers that need to inspect the active
// setting; its value is still loaded from .pya rather than declared here.
export const DEFAULT_TEXT_MODEL = resolveTextModel();
