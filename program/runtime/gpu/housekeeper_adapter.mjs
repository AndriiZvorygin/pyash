import { resolveGpuSourceIdentity } from "./source_identity.mjs";

function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeBaseUrl(baseUrl = "") {
  const value = normalizeText(baseUrl);
  if (!value) throw new Error("gpu housekeeper adapter defective: baseUrl is required");
  return value.replace(/\/+$/, "");
}

function normalizePath(pathname = "") {
  const value = `/${String(pathname || "").replace(/^\/+/, "")}`;
  return value;
}

async function parseJsonOrThrow(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("gpu housekeeper adapter defective: invalid json response");
  }
}

async function requestJson({ baseUrl = "", pathname = "", method = "GET", body, timeoutMs = 30000 } = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${normalizePath(pathname)}`;
  const options = {
    method: String(method || "GET").toUpperCase(),
    headers: {
      "content-type": "application/json"
    },
    signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 30000))
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    const error = new Error(`gpu housekeeper transport failed: ${normalizeText(cause?.message || cause)}`, { cause });
    error.retryableTransport = true;
    throw error;
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = normalizeText(await response.text());
    } catch {
      detail = "";
    }
    const error = new Error(`gpu housekeeper adapter defective (${response.status}): ${detail || response.statusText || "request failed"}`);
    error.statusCode = response.status;
    const retryAfter = Number.parseFloat(String(response.headers?.get?.("retry-after") || ""));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.ceil(retryAfter * 1000);
    throw error;
  }
  return parseJsonOrThrow(response);
}

async function requestJsonWithRetry(options, retryWindowMs = 300000) {
  const deadline = Date.now() + Math.max(1000, Number(retryWindowMs) || 300000);
  let delayMs = 250;
  while (true) {
    const remainingMs = deadline - Date.now();
    try {
      return await requestJson({ ...options, timeoutMs: Math.min(30000, Math.max(1000, remainingMs)) });
    } catch (error) {
      const retryable = error?.retryableTransport === true || [502, 503, 504].includes(error?.statusCode);
      if (!retryable || Date.now() >= deadline) throw error;
      const waitMs = Math.min(deadline - Date.now(), error.retryAfterMs || delayMs);
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, waitMs)));
      delayMs = Math.min(5000, delayMs * 2);
    }
  }
}

export function createGpuHousekeeperAdapter({ baseUrl = "", hostId = "", username = "" } = {}) {
  const rootUrl = normalizeBaseUrl(baseUrl);
  const sourceIdentity = resolveGpuSourceIdentity({ hostId, username });

  return {
    async getHealth() {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/health",
        method: "GET"
      });
    },

    async getSnapshot({ timeoutMs = 5000 } = {}) {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/snapshot",
        method: "GET",
        timeoutMs
      });
    },

    async getQueue() {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/queue",
        method: "GET"
      });
    },

    async getOllamaModels({ timeoutMs = 5000 } = {}) {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/runtime/ollama/models",
        method: "GET",
        timeoutMs
      });
    },

    async getStrataModels({ timeoutMs = 5000 } = {}) {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/runtime/strata/models",
        method: "GET",
        timeoutMs
      });
    },

    async getStrataContext({ timeoutMs = 5000 } = {}) {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/runtime/strata/context",
        method: "GET",
        timeoutMs
      });
    },

    async setStrataContext({ contextLength, timeoutMs = 240000 } = {}) {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/runtime/strata/context",
        method: "POST",
        body: { contextLength: Number(contextLength) },
        timeoutMs
      });
    },

    async getRuntimes() {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/runtime",
        method: "GET"
      });
    },

    async submitJob({ handleId = "", runtimeName = "", profileName = "", jobSpec = {}, deviceId = "", dischargeAllowed, routing = null } = {}) {
      const body = {
        handleId: normalizeText(handleId),
        runtimeName: normalizeText(runtimeName),
        profileName: normalizeText(profileName),
        jobSpec,
        hostId: sourceIdentity.hostId,
        source: {
          ...sourceIdentity,
          workerId: "pyash-gpu-worker",
          processId: process.pid
        }
      };
      if (normalizeText(deviceId)) body.deviceId = normalizeText(deviceId);
      if (typeof dischargeAllowed === "boolean") body.dischargeAllowed = dischargeAllowed;
      if (routing && typeof routing === "object" && !Array.isArray(routing)) body.routing = { ...routing };
      return requestJsonWithRetry({
        baseUrl: rootUrl,
        pathname: "/submit",
        method: "POST",
        body
      });
    },

    async previewCapacity({ runtimeName = "", profileName = "", jobSpec = {}, deviceId = "", dischargeAllowed } = {}) {
      const body = {
        runtimeName: normalizeText(runtimeName),
        profileName: normalizeText(profileName),
        jobSpec
      };
      if (normalizeText(deviceId)) body.deviceId = normalizeText(deviceId);
      if (typeof dischargeAllowed === "boolean") body.dischargeAllowed = dischargeAllowed;
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/capacity/preview",
        method: "POST",
        body
      });
    },

    async getJobStatus({ remoteJobId = "" } = {}) {
      const normalizedId = encodeURIComponent(normalizeText(remoteJobId));
      return requestJson({
        baseUrl: rootUrl,
        pathname: `/job/${normalizedId}`,
        method: "GET"
      });
    },

    async discharge({ profileName = "" } = {}) {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/discharge",
        method: "POST",
        body: {
          profileName: normalizeText(profileName),
          hostId: sourceIdentity.hostId
        }
      });
    }
  };
}
