import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { recordArtifact, getExchangeRunId } from "../bridge/exchange.mjs";
import { enforceAutoDischarge } from "../motor/provider_auto_discharge.mjs";
import { canonicalJsonStringify, metadataPathForOutput, sha256 } from "./piper_utils.mjs";

function renderValue(value = {}, { rememberFn = remember } = {}) {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.num === "number") return String(value.num);
  if (typeof value?.boolean === "boolean") return value.boolean ? "truth" : "lie";
  if (typeof value?.name === "string") {
    const fact = rememberFn(value.name);
    if (typeof fact?.ob?.text === "string") return fact.ob.text;
  }
  return "";
}

function resolveHost({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("music host", { rememberFn }) ||
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    "http://localhost:8188"
  );
}

function resolveWorkflowRoot({ rememberFn = remember } = {}) {
  return resolveConfigText("music workflow root", { rememberFn }) || "./music/";
}

function resolveWorkflowDefault({ rememberFn = remember } = {}) {
  return resolveConfigText("music workflow default", { rememberFn }) || "audio_ace_step_1_5_checkpoint";
}

function resolveWorkflowName(sentence, { rememberFn = remember } = {}) {
  if (typeof sentence?.as?.text === "string" && sentence.as.text.trim()) return sentence.as.text.trim();
  return resolveWorkflowDefault({ rememberFn });
}

function defaultOutputPath() {
  const runId = String(getExchangeRunId?.() ?? "").trim();
  if (runId) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const rand = Math.random().toString(16).slice(2, 8).padEnd(6, "0").slice(0, 6);
    return path.join("artifacts", runId, `music-${stamp}-${rand}.opus`);
  }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).padEnd(6, "0").slice(0, 6);
  return path.join("artifacts", "music", `music-${stamp}-${rand}.opus`);
}

function resolveMapPrimitive(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  if (typeof entry.text === "string") return entry.text;
  if (typeof entry.num === "number") return entry.num;
  if (typeof entry.boolean === "boolean") return entry.boolean;
  if (typeof entry.ob?.text === "string") return entry.ob.text;
  if (typeof entry.ob?.num === "number") return entry.ob.num;
  if (typeof entry.ob?.boolean === "boolean") return entry.ob.boolean;
  return undefined;
}

function resolveOptionsMap(sentence, { rememberFn = remember } = {}) {
  const withName = String(sentence?.with?.name ?? "").trim();
  if (!withName) return {};
  const fact = rememberFn?.(withName);
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") {
    throwErrorSentence({
      name: "music say defective",
      message: "music say defective: with name map missing",
      from: { name: "music say" },
      raw: { withName }
    });
  }
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    const primitive = resolveMapPrimitive(value);
    if (primitive !== undefined) out[key] = primitive;
  }
  return out;
}

async function runMusic({
  lyrics,
  style = "",
  workflowName,
  workflowRoot,
  host,
  output,
  options = {}
}) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../command/music_comfyui_runner.mjs");
  const args = [
    runner,
    "--lyrics",
    String(lyrics ?? ""),
    "--workflow-name",
    workflowName,
    "--workflow-root",
    workflowRoot,
    "--host",
    host,
    "--output",
    output
  ];
  if (String(style ?? "").trim()) args.push("--style", String(style).trim());
  if (options && typeof options === "object" && Object.keys(options).length) {
    args.push("--options-json", JSON.stringify(options));
  }
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim() });
      else reject(new Error(stderr.trim() || `music say defective: status=${code}`));
    });
  });
}

export async function musicSay(sentence, { remember: rememberFn = remember, runMusicFn = runMusic } = {}) {
  const lyrics = String(renderValue(sentence?.ob ?? {}, { rememberFn }) ?? "").trim();
  if (!lyrics) {
    throwErrorSentence({
      name: "music say defective",
      message: "music say defective: missing lyrics",
      from: { name: "music say" },
      raw: { sentence }
    });
  }
  const style = String(renderValue(sentence?.fromtext ?? {}, { rememberFn }) ?? "").trim();
  const workflowName = resolveWorkflowName(sentence, { rememberFn });
  const workflowRoot = resolveWorkflowRoot({ rememberFn });
  const host = resolveHost({ rememberFn });
  const outputPath = String(sentence?.to?.filename ?? "").trim() || defaultOutputPath();
  const options = resolveOptionsMap(sentence, { rememberFn });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await enforceAutoDischarge({ activatingClass: "qwen say", rememberFn });
  await runMusicFn({
    lyrics,
    style,
    workflowName,
    workflowRoot,
    host,
    output: outputPath,
    options
  });

  const audioBytes = await fs.readFile(outputPath);
  const producer = String(sentence?.su?.name ?? "music say");
  const artifact = recordArtifact({
    locator: outputPath,
    producer,
    bytes: audioBytes,
    kind: "say"
  });

  const metadataPath = metadataPathForOutput(outputPath);
  const inputBytes = Buffer.from(`${style}\n${lyrics}`, "utf8");
  const metadata = {
    kind: "say",
    backend: "comfyui",
    workflow: workflowName,
    host,
    inputSha256: sha256(inputBytes),
    outputSha256: sha256(audioBytes),
    format: "opus",
    streaming: false,
    options
  };
  const metadataText = canonicalJsonStringify(metadata);
  await fs.writeFile(metadataPath, metadataText, "utf8");
  recordArtifact({
    locator: metadataPath,
    producer,
    bytes: Buffer.from(metadataText, "utf8"),
    kind: "metadata"
  });

  if (artifact?.su?.name) return { ob: { name: artifact.su.name }, be: "say" };
  return { ob: { text: outputPath }, be: "say" };
}

export default musicSay;

export const signatures = [
  { signatureWords: ["be", "music say", "ob", "text"], handler: musicSay },
  { signatureWords: ["be", "music say", "ob", "name", "text"], handler: musicSay },
  { signatureWords: ["be", "music say", "ob", "text", "to", "filename"], handler: musicSay },
  { signatureWords: ["be", "music say", "ob", "name", "text", "to", "filename"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "text"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "name", "text"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "text", "to", "filename"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "name", "text", "to", "filename"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "text", "with", "name", "map"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "name", "text", "with", "name", "map"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "text", "with", "name", "map", "to", "filename"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "name", "text", "with", "name", "map", "to", "filename"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "text", "to", "filename", "with", "name", "map"], handler: musicSay },
  { signatureWords: ["be", "music say", "fromtext", "text", "ob", "name", "text", "to", "filename", "with", "name", "map"], handler: musicSay }
];
