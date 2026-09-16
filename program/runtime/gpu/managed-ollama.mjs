import crypto from "node:crypto";
import { resolveTextModel } from "./text-model.mjs";

export { DEFAULT_TEXT_MODEL } from "./text-model.mjs";

const DEFAULT_FETCH = globalThis.fetch;

function text(value) {
  return String(value ?? "").trim();
}

function stripApiPath(value) {
  return text(value).replace(/\/api\/(?:chat|generate)\/?$/iu, "").replace(/\/+$/u, "");
}

function envFlag(value, fallback = false) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function managerUrlFromOllama(ollamaUrl = "") {
  const base = stripApiPath(ollamaUrl);
  if (!base) return "";
  try {
    const parsed = new URL(base);
    const host = parsed.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(host)) return "";
    // Only infer the co-located housekeeper for the known remote GPU host.
    // Other hosts must opt in with PYA_GPU_HOUSEKEEPER_URL rather than having
    // a provider port guessed from an arbitrary URL.
    if (host !== "mriczo") return "";
    // The housekeeper is the stable control-plane port for the remote GPU
    // host, regardless of whether the provider itself is Ollama, ComfyUI,
    // or another service port.
    if (["11434", "8188", "8010", ""].includes(parsed.port)) parsed.port = "8090";
    return parsed.toString().replace(/\/+$/u, "");
  } catch {
    return "";
  }
}

export function resolveGpuHousekeeperUrl({ ollamaUrl = "", managerUrl = "", env = process.env } = {}) {
  const explicit = text(managerUrl || env.PYA_GPU_HOUSEKEEPER_URL || env.GPU_HOUSEKEEPER_URL);
  if (explicit) return explicit.replace(/\/+$/u, "");
  return managerUrlFromOllama(ollamaUrl || env.OLLAMA_HOST || "");
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(Math.max(1000, timeoutMs));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), Math.max(1000, timeoutMs)).unref?.();
  return controller.signal;
}

async function requestJson({ fetchImpl, url, method = "GET", body, timeoutMs }) {
  const response = await fetchImpl(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: timeoutSignal(timeoutMs),
  });
  if (!response.ok) {
    let detail = "";
    try { detail = text(await response.text()); } catch { /* diagnostic only */ }
    throw new Error(`gpu-managed Ollama request failed (${response.status}): ${detail || response.statusText || url}`);
  }
  return response.json();
}

function remoteJobId(result = {}) {
  return text(result.remoteJobId || result.jobId || result.id);
}

function terminalStatus(value = "") {
  const status = text(value).toLowerCase();
  if (["success", "succeeded", "complete", "completed", "done"].includes(status)) return "success";
  if (["fail", "failed", "error", "defective"].includes(status)) return "fail";
  return "";
}

function resultContent(result = {}) {
  if (result?.result && typeof result.result === "object") return result.result;
  return result;
}

function defaultHandleId(model, messages) {
  const digest = crypto.createHash("sha1")
    .update(`${model}\n${JSON.stringify(messages)}`)
    .digest("hex")
    .slice(0, 16);
  return `managed-ollama-${digest}-${Date.now().toString(36)}`;
}

/** Submit a non-Ollama GPU job to the housekeeper and wait for its result. */
export async function submitManagedGpuJob({
  runtimeName,
  profileName,
  jobSpec,
  managerUrl = "",
  providerUrl = "",
  deviceId = process.env.PYA_GPU_DEVICE_ID || "",
  dischargeAllowed = true,
  handleId = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = Number.parseInt(String(process.env.PYA_GPU_MANAGER_TIMEOUT_MS || "3600000"), 10) || 3600000,
  pollIntervalMs = Number.parseInt(String(process.env.PYA_GPU_MANAGER_POLL_MS || "500"), 10) || 500,
  vramRequiredMb = Number.parseInt(String(process.env.PYA_GPU_VRAM_REQUIRED_MB || "12000"), 10) || 12000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("managed GPU job requires fetch");
  const explicitManager = text(managerUrl || process.env.PYA_GPU_HOUSEKEEPER_URL || process.env.GPU_HOUSEKEEPER_URL);
  const resolvedManager = explicitManager
    ? explicitManager.replace(/\/+$/u, "")
    : (fetchImpl === DEFAULT_FETCH ? managerUrlFromOllama(providerUrl) : "");
  if (!resolvedManager) throw new Error("managed GPU job requires PYA_GPU_HOUSEKEEPER_URL");
  const normalizedRuntime = text(runtimeName);
  const normalizedProfile = text(profileName) || normalizedRuntime;
  if (!normalizedRuntime || !normalizedProfile || !jobSpec || typeof jobSpec !== "object") {
    throw new Error("managed GPU job requires runtimeName, profileName, and jobSpec");
  }
  const normalizedJobSpec = {
    ...jobSpec,
    resourceRequest: {
      vramRequiredMb: Math.max(1, Number(vramRequiredMb) || 12000),
      ...(jobSpec.resourceRequest && typeof jobSpec.resourceRequest === "object" ? jobSpec.resourceRequest : {}),
    },
  };
  const submit = await requestJson({
    fetchImpl,
    url: `${resolvedManager}/submit`,
    method: "POST",
    timeoutMs,
    body: {
      handleId: text(handleId) || `managed-${normalizedRuntime}-${Date.now().toString(36)}`,
      runtimeName: normalizedRuntime,
      profileName: normalizedProfile,
      dischargeAllowed: dischargeAllowed !== false,
      ...(text(deviceId) ? { deviceId: text(deviceId) } : {}),
      jobSpec: normalizedJobSpec,
    },
  });
  const id = remoteJobId(submit);
  if (!id) throw new Error(`gpu-managed ${normalizedRuntime} submit returned no remote job id`);
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 3600000);
  while (Date.now() <= deadline) {
    const status = await requestJson({
      fetchImpl,
      url: `${resolvedManager}/job/${encodeURIComponent(id)}`,
      timeoutMs: Math.min(30000, Math.max(1000, deadline - Date.now())),
    });
    const terminal = terminalStatus(status?.status);
    if (terminal === "success") return { ...resultContent(status), remoteJobId: id };
    if (terminal === "fail") {
      throw new Error(`gpu-managed ${normalizedRuntime} job failed: ${text(status?.error?.message || status?.error || status?.message || "unknown error")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, Number(pollIntervalMs) || 500)));
  }
  throw new Error(`gpu-managed ${normalizedRuntime} job timed out after ${timeoutMs}ms`);
}

export async function requestManagedOllamaChat({
  model = "",
  runtimePath = "",
  cwd = process.cwd(),
  env = process.env,
  messages = [],
  options = {},
  format = "",
  think = false,
  keepAlive = 300,
  ollamaUrl = "",
  managerUrl = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = Number.parseInt(String(env.PYA_GPU_MANAGER_TIMEOUT_MS || process.env.PYA_GPU_MANAGER_TIMEOUT_MS || "1800000"), 10) || 1800000,
  pollIntervalMs = Number.parseInt(String(env.PYA_GPU_MANAGER_POLL_MS || process.env.PYA_GPU_MANAGER_POLL_MS || "500"), 10) || 500,
  vramRequiredMb = Number.parseInt(String(env.PYA_OLLAMA_VRAM_REQUIRED_MB || process.env.PYA_OLLAMA_VRAM_REQUIRED_MB || "12000"), 10) || 12000,
  deviceId = env.PYA_GPU_DEVICE_ID || process.env.PYA_GPU_DEVICE_ID || "",
  dischargeAllowed = true,
  requireManager = envFlag(env.PYA_GPU_MANAGER_REQUIRED, false),
  allowDirect = envFlag(env.PYA_GPU_MANAGER_ALLOW_DIRECT, false),
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("managed Ollama requires fetch");
  const normalizedModel = resolveTextModel(model, { env, cwd, runtimePath });
  if (!normalizedModel) throw new Error("managed Ollama requires a model");
  const base = stripApiPath(ollamaUrl || process.env.OLLAMA_HOST || "http://mriczo:11434");
  const explicitManager = text(managerUrl || process.env.PYA_GPU_HOUSEKEEPER_URL || process.env.GPU_HOUSEKEEPER_URL);
  const resolvedManager = explicitManager
    ? explicitManager.replace(/\/+$/u, "")
    : (fetchImpl === DEFAULT_FETCH ? managerUrlFromOllama(base) : "");
  const payload = {
    model: normalizedModel,
    messages: Array.isArray(messages) ? messages : [],
    stream: false,
    think: Boolean(think),
    keep_alive: keepAlive,
    options: { ...options },
    ...(text(format) ? { format: text(format) } : {}),
  };

  if (!resolvedManager) {
    if (requireManager && !allowDirect) {
      throw new Error("managed Ollama requires PYA_GPU_HOUSEKEEPER_URL; direct remote GPU requests are disabled");
    }
    const direct = await requestJson({
      fetchImpl,
      url: `${base}/api/chat`,
      method: "POST",
      body: payload,
      timeoutMs,
    });
    return direct;
  }

  const submit = await requestJson({
    fetchImpl,
    url: `${resolvedManager}/submit`,
    method: "POST",
    timeoutMs,
    body: {
      handleId: defaultHandleId(normalizedModel, payload.messages),
      runtimeName: "ollama",
      profileName: normalizedModel,
      dischargeAllowed: dischargeAllowed !== false,
      ...(text(deviceId) ? { deviceId: text(deviceId) } : {}),
      jobSpec: {
        kind: "ollama-chat",
        resourceRequest: {
          vramRequiredMb: Math.max(1, Number(vramRequiredMb) || 12000),
          ...(text(deviceId) ? { deviceId: text(deviceId) } : {}),
        },
        payload,
      },
    },
  });
  const id = remoteJobId(submit);
  if (!id) {
    if (submit?.message?.content || submit?.response) return submit;
    throw new Error("gpu-managed Ollama submit returned no remote job id");
  }

  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 1800000);
  while (Date.now() <= deadline) {
    const status = await requestJson({
      fetchImpl,
      url: `${resolvedManager}/job/${encodeURIComponent(id)}`,
      timeoutMs: Math.min(30000, Math.max(1000, deadline - Date.now())),
    });
    const terminal = terminalStatus(status?.status);
    if (terminal === "success") return resultContent(status);
    if (terminal === "fail") {
      throw new Error(`gpu-managed Ollama job failed: ${text(status?.error?.message || status?.message || "unknown error")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, Number(pollIntervalMs) || 500)));
  }
  throw new Error(`gpu-managed Ollama job timed out after ${timeoutMs}ms`);
}
