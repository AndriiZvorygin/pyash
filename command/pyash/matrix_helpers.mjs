import fs from "node:fs/promises";
import path from "node:path";

export function normalizeHomeserver(raw) {
  const text = String(raw ?? "").trim().replace(/\/+$/g, "");
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) return `https://${text}`;
  return text;
}

export function isAppserviceMode(mode) {
  const value = String(mode ?? "").trim().toLowerCase();
  return value === "appservice" || value === "appservice-push";
}

export function applyMatrixAuthToUrl(url, { token, userId, mode } = {}) {
  const text = String(url ?? "");
  if (!isAppserviceMode(mode)) return text;
  const parsed = new URL(text);
  if (token) parsed.searchParams.set("access_token", String(token));
  if (userId) parsed.searchParams.set("user_id", String(userId));
  return parsed.toString();
}

export function matrixAuthHeaders({ token, mode, headers = {} } = {}) {
  const next = { ...headers };
  if (!isAppserviceMode(mode) && token) {
    next.Authorization = `Bearer ${token}`;
  }
  return next;
}

export function sanitizeMatrixLocalpart(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._=-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function homeserverHost(homeserver) {
  const text = normalizeHomeserver(homeserver);
  if (!text) return "";
  const withoutProto = text.replace(/^https?:\/\//i, "");
  return withoutProto.replace(/\/.*$/g, "").trim().toLowerCase();
}

export function matrixUserIdFromLocalpart(localpart, homeserver) {
  const cleaned = sanitizeMatrixLocalpart(localpart);
  if (!cleaned) return "";
  const host = homeserverHost(homeserver);
  if (!host) return `@${cleaned}`;
  return `@${cleaned}:${host}`;
}

export function matrixLocalpartFromUserId(userId) {
  const text = String(userId ?? "").trim();
  if (!text.startsWith("@")) return "";
  const withoutAt = text.slice(1);
  const colonIndex = withoutAt.indexOf(":");
  return colonIndex === -1 ? withoutAt : withoutAt.slice(0, colonIndex);
}

export function normalizeMatrixUserIdentity(value, homeserver = "") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const host = homeserverHost(homeserver);
  let userId = "";
  if (text.startsWith("@")) {
    userId = ensureMatrixUserServer(text, host);
  } else if (text.includes(":")) {
    userId = `@${text}`;
  } else {
    userId = matrixUserIdFromLocalpart(text, homeserver);
  }
  const lowered = String(userId ?? "").trim().toLowerCase();
  if (!lowered.startsWith("@")) return "";
  const localpart = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(lowered));
  const server = matrixServerFromId(lowered);
  if (!localpart) return "";
  return server ? `@${localpart}:${server}` : `@${localpart}`;
}

export function matrixUsersMatch(a, b, homeserver = "") {
  const left = normalizeMatrixUserIdentity(a, homeserver).toLowerCase();
  const right = normalizeMatrixUserIdentity(b, homeserver).toLowerCase();
  return Boolean(left && right && left === right);
}

export function resolveAgentMatrixUserId({ agentName, homeserver, defaultUserId }) {
  const derived = matrixUserIdFromLocalpart(agentName, homeserver);
  if (!derived) return normalizeMatrixUserIdentity(defaultUserId, homeserver);
  if (matrixUsersMatch(defaultUserId, derived, homeserver)) {
    const ensured = ensureMatrixUserServer(defaultUserId, homeserverHost(homeserver));
    return String(ensured || derived).trim();
  }
  return derived;
}

export function matrixSupportsSharedSecret(homeserver) {
  const host = homeserverHost(homeserver);
  return host !== "matrix.org";
}

export function matrixServerFromId(value) {
  const text = String(value ?? "").trim();
  const idx = text.lastIndexOf(":");
  if (idx <= 0 || idx === text.length - 1) return "";
  return text.slice(idx + 1).trim().toLowerCase();
}

export function ensureMatrixIdServer(value, host) {
  const text = String(value ?? "").trim();
  const trimmedHost = String(host ?? "").trim().toLowerCase();
  if (!text || !trimmedHost) return text;
  if (!text.startsWith("#") && !text.startsWith("!")) return text;
  if (matrixServerFromId(text)) return text;
  return `${text}:${trimmedHost}`;
}

export function rewriteMatrixIdServer(value, host) {
  const text = String(value ?? "").trim();
  const trimmedHost = String(host ?? "").trim().toLowerCase();
  if (!text || !trimmedHost) return text;
  if (!text.startsWith("#") && !text.startsWith("!")) return text;
  if (!matrixServerFromId(text)) return `${text}:${trimmedHost}`;
  const local = text.slice(0, text.lastIndexOf(":"));
  return `${local}:${trimmedHost}`;
}

export function ensureMatrixUserServer(value, host) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!host) return text;
  if (!text.startsWith("@")) return text;
  return rewriteMatrixIdServer(text, host);
}

export function redactText(value) {
  if (!value) return "";
  return "[redacted]";
}

export function redactMatrixConfig(cfg) {
  return {
    ...cfg,
    token: redactText(cfg.token),
    password: redactText(cfg.password),
    registrationSharedSecret: redactText(cfg.registrationSharedSecret),
    adminToken: redactText(cfg.adminToken)
  };
}

export function normalizeMatrixMode(raw, fallback = "poll") {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "appservice") return "appservice-push";
  if (["poll", "sync", "appservice-push", "appservice"].includes(value)) return value;
  return fallback;
}

export function stripYamlScalarQuotes(value) {
  const text = String(value ?? "").trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

export function parseTopLevelYamlScalars(text) {
  const out = {};
  const lines = String(text ?? "").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/u, "");
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*(.*?)\s*$/u);
    if (!match) continue;
    out[match[1]] = stripYamlScalarQuotes(match[2]);
  }
  return out;
}

export function resolveConfigPath(rootDir, candidate) {
  const text = String(candidate ?? "").trim();
  if (!text) return "";
  if (path.isAbsolute(text)) return text;
  return path.resolve(rootDir, text);
}

export async function readMatrixAppserviceRegistration({ rootDir, registrationPath }) {
  const resolvedPath = resolveConfigPath(rootDir, registrationPath);
  if (!resolvedPath) throw new Error("appservice registration path is required");
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = parseTopLevelYamlScalars(raw);
  const asToken = String(parsed.as_token ?? "").trim();
  const hsToken = String(parsed.hs_token ?? "").trim();
  const senderLocalpart = String(parsed.sender_localpart ?? "").trim();
  const url = String(parsed.url ?? "").trim();
  const id = String(parsed.id ?? "").trim();
  const missing = [];
  if (!asToken) missing.push("as_token");
  if (!hsToken) missing.push("hs_token");
  if (!senderLocalpart) missing.push("sender_localpart");
  if (!url) missing.push("url");
  if (missing.length) {
    throw new Error(`appservice registration missing required keys: ${missing.join(", ")}`);
  }
  return {
    path: resolvedPath,
    id,
    asToken,
    hsToken,
    senderLocalpart,
    url
  };
}
