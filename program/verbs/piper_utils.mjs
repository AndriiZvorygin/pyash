import crypto from "node:crypto";
import path from "node:path";

import { remember } from "../remember/index.mjs";
import { getExchangeSentenceId } from "../bridge/exchange.mjs";
import { resolveConfigNum, resolveConfigText } from "../configure/env.mjs";

let piperCounter = 0;

export function compareUtf8(a, b) {
  if (a === b) return 0;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const len = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < len; i += 1) {
    if (bufA[i] !== bufB[i]) return bufA[i] < bufB[i] ? -1 : 1;
  }
  return bufA.length < bufB.length ? -1 : 1;
}

export function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJsonValue(item));
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort(compareUtf8);
    for (const key of keys) {
      out[key] = canonicalizeJsonValue(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function resolveComputer() {
  const arch = process.arch;
  switch (process.platform) {
    case "win32":
      return arch === "x64" ? "win-x64" : `win-${arch}`;
    case "darwin":
      if (arch === "x64") return "darwin-x64";
      if (arch === "arm64") return "darwin-arm64";
      return `darwin-${arch}`;
    case "linux":
      if (arch === "x64") return "linux-x64";
      if (arch === "arm64") return "linux-arm64";
      return `linux-${arch}`;
    default:
      return `${process.platform}-${arch}`;
  }
}

export function resolveVoiceId({ rememberFn = remember } = {}) {
  const configuredVoice = resolveConfigText("piper voice", { rememberFn });
  if (configuredVoice) return configuredVoice;
  const configured = rememberFn?.("vocalization");
  if (configured?.be === "default") {
    if (typeof configured?.ob?.text === "string") return configured.ob.text;
    if (typeof configured?.ob?.name === "string") return configured.ob.name;
  }
  return "en_US-lessac-medium";
}

export function resolveVoicePath(voiceId) {
  if (!voiceId) return null;
  if (voiceId.includes("/") || voiceId.endsWith(".onnx")) return voiceId;
  return path.join("caterer", "say", "vocalization", "piper", voiceId, `${voiceId}.onnx`);
}

export function resolvePiperBinary({ rememberFn = remember } = {}) {
  const configuredBin = resolveConfigText("piper bin", { rememberFn });
  if (configuredBin) return configuredBin;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "say", "binary", computer, `piper${ext}`);
}

export function resolveOutputPath(sentence, { ext } = {}) {
  if (sentence?.to?.filename) return sentence.to.filename;
  const base = getExchangeSentenceId() || sentence?.su?.name || `say-${piperCounter++}`;
  return path.join("artifacts", "say", `${base}${ext}`);
}

export function resolveStreamChunkPath(sentence, index) {
  const base = getExchangeSentenceId() || sentence?.su?.name || "say-stream";
  const safeBase = String(base).replace(/[^A-Za-z0-9_.-]+/g, "-");
  return path.join("artifacts", "say", `${safeBase}-chunk-${index}.wav`);
}

export function resolveStreamDelayMs({ rememberFn = remember } = {}) {
  const raw = resolveConfigNum("say stream delay", { rememberFn });
  if (raw === undefined) return 150;
  if (!Number.isFinite(raw) || raw < 0) return 150;
  return raw;
}

export function metadataPathForOutput(outputPath) {
  if (outputPath.endsWith(".wav")) {
    return `${outputPath.slice(0, -4)}.metadata.json`;
  }
  return `${outputPath}.metadata.json`;
}
