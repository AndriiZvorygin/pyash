import { remember } from "../../remember/index.mjs";
import { resolveConfigBool, resolveConfigMapText, resolveConfigNum, resolveConfigText } from "../../configure/env.mjs";

export function resolveHost({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    "http://localhost:8188"
  );
}

export function resolveWorkflowRoot({ rememberFn = remember } = {}) {
  return resolveConfigText("say workflow root", { rememberFn }) || "./say/";
}

export function resolveWorkflowDefault({ rememberFn = remember } = {}) {
  return resolveConfigText("say workflow default", { rememberFn }) || "andrii_teaching_voice_qwen3_TTS";
}

export function resolveToneDefault({ rememberFn = remember } = {}) {
  return resolveConfigText("qwen say tone default", { rememberFn }) || "speak as a compassionate teacher";
}

export function resolveToneStrategy({ rememberFn = remember } = {}) {
  const mode = String(resolveConfigText("qwen say tone strategy", { rememberFn }) || "heuristic").trim().toLowerCase();
  return mode || "heuristic";
}

export function resolvePostProcessEnabled({ rememberFn = remember } = {}) {
  const configured = resolveConfigBool("qwen say post process", { rememberFn });
  return configured !== false;
}

export function resolvePostProcessFilter({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("qwen say post process filter", { rememberFn }) ||
    "highpass=f=60,acompressor=threshold=-20dB:ratio=3,alimiter=limit=-2dB"
  );
}

export function resolveKeepChunkArtifacts({ rememberFn = remember } = {}) {
  const configured = resolveConfigBool("qwen say keep chunks", { rememberFn });
  if (configured === false) return false;
  return true;
}

export function resolveClipVerifyEnabled({ rememberFn = remember } = {}) {
  return resolveConfigBool("qwen say clip verify enabled", { rememberFn }) === true;
}

export function resolveClipVerifyAllChunks({ rememberFn = remember } = {}) {
  const configured = resolveConfigBool("qwen say clip verify all chunks", { rememberFn });
  if (configured === false) return false;
  return true;
}

export function resolveClipVerifyMaxRetries({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify max retries", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Math.trunc(configured);
  return 3;
}

export function resolveClipVerifyTailWords({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify tail words", { rememberFn });
  if (Number.isFinite(configured) && configured >= 1) return Math.trunc(configured);
  return 2;
}

export function resolveClipVerifyWindowMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify window ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 60) return Number(configured);
  return 120;
}

export function resolveClipVerifyPeakDb({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify peak db", { rememberFn });
  if (Number.isFinite(configured)) return Number(configured);
  return -12;
}

export function resolveClipVerifyDeltaDb({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify delta db", { rememberFn });
  if (Number.isFinite(configured)) return Number(configured);
  return 1;
}

export function resolveClipVerifyMinTailMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify min tail ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Number(configured);
  return 40;
}

export function resolveClipVerifyMinTailWords({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify min tail words", { rememberFn });
  if (Number.isFinite(configured) && configured >= 1) return Math.trunc(configured);
  return 6;
}

export function resolveClipVerifyTailGapGuardEnabled({ rememberFn = remember } = {}) {
  return resolveConfigBool("qwen say clip verify tail gap guard", { rememberFn }) === true;
}

export function resolveClipVerifyStrict({ rememberFn = remember } = {}) {
  return resolveConfigBool("qwen say clip verify strict", { rememberFn }) === true;
}

export function resolveTailPadMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say tail pad ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Number(configured);
  return 160;
}

export function resolveChunkTailPadMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say chunk tail pad ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Number(configured);
  return 120;
}

export function resolveTailPauseMarkup({ rememberFn = remember } = {}) {
  return String(resolveConfigText("qwen say tail pause markup", { rememberFn }) ?? "").trim();
}

export function resolveClipVerifyHost({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("hear qwen host", { rememberFn }) ||
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    "http://localhost:8188"
  );
}

export function resolveClipVerifyWorkflowRoot({ rememberFn = remember } = {}) {
  return resolveConfigText("hear workflow root", { rememberFn }) || "./hear/";
}

export function resolveClipVerifyWorkflowName({ rememberFn = remember } = {}) {
  return resolveConfigText("hear workflow default", { rememberFn }) || "qwen3-asr-timestamps-attn2";
}

export function resolveQwenSaySanitizeMap({ rememberFn = remember } = {}) {
  return {
    percent: resolveConfigMapText("qwen say sanitize map", "percent", { rememberFn }) || "percent",
    referenceSeparator: resolveConfigMapText("qwen say sanitize map", "reference separator", { rememberFn }) || ".",
    ordinal1st: resolveConfigMapText("qwen say sanitize map", "ordinal 1st", { rememberFn }) || "first",
    ordinal2nd: resolveConfigMapText("qwen say sanitize map", "ordinal 2nd", { rememberFn }) || "second",
    ordinal3rd: resolveConfigMapText("qwen say sanitize map", "ordinal 3rd", { rememberFn }) || "third",
    pointWord: resolveConfigMapText("qwen say sanitize map", "point word", { rememberFn }) || "point"
  };
}

