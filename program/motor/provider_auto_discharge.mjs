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
  return ["mind", "draw", "hear", "qwen say"];
}

function normalizeModelRef(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return { raw: "", base: "", tag: "" };
  const raw = text.replace(/\s+/g, "");
  const splitIndex = raw.indexOf(":");
  if (splitIndex === -1) return { raw, base: raw, tag: "" };
  return {
    raw,
    base: raw.slice(0, splitIndex),
    tag: raw.slice(splitIndex + 1)
  };
}

function modelMatchesTarget(candidate, target) {
  const left = normalizeModelRef(candidate);
  const right = normalizeModelRef(target);
  if (!left.raw || !right.raw) return false;
  if (left.raw === right.raw) return true;
  if (left.base !== right.base) return false;
  if (!left.tag || !right.tag) return true;
  if (left.tag === "latest" || right.tag === "latest") return true;
  return left.tag === right.tag;
}

export async function enforceAutoDischarge({ activatingClass, activatingModel = "", rememberFn } = {}) {
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
    let drawReleased = false;
    try {
      await dischargeDrawBackend({ rememberFn });
      drawReleased = true;
    } catch {
      drawReleased = false;
    }
    const released = drawReleased ? ["draw"] : [];
    if (classes.includes("hear")) {
      try {
        const hear = await dischargeHearBackend({ rememberFn });
        if (hear?.discharged) released.push("hear");
      } catch {
        // best-effort release
      }
    }
    const targetModel = String(activatingModel ?? "").trim();
    if (targetModel) {
      let warm = [];
      try {
        warm = await listWarmOllamaMinds({ rememberFn });
      } catch {
        warm = [];
      }
      const toDischarge = warm.filter(model => !modelMatchesTarget(model, targetModel));
      for (const model of toDischarge) {
        try {
          await dischargeOllamaMind(model, { rememberFn });
        } catch {
          // best-effort release
        }
      }
      if (toDischarge.length > 0 && !released.includes("mind")) released.push("mind");
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return result;
  }

  if (activeClass === "draw") {
    let warm = [];
    try {
      warm = await listWarmOllamaMinds({ rememberFn });
    } catch {
      warm = [];
    }
    for (const model of warm) {
      try {
        await dischargeOllamaMind(model, { rememberFn });
      } catch {
        // best-effort release
      }
    }
    const released = warm.length ? ["mind"] : [];
    if (classes.includes("hear")) {
      try {
        const hear = await dischargeHearBackend({ rememberFn });
        if (hear?.discharged) released.push("hear");
      } catch {
        // best-effort release
      }
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return result;
  }

  if (activeClass === "qwen say") {
    let drawReleased = false;
    try {
      await dischargeDrawBackend({ rememberFn });
      drawReleased = true;
    } catch {
      drawReleased = false;
    }
    let warm = [];
    try {
      warm = await listWarmOllamaMinds({ rememberFn });
    } catch {
      warm = [];
    }
    for (const model of warm) {
      try {
        await dischargeOllamaMind(model, { rememberFn });
      } catch {
        // best-effort release
      }
    }
    const released = drawReleased ? ["draw"] : [];
    if (warm.length > 0) released.push("mind");
    if (classes.includes("hear")) {
      try {
        const hear = await dischargeHearBackend({ rememberFn });
        if (hear?.discharged) released.push("hear");
      } catch {
        // best-effort release
      }
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return result;
  }

  if (activeClass === "hear") {
    let drawReleased = false;
    try {
      await dischargeDrawBackend({ rememberFn });
      drawReleased = true;
    } catch {
      drawReleased = false;
    }
    let warm = [];
    try {
      warm = await listWarmOllamaMinds({ rememberFn });
    } catch {
      warm = [];
    }
    for (const model of warm) {
      try {
        await dischargeOllamaMind(model, { rememberFn });
      } catch {
        // best-effort release
      }
    }
    const released = drawReleased ? ["draw"] : [];
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
