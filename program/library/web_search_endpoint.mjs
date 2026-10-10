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

export function resolveExternalSearchMotor(env = process.env) {
  return text(env?.PYA_WEB_SEARCH_MOTOR) || DEFAULT_PUBLIC_WEB_SEARCH_MOTOR;
}

