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

async function requestJson({ baseUrl = "", pathname = "", method = "GET", body } = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${normalizePath(pathname)}`;
  const options = {
    method: String(method || "GET").toUpperCase(),
    headers: {
      "content-type": "application/json"
    }
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

export function createGpuHousekeeperAdapter({ baseUrl = "", hostId = "" } = {}) {
  const rootUrl = normalizeBaseUrl(baseUrl);
  const defaultHostId = normalizeText(hostId);

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

    async submitJob({ handleId = "", runtimeName = "", profileName = "", jobSpec = {} } = {}) {
      return requestJson({
        baseUrl: rootUrl,
        pathname: "/submit",
        method: "POST",
        body: {
          handleId: normalizeText(handleId),
          runtimeName: normalizeText(runtimeName),
          profileName: normalizeText(profileName),
          jobSpec,
          hostId: defaultHostId
        }
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
          hostId: defaultHostId
        }
      });
    }
  };
}
