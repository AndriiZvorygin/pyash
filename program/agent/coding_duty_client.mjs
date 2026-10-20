export function resolveCodingDutyHub(env = process.env) {
  const baseUrl = String(env.PYA_DUTY_HUB_URL ?? "").trim().replace(/\/+$/u, "");
  const authorization = String(env.PYA_DUTY_HUB_AUTHORIZATION ?? "").trim();
  if (!baseUrl || !authorization) {
    throw new Error("configure PYA_DUTY_HUB_URL and PYA_DUTY_HUB_AUTHORIZATION");
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("duty hub must use HTTPS outside loopback");
  }
  return { baseUrl, authorization };
}

export async function requestCodingDutyHub(config, route, {
  method = "GET",
  body,
  timeoutMs = 15000,
  fetchFn = fetch
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${config.baseUrl}${route}`, {
      method,
      headers: {
        authorization: config.authorization,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error?.message || `duty hub returned HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
