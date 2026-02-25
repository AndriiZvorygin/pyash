import { resolveConfigText } from "../configure/env.mjs";

function resolveSayHost({ rememberFn } = {}) {
  return (
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    process.env.PYA_SAY_HOST ||
    process.env.PYA_DRAW_HOST ||
    "http://localhost:8188"
  );
}

function resolveQwenSayHost({ rememberFn } = {}) {
  return (
    resolveConfigText("qwen say host", { rememberFn }) ||
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    process.env.PYA_QWEN_SAY_HOST ||
    process.env.PYA_SAY_HOST ||
    process.env.PYA_DRAW_HOST ||
    "http://localhost:8188"
  );
}

export function resolveSayBackend({ rememberFn } = {}) {
  return String(
    resolveConfigText("say backend default", { rememberFn }) ||
      process.env.PYA_SAY_BACKEND ||
      "piper"
  )
    .trim()
    .toLowerCase();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`say admin failed: ${res.status} ${res.statusText ?? ""} (${url})`.trim());
  }
  return true;
}

async function postEmpty(url) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`say admin failed: ${res.status} ${res.statusText ?? ""} (${url})`.trim());
  }
  return true;
}

export async function dischargeSayBackend({ rememberFn } = {}) {
  const backend = resolveSayBackend({ rememberFn });
  if (backend !== "comfyui") {
    return { backend, discharged: false };
  }
  const host = resolveSayHost({ rememberFn }).replace(/\/$/, "");
  await postJson(`${host}/free`, { unload_models: true, free_memory: true });
  return { backend, discharged: true };
}

export async function dischargeQwenSayBackend({ rememberFn } = {}) {
  const host = resolveQwenSayHost({ rememberFn }).replace(/\/$/, "");
  try {
    await postEmpty(`${host}/interrupt`);
  } catch {
    // best-effort interrupt
  }
  try {
    await postJson(`${host}/queue`, { clear: true });
  } catch {
    // best-effort queue clear
  }
  await postJson(`${host}/free`, { unload_models: true, free_memory: true });
  return { host, discharged: true };
}

export async function restartSayBackend({ rememberFn } = {}) {
  const backend = resolveSayBackend({ rememberFn });
  if (backend !== "comfyui") {
    return { backend, restarted: false };
  }
  const host = resolveSayHost({ rememberFn }).replace(/\/$/, "");
  await postEmpty(`${host}/interrupt`);
  await postJson(`${host}/queue`, { clear: true });
  await postJson(`${host}/free`, { unload_models: true, free_memory: true });
  return { backend, restarted: true };
}

export async function stopSayBackend({ rememberFn } = {}) {
  const backend = resolveSayBackend({ rememberFn });
  if (backend !== "comfyui") {
    return { backend, stopped: false };
  }
  const host = resolveSayHost({ rememberFn }).replace(/\/$/, "");
  await postEmpty(`${host}/interrupt`);
  await postJson(`${host}/queue`, { clear: true });
  return { backend, stopped: true };
}

export function listSayBackends({ rememberFn } = {}) {
  const backend = resolveSayBackend({ rememberFn });
  return [backend];
}
