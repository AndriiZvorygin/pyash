export const DEFAULT_PUBLIC_WEB_SEARCH_MOTOR = "https://tsoc.liberit.ca/";

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeSearxUrl(base, question, limit) {
  const trimmed = text(base).replace(/\/+$/u, "");
  const hasSearch = trimmed.endsWith("/search");
  const url = new URL(hasSearch ? trimmed : `${trimmed}/search`);
  url.searchParams.set("q", question);
  url.searchParams.set("format", "json");
  if (limit) url.searchParams.set("count", String(limit));
  return url.toString();
}

export function isRetiredSearchMotor(value) {
  try {
    const url = new URL(text(value));
    return url.hostname.toLowerCase() === "mriczo" && url.port === "60490";
  } catch {
    return false;
  }
}

export function resolveExternalSearchMotor(env = process.env) {
  const configured = text(env?.PYA_WEB_SEARCH_MOTOR);
  return configured && !isRetiredSearchMotor(configured)
    ? configured
    : DEFAULT_PUBLIC_WEB_SEARCH_MOTOR;
}

export function resolveSearchMotor(value, env = process.env) {
  const explicit = text(value);
  return explicit && !isRetiredSearchMotor(explicit)
    ? explicit
    : resolveExternalSearchMotor(env);
}

