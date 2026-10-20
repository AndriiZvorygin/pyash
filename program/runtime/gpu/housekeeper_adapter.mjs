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

  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = "";
    try {
      detail = normalizeText(await response.text());
    } catch {
      detail = "";
    }
    throw new Error(`gpu housekeeper adapter defective (${response.status}): ${detail || response.statusText || "request failed"}`);
  }
  return parseJsonOrThrow(response);
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

    async getSnapshot() {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/snapshot",
        method: "GET"
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
      return requestJson({
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
