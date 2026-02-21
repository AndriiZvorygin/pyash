import { resolveConfigBool, resolveConfigSeries } from "../configure/env.mjs";
import { dischargeDrawBackend } from "./draw_admin.mjs";
import { dischargeHearBackend } from "./hear_admin.mjs";
import { dischargeOllamaMind, listWarmOllamaMinds } from "./ollama_admin.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";

function normalizeClassList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const name = String(value ?? "").trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function autoDischargeEnabled({ rememberFn } = {}) {
  const configured = resolveConfigBool("provider auto discharge", { rememberFn });
  return configured !== false;
}

function gpuExclusiveClasses({ rememberFn } = {}) {
  const configured = resolveConfigSeries("gpu exclusive classes", { rememberFn });
  if (configured && configured.length) return normalizeClassList(configured);
  return ["mind", "draw", "hear"];
}

export async function enforceAutoDischarge({ activatingClass, rememberFn } = {}) {
  const activeClass = String(activatingClass ?? "").trim().toLowerCase();
  if (!activeClass) return { changed: false, activated: "", released: [] };
  if (!autoDischargeEnabled({ rememberFn })) {
    return { changed: false, activated: activeClass, released: [] };
  }
  const classes = gpuExclusiveClasses({ rememberFn });
  if (!classes.includes(activeClass)) {
    return { changed: false, activated: activeClass, released: [] };
  }

  if (activeClass === "mind") {
    await dischargeDrawBackend({ rememberFn });
    const released = ["draw"];
    if (classes.includes("hear")) {
      const hear = await dischargeHearBackend({ rememberFn });
      if (hear?.discharged) released.push("hear");
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return result;
  }

  if (activeClass === "draw") {
    const warm = await listWarmOllamaMinds({ rememberFn });
    for (const model of warm) {
      await dischargeOllamaMind(model, { rememberFn });
    }
    const released = warm.length ? ["mind"] : [];
    if (classes.includes("hear")) {
      const hear = await dischargeHearBackend({ rememberFn });
      if (hear?.discharged) released.push("hear");
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return result;
  }

  if (activeClass === "hear") {
    await dischargeDrawBackend({ rememberFn });
    const warm = await listWarmOllamaMinds({ rememberFn });
    for (const model of warm) {
      await dischargeOllamaMind(model, { rememberFn });
    }
    const released = ["draw"];
    if (warm.length > 0) released.push("mind");
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return result;
  }

  return { changed: false, activated: activeClass, released: [] };
}

function emitAutoDischarge(result = {}) {
  if (!result?.changed) return;
  const activated = String(result.activated ?? "").trim().toLowerCase();
  const released = Array.isArray(result.released) ? result.released.map(v => String(v)) : [];
  emitExchangeSentence({
    mood: "ya",
    be: "discharge",
    su: { name: "provider auto discharge" },
    from: { name: activated || "provider" },
    ob: { ve: { type: "text", values: released } },
    by: { num: released.length }
  });
}
