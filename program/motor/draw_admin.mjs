import { resolveConfigText } from "../configure/env.mjs";

function resolveDrawHost({ rememberFn } = {}) {
  return (
    resolveConfigText("draw host", { rememberFn }) ||
    process.env.PYA_DRAW_HOST ||
    "http://localhost:8188"
  );
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`draw admin failed: ${res.status} ${res.statusText ?? ""} (${url})`.trim());
  }
  return true;
}

async function postEmpty(url) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`draw admin failed: ${res.status} ${res.statusText ?? ""} (${url})`.trim());
  }
  return true;
}

export async function restartDrawBackend({ rememberFn } = {}) {
  const host = resolveDrawHost({ rememberFn }).replace(/\/$/, "");
  await postEmpty(`${host}/interrupt`);
  await postJson(`${host}/queue`, { clear: true });
  await postJson(`${host}/free`, { unload_models: true, free_memory: true });
  return true;
}

export async function dischargeDrawBackend({ rememberFn } = {}) {
  const host = resolveDrawHost({ rememberFn }).replace(/\/$/, "");
  await postJson(`${host}/free`, { unload_models: true, free_memory: true });
  return true;
}
