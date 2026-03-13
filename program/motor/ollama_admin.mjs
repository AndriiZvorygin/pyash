import { resolveConfigText } from "../configure/env.mjs";

function resolveOllamaHost({ rememberFn } = {}) {
  return (
    resolveConfigText("ollama host", { rememberFn }) ||
    process.env.OLLAMA_HOST ||
    "http://localhost:11434"
  );
}

function normalizeModelName(entry) {
  const model = String(entry?.model ?? "").trim();
  if (model) return model;
  const name = String(entry?.name ?? "").trim();
  if (name) return name;
  return "";
}

export async function listWarmOllamaMinds({ rememberFn } = {}) {
  const host = resolveOllamaHost({ rememberFn }).replace(/\/$/, "");
  let res;
  const endpoint = `${host}/api/ps`;
  try {
    res = await fetch(endpoint);
  } catch (err) {
    throw new Error(`ollama ps failed: fetch ${endpoint} (${err?.message ?? err})`);
  }
  if (!res.ok) {
    throw new Error(`ollama ps failed: ${res.status} ${res.statusText ?? ""} (${endpoint})`.trim());
  }
  const payload = await res.json();
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set();
  const out = [];
  for (const entry of models) {
    const name = normalizeModelName(entry);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export async function dischargeOllamaMind(model, { rememberFn } = {}) {
  const modelText = String(model ?? "").trim();
  if (!modelText) return false;
  const host = resolveOllamaHost({ rememberFn }).replace(/\/$/, "");
  let res;
  const endpoint = `${host}/api/generate`;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelText,
        prompt: "",
        keep_alive: 0,
        stream: false
      })
    });
  } catch (err) {
    throw new Error(`ollama discharge failed: fetch ${endpoint} (${err?.message ?? err})`);
  }
  if (!res.ok) {
    throw new Error(`ollama discharge failed: ${res.status} ${res.statusText ?? ""} (${endpoint})`.trim());
  }
  return true;
}
