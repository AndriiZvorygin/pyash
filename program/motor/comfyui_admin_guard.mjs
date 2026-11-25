import { resolveGpuHousekeeperUrl } from "../runtime/gpu/managed-ollama.mjs";

// The draw, say, hear and music surfaces all sit on the same ComfyUI
// container. An interrupt aimed at one of them lands on the whole runtime, so
// a discharge must not cancel work another surface is running. The GPU
// Housekeeper knows which runtime holds a job, so it is asked first.

function normalizeText(value) {
  return String(value ?? "").trim();
}

async function readJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res?.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// True when the Housekeeper is running a ComfyUI job on this host. A render
// can take minutes; an unrelated discharge must not cut it short.
export async function managedComfyuiJobRunning({
  housekeeperUrl = "",
  providerUrl = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  const managerUrl = resolveGpuHousekeeperUrl({ managerUrl: housekeeperUrl, ollamaUrl: providerUrl });
  if (!managerUrl) return false;
  const payload = await readJson(`${managerUrl.replace(/\/$/, "")}/queue`, { fetchImpl, timeoutMs });
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.some((job) => {
    const runtimeName = normalizeText(job?.runtimeName).toLowerCase();
    const status = normalizeText(job?.status).toLowerCase();
    return runtimeName === "comfyui" && (status === "running" || status === "queued");
  });
}

// Guard for the ComfyUI admin calls that would cancel running work.
export async function comfyuiRuntimeIsBusy({
  housekeeperUrl = "",
  providerUrl = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  return managedComfyuiJobRunning({ housekeeperUrl, providerUrl, fetchImpl, timeoutMs });
}
