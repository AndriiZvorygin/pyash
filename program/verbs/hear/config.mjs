import fsSync from "node:fs";
import path from "node:path";

import { resolveConfigNum, resolveConfigText } from "../../configure/env.mjs";
import { lookupArtifactLocator } from "../../bridge/exchange.mjs";

function resolveComputer() {
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

function resolveWhisperBinary({ rememberFn } = {}) {
  const configuredBin = resolveConfigText("hear bin", { rememberFn });
  if (configuredBin) return configuredBin;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "hear", "binary", computer, `whisper-main${ext}`);
}

function resolveWhisperStreamBinary({ rememberFn } = {}) {
  const configuredBin = resolveConfigText("hear stream bin", { rememberFn });
  if (configuredBin) return configuredBin;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "hear", "binary", computer, `whisper-stream${ext}`);
}

function resolveModelPath({ rememberFn } = {}) {
  const configured = resolveConfigText("hear model", { rememberFn });
  if (configured) return configured;
  const baseBin = path.join("caterer", "hear", "template", "whisper", "ggml-base.bin");
  if (fsSync.existsSync(baseBin)) return baseBin;
  return path.join("caterer", "hear", "template", "whisper", "ggml-base.en.bin");
}

function resolveHearLanguage({ rememberFn } = {}) {
  return resolveConfigText("hear language", { rememberFn }) || "auto";
}

function resolveHearCapture({ rememberFn } = {}) {
  const num = resolveConfigNum("hear capture", { rememberFn });
  if (num !== undefined) return String(num);
  const text = resolveConfigText("hear capture", { rememberFn });
  return text || "0";
}

function resolveHearPrompt(sentence) {
  const prompt = sentence?.ob?.text;
  if (typeof prompt !== "string") return "";
  const trimmed = prompt.trim();
  return trimmed.length ? trimmed : "";
}

function resolveHearBackend({ rememberFn } = {}) {
  const configured = resolveConfigText("hear backend default", { rememberFn });
  if (!configured) return "whisper";
  const normalized = String(configured).trim().toLowerCase();
  return normalized || "whisper";
}

function resolveHearHost({ rememberFn } = {}) {
  return resolveConfigText("hear host", { rememberFn }) || "http://localhost:8000";
}

function resolveHearWhisperxModel({ rememberFn } = {}) {
  return resolveConfigText("hear whisperx model", { rememberFn }) || "large-v3";
}

function resolveHearInputPath(sentence, { rememberFn } = {}) {
  if (typeof sentence?.from?.filename === "string") return sentence.from.filename;
  if (typeof sentence?.from?.text === "string") return sentence.from.text;
  const fromName = sentence?.from?.name;
  if (!fromName || !rememberFn) return null;
  const fact = rememberFn(fromName);
  const fromArtifact = lookupArtifactLocator(fromName);
  if (typeof fromArtifact === "string" && fromArtifact) return fromArtifact;
  if (typeof fact?.to?.filename === "string") return fact.to.filename;
  if (typeof fact?.ob?.filename === "string") return fact.ob.filename;
  if (typeof fact?.ob?.text === "string") return fact.ob.text;
  if (typeof fact?.ob?.name === "string") {
    const obArtifact = lookupArtifactLocator(fact.ob.name);
    if (typeof obArtifact === "string" && obArtifact) return obArtifact;
    return fact.ob.name;
  }
  return null;
}

export {
  resolveComputer,
  resolveWhisperBinary,
  resolveWhisperStreamBinary,
  resolveModelPath,
  resolveHearLanguage,
  resolveHearCapture,
  resolveHearPrompt,
  resolveHearInputPath,
  resolveHearBackend,
  resolveHearHost,
  resolveHearWhisperxModel
};
