import { remember, allRemember, doRemember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { renderSayValue } from "./say.mjs";
import { closeMcpServer } from "../motor/mcp.mjs";
import { getRefinery, removeRefinery } from "../bridge/refinery.mjs";
import { dischargeOllamaMind, listWarmOllamaMinds } from "../motor/ollama_admin.mjs";
import { dischargeDrawBackend } from "../motor/draw_admin.mjs";
import { dischargeHearBackend } from "../motor/hear_admin.mjs";
import { dischargeQwenSayBackend, dischargeSayBackend } from "../motor/say_admin.mjs";

function resolveTargetName(sentence, { rememberFn }) {
  const ob = sentence?.ob ?? {};
  if (typeof ob.name === "string" && ob.name.trim()) return ob.name.trim();
  if (typeof ob.text === "string" && ob.text.trim()) return ob.text.trim();
  const raw = renderSayValue(ob, { rememberFn });
  const text = String(raw ?? "").trim();
  return text || null;
}

function resolveTargetNames(sentence) {
  const values = sentence?.ob?.ve?.values;
  if (!Array.isArray(values)) return [];
  return values.map(v => String(v ?? "").trim()).filter(Boolean);
}

function resolveDischargeType(sentence) {
  const raw = sentence?.as?.wo ?? sentence?.as?.name ?? sentence?.as?.text ?? "";
  const text = String(raw ?? "").trim().toLowerCase();
  return text || null;
}

function resolveMcpServerName(targetName, { rememberFn, explicitMcp }) {
  if (!targetName) return null;
  const trimmed = String(targetName).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("mcp ")) return trimmed.slice(4).trim();
  if (explicitMcp) return trimmed;
  if (rememberFn && rememberFn(`mcp ${trimmed}`)) return trimmed;
  const fact = rememberFn ? rememberFn(trimmed) : null;
  if (fact?.be === "mcp") return trimmed;
  if (fact?.su?.name && String(fact.su.name).startsWith("mcp ")) {
    return String(fact.su.name).slice(4).trim();
  }
  return null;
}

function invalidateRefineryBoundAliases(refineryName) {
  const names = new Set();
  for (const sentence of allRemember()) {
    if (!sentence?.su?.name) continue;
    if (sentence.mood !== "ya") continue;
    if (sentence.be !== "refinery" && sentence.be !== "mind") continue;
    const provider = sentence?.as?.name ?? sentence?.from?.name ?? null;
    if (provider !== refineryName) continue;
    names.add(sentence.su.name);
  }

  for (const name of names) {
    doRemember({
      mood: "ya",
      be: "discharge",
      su: { name },
      ob: { name: refineryName },
      from: { name: "refinery" }
    });
  }
  return names.size;
}

export async function discharge(sentence, { remember: rememberFn = remember } = {}) {
  const targetNames = resolveTargetNames(sentence);
  const targetName = resolveTargetName(sentence, { rememberFn });
  const dischargeType = resolveDischargeType(sentence);
  if (dischargeType && dischargeType !== "mcp" && dischargeType !== "refinery" && dischargeType !== "ollama" && dischargeType !== "mind" && dischargeType !== "draw" && dischargeType !== "hear" && dischargeType !== "say" && dischargeType !== "qwen" && dischargeType !== "qwen say") {
    throwErrorSentence({
      name: "discharge target defective",
      message: `discharge target defective: ${dischargeType}`,
      from: { name: "discharge" },
      raw: { sentence }
    });
  }
  if (dischargeType === "draw") {
    await dischargeDrawBackend({ rememberFn });
    return {
      mood: "ya",
      be: "discharge",
      as: { wo: "draw" },
      ob: { boolean: true }
    };
  }
  if (dischargeType === "hear") {
    await dischargeHearBackend({ rememberFn });
    return {
      mood: "ya",
      be: "discharge",
      as: { wo: "hear" },
      ob: { boolean: true }
    };
  }
  if (dischargeType === "say") {
    const result = await dischargeSayBackend({ rememberFn });
    if (result?.backend === "comfyui") {
      try {
        await dischargeQwenSayBackend({ rememberFn });
      } catch {
        // keep legacy say discharge successful even if qwen endpoint rejects
      }
    }
    return {
      mood: "ya",
      be: "discharge",
      as: { wo: "say" },
      from: { name: result.backend },
      ob: { boolean: true }
    };
  }
  if (dischargeType === "qwen" || dischargeType === "qwen say") {
    const result = await dischargeQwenSayBackend({ rememberFn });
    return {
      mood: "ya",
      be: "discharge",
      as: { wo: "qwen say" },
      fromstate: { text: result.host },
      ob: { boolean: true }
    };
  }
  const explicitOllama = dischargeType === "ollama";
  const explicitMind = dischargeType === "mind";
  if (explicitOllama || explicitMind) {
    const names = targetNames.length > 0
      ? targetNames
      : (targetName ? [targetName] : await listWarmOllamaMinds({ rememberFn }));
    const discharged = [];
    for (const modelName of names) {
      await dischargeOllamaMind(modelName, { rememberFn });
      discharged.push(modelName);
    }
    return {
      mood: "ya",
      be: "discharge",
      as: { wo: explicitMind ? "mind" : "ollama" },
      ob: { ve: { type: "text", values: discharged } },
      by: { num: discharged.length }
    };
  }
  if (!targetName) {
    throwErrorSentence({
      name: "discharge target missing",
      message: "discharge target missing",
      from: { name: "discharge" },
      raw: { sentence }
    });
  }
  const mcpName = resolveMcpServerName(targetName, { rememberFn, explicitMcp: dischargeType === "mcp" });
  if (mcpName) {
    closeMcpServer(mcpName);
    return {
      mood: "ya",
      be: "discharge",
      ob: { name: mcpName },
      from: { name: "mcp" }
    };
  }
  const refineryName = String(targetName).trim();
  const explicitRefinery = dischargeType === "refinery";
  const fact = rememberFn(refineryName);
  const resolvedRefineryName = explicitRefinery
    ? (fact?.as?.name ?? fact?.from?.name ?? refineryName)
    : (fact?.be === "refinery" ? (fact?.as?.name ?? fact?.from?.name ?? refineryName) : null);
  if (resolvedRefineryName && getRefinery(resolvedRefineryName)) {
    const releasedAliases = invalidateRefineryBoundAliases(resolvedRefineryName);
    removeRefinery(resolvedRefineryName);
    return {
      mood: "ya",
      be: "discharge",
      ob: { name: resolvedRefineryName },
      from: { name: "refinery" },
      by: { num: releasedAliases }
    };
  }
  throwErrorSentence({
    name: "discharge target unknown",
    message: "discharge target unknown",
    from: { name: "discharge" },
    raw: { targetName }
  });
}

export default discharge;

export const signatures = [
  { signatureWords: ["be", "discharge", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "ob", "vec", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "ob", "name", "map"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mind"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "draw"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "hear"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "say"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "qwen"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "qwen", "say"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ollama"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ollama", "ob", "vec", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "name", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "name", "num", "ob", "name", "map"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "name", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "ob", "name", "map"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "name", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "mcp", "ob", "name", "map"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "refinery", "ob", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "refinery", "ob", "name", "text"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "refinery", "ob", "name", "num"], handler: discharge },
  { signatureWords: ["be", "discharge", "as", "wo", "refinery", "ob", "name", "map"], handler: discharge }
];
