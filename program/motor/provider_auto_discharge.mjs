import { resolveConfigBool, resolveConfigNum, resolveConfigSeries } from "../configure/env.mjs";
import { dischargeDrawBackend } from "./draw_admin.mjs";
import { dischargeHearBackend } from "./hear_admin.mjs";
import { dischargeOllamaMind, listWarmOllamaMinds } from "./ollama_admin.mjs";
import { dischargeQwenSayBackend } from "./say_admin.mjs";
import { emitExchangeSentence } from "../bridge/exchange.mjs";
import { doRemember, remember } from "../remember/index.mjs";

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

function activeProviderClass({ rememberFn = remember } = {}) {
  const text = String(rememberFn?.("provider active class")?.ob?.text ?? "").trim().toLowerCase();
  return text || "";
}

function rememberActiveProviderClass(activeClass) {
  const name = String(activeClass ?? "").trim().toLowerCase();
  if (!name) return;
  doRemember({
    mood: "ya",
    su: { name: "provider active class" },
    ob: { text: name },
    be: "text"
  });
}

function autoDischargeSettleMs({ rememberFn } = {}) {
  const configured = Number(resolveConfigNum("provider auto discharge settle ms", { rememberFn }));
  if (Number.isFinite(configured)) return Math.max(0, Math.floor(configured));
  return 1200;
}

async function settleAfterSwitch({ activeClass, previousClass, changed, rememberFn } = {}) {
  if (!changed) return 0;
  const active = String(activeClass ?? "").trim().toLowerCase();
  const previous = String(previousClass ?? "").trim().toLowerCase();
  if (!active || !previous || active === previous) return 0;
  const waitMs = autoDischargeSettleMs({ rememberFn });
  if (waitMs <= 0) return 0;
  await new Promise(resolve => setTimeout(resolve, waitMs));
  return waitMs;
}

async function finalizeAutoDischarge(result = {}, { activeClass, previousClass, rememberFn } = {}) {
  const waitedMs = await settleAfterSwitch({
    activeClass,
    previousClass,
    changed: Boolean(result?.changed),
    rememberFn
  });
  rememberActiveProviderClass(activeClass);
  if (waitedMs > 0) {
    emitExchangeSentence({
      mood: "ya",
      be: "number",
      su: { name: "provider auto discharge settle ms" },
      from: { name: String(activeClass ?? "").trim().toLowerCase() || "provider" },
      ob: { num: waitedMs }
    });
    return { ...result, waitedMs };
  }
  return result;
}

function gpuExclusiveClasses({ rememberFn } = {}) {
  const baseline = ["mind", "draw", "hear", "qwen say"];
  const configured = resolveConfigSeries("gpu exclusive classes", { rememberFn });
  if (!configured || configured.length === 0) return baseline;
  return normalizeClassList([...configured, ...baseline]);
}

function pushReleased(released = [], name = "") {
  const normalized = String(name ?? "").trim().toLowerCase();
  if (!normalized) return released;
  if (!released.includes(normalized)) released.push(normalized);
  return released;
}

async function releaseQwenSay({ classes = [], rememberFn, released = [] } = {}) {
  if (!classes.includes("qwen say")) return false;
  try {
    const qwenSay = await dischargeQwenSayBackend({ rememberFn });
    if (qwenSay?.discharged) {
      pushReleased(released, "qwen say");
      return true;
    }
  } catch {
    // fallback to draw-style discharge for comfyui-backed qwen say paths
    try {
      await dischargeDrawBackend({ rememberFn });
      pushReleased(released, "qwen say");
      return true;
    } catch {
      // best-effort release
    }
  }
  return false;
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
  const previousClass = activeProviderClass({ rememberFn });
  if (!autoDischargeEnabled({ rememberFn })) {
    return finalizeAutoDischarge({ changed: false, activated: activeClass, released: [] }, { activeClass, previousClass, rememberFn });
  }
  const classes = gpuExclusiveClasses({ rememberFn });
  if (!classes.includes(activeClass)) {
    return finalizeAutoDischarge({ changed: false, activated: activeClass, released: [] }, { activeClass, previousClass, rememberFn });
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
    await releaseQwenSay({ classes, rememberFn, released });
    if (classes.includes("hear")) {
      try {
        const hear = await dischargeHearBackend({ rememberFn });
        if (hear?.discharged) pushReleased(released, "hear");
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
      if (toDischarge.length > 0) pushReleased(released, "mind");
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return finalizeAutoDischarge(result, { activeClass, previousClass, rememberFn });
  }

  if (activeClass === "draw") {
    const released = [];
    await releaseQwenSay({ classes, rememberFn, released });
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
    if (warm.length > 0) pushReleased(released, "mind");
    if (classes.includes("hear")) {
      try {
        const hear = await dischargeHearBackend({ rememberFn });
        if (hear?.discharged) pushReleased(released, "hear");
      } catch {
        // best-effort release
      }
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return finalizeAutoDischarge(result, { activeClass, previousClass, rememberFn });
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
    if (warm.length > 0) pushReleased(released, "mind");
    if (classes.includes("hear")) {
      try {
        const hear = await dischargeHearBackend({ rememberFn });
        if (hear?.discharged) pushReleased(released, "hear");
      } catch {
        // best-effort release
      }
    }
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return finalizeAutoDischarge(result, { activeClass, previousClass, rememberFn });
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
    await releaseQwenSay({ classes, rememberFn, released });
    if (warm.length > 0) pushReleased(released, "mind");
    const result = { changed: released.length > 0, activated: activeClass, released };
    emitAutoDischarge(result);
    return finalizeAutoDischarge(result, { activeClass, previousClass, rememberFn });
  }

  return finalizeAutoDischarge({ changed: false, activated: activeClass, released: [] }, { activeClass, previousClass, rememberFn });
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
