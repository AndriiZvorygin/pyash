import { remember } from "../../remember/index.mjs";
import { throwErrorSentence } from "../../error.mjs";
import { valueToJson } from "./tools.mjs";

function normalizeServerName(name) {
  return String(name ?? "").trim();
}

function sanitizeServerName(name) {
  return String(name ?? "").trim().replace(/[^A-Za-z0-9_.-]+/g, "_") || "mcp";
}

function resolveMcpTransport(fact) {
  const raw = fact?.by?.wo ?? fact?.by?.text ?? "";
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "stdio";
  if (value === "http" || value === "sse" || value === "ws") return value;
  return "stdio";
}

function resolveMcpEndpoint(fact) {
  const raw = fact?.from?.name ?? fact?.from?.text ?? fact?.from?.space ?? null;
  if (!raw) return null;
  const text = String(raw ?? "").trim();
  return text || null;
}

function resolveMcpConfig(serverName, { rememberFn = remember } = {}) {
  const direct = rememberFn(serverName);
  const prefixed = rememberFn(`mcp ${serverName}`);
  const fact = (direct?.be === "mcp" ? direct : null)
    ?? (prefixed?.be === "mcp" ? prefixed : null)
    ?? (direct?.ob ? direct : null)
    ?? prefixed;
  if (!fact?.ob && !fact?.from) {
    throwErrorSentence({
      name: "mcp config missing",
      message: `mcp config missing: ${serverName}`,
      from: { name: "mcp" },
      raw: { name: serverName }
    });
  }
  const command = fact.ob?.text ?? fact.ob?.name ?? fact.ob?.filename;
  const endpoint = resolveMcpEndpoint(fact);
  if (!command && !endpoint) {
    throwErrorSentence({
      name: "mcp config defective",
      message: `mcp config defective: missing endpoint or command for ${serverName}`,
      from: { name: "mcp" },
      raw: { name: serverName }
    });
  }
  const args = Array.isArray(fact.by?.ve?.values) ? fact.by.ve.values.map(v => String(v ?? "")) : [];
  const policyName = fact.with?.name ?? null;
  const { policy: restartPolicy, headers } = resolveRestartPolicy(policyName, { rememberFn });
  const transport = resolveMcpTransport(fact);
  return {
    command: command ? String(command) : null,
    args,
    policyName,
    restartPolicy,
    headers,
    transport,
    endpoint
  };
}

function resolveMcpAllowlist({ rememberFn = remember } = {}) {
  const fact = rememberFn("mcp allowlist");
  if (!fact?.ob?.ve?.values) return null;
  const values = fact.ob.ve.values.map(v => String(v ?? "")).filter(Boolean);
  return values.length ? new Set(values) : null;
}

function resolveMcpDenylist({ rememberFn = remember } = {}) {
  const fact = rememberFn("mcp denylist");
  if (!fact?.ob?.ve?.values) return null;
  const values = fact.ob.ve.values.map(v => String(v ?? "")).filter(Boolean);
  return values.length ? new Set(values) : null;
}

const RESTART_POLICY_KEYS = new Set(["policy", "max", "window sec", "backoff", "base ms", "cap ms"]);

function getNamedMap(name, { rememberFn }) {
  if (!name || !rememberFn) return null;
  const fact = rememberFn(name);
  const map = fact?.ob?.map;
  return map && typeof map === "object" ? map : null;
}

function mapToRaw(map) {
  if (!map || typeof map !== "object") return null;
  const raw = {};
  for (const [key, value] of Object.entries(map)) {
    raw[key] = valueToJson(value);
  }
  return raw;
}

function resolveRestartPolicyFromRaw(raw, name) {
  if (!raw) return null;
  const policy = String(raw.policy ?? "never").trim().toLowerCase();
  const backoff = String(raw.backoff ?? "exponential").trim().toLowerCase();
  const max = Number(raw.max ?? 0);
  const windowSec = Number(raw["window sec"] ?? 0);
  const baseMs = Number(raw["base ms"] ?? 0);
  const capMs = Number(raw["cap ms"] ?? 0);
  return {
    name,
    policy,
    backoff: backoff === "linear" ? "linear" : "exponential",
    max: Number.isFinite(max) ? Math.max(0, max) : 0,
    windowMs: Number.isFinite(windowSec) ? Math.max(0, windowSec) * 1000 : 0,
    baseMs: Number.isFinite(baseMs) ? Math.max(0, baseMs) : 0,
    capMs: Number.isFinite(capMs) ? Math.max(0, capMs) : 0
  };
}

function resolveHeadersFromRaw(raw, { rememberFn }) {
  if (!raw) return null;
  const headerSource = typeof raw.headers === "string"
    ? mapToRaw(getNamedMap(raw.headers, { rememberFn }))
    : (raw.headers && typeof raw.headers === "object" ? raw.headers : null);
  const candidate = headerSource ?? raw;
  if (!candidate || typeof candidate !== "object") return null;
  const headers = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (RESTART_POLICY_KEYS.has(key) || key === "headers") continue;
    const rawValue = valueToJson(value);
    if (rawValue !== undefined && rawValue !== null) {
      headers[String(key)] = String(rawValue);
    }
  }
  return Object.keys(headers).length ? headers : null;
}

function resolveRestartPolicy(policyName, { rememberFn } = {}) {
  if (!policyName) return { policy: null, headers: null };
  const map = getNamedMap(policyName, { rememberFn });
  const raw = mapToRaw(map);
  if (!raw) return { policy: null, headers: null };
  const hasPolicyKeys = Object.keys(raw).some(key => RESTART_POLICY_KEYS.has(key));
  const policy = hasPolicyKeys ? resolveRestartPolicyFromRaw(raw, policyName) : null;
  const headers = resolveHeadersFromRaw(raw, { rememberFn });
  return { policy, headers };
}

function restartPolicyDelayMs(policy, attempt) {
  if (!policy || attempt <= 0) return 0;
  const base = policy.baseMs ?? 0;
  const cap = policy.capMs ?? 0;
  const raw = policy.backoff === "linear"
    ? base * attempt
    : base * (2 ** (attempt - 1));
  if (!cap) return raw;
  return Math.min(cap, raw);
}

export {
  normalizeServerName,
  sanitizeServerName,
  resolveMcpTransport,
  resolveMcpEndpoint,
  resolveMcpConfig,
  resolveMcpAllowlist,
  resolveMcpDenylist,
  resolveRestartPolicy,
  restartPolicyDelayMs
};
