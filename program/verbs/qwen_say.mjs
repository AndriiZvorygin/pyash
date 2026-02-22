import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";
import { recordArtifact } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { canonicalJsonStringify, metadataPathForOutput, resolveOutputPath, sha256 } from "./piper_utils.mjs";
import { resolveConfigText } from "../configure/env.mjs";
import { enforceAutoDischarge } from "../motor/provider_auto_discharge.mjs";

function resolveWorkflowName(sentence, { rememberFn = remember } = {}) {
  const explicit = String(sentence?.as?.text ?? "").trim();
  if (explicit) return explicit;
  return resolveConfigText("say workflow default", { rememberFn }) || "andrii_voice_qwen3_TTS";
}

function resolveHost({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    "http://localhost:8188"
  );
}

function resolveWorkflowRoot({ rememberFn = remember } = {}) {
  return resolveConfigText("say workflow root", { rememberFn }) || "./say/refinery/";
}

async function runQwenSay({ text, workflowName, workflowRoot, host, output }) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../command/say_comfyui_runner.mjs");
  const args = [
    runner,
    "--text",
    String(text ?? ""),
    "--workflow-name",
    workflowName,
    "--workflow-root",
    workflowRoot,
    "--host",
    host,
    "--output",
    output
  ];
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim() });
      else reject(new Error(stderr.trim() || `qwen say defective: status=${code}`));
    });
  });
}

export async function qwenSay(sentence, { remember: rememberFn = remember } = {}) {
  await enforceAutoDischarge({ activatingClass: "draw", rememberFn });
  const text = String(renderSayValue(sentence.ob ?? {}, { rememberFn }) ?? "");
  if (!text.trim()) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: missing text",
      from: { name: "qwen say" },
      raw: { sentence }
    });
  }

  const outputPath = resolveOutputPath(sentence, { ext: ".wav" });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const workflowName = resolveWorkflowName(sentence, { rememberFn });
  const workflowRoot = resolveWorkflowRoot({ rememberFn });
  const host = resolveHost({ rememberFn });

  await runQwenSay({
    text,
    workflowName,
    workflowRoot,
    host,
    output: outputPath
  });

  const audioBytes = await fs.readFile(outputPath);
  const producer = String(sentence?.su?.name ?? "qwen say");
  const artifact = recordArtifact({
    locator: outputPath,
    producer,
    bytes: audioBytes,
    kind: "say"
  });

  const metadataPath = metadataPathForOutput(outputPath);
  const inputBytes = Buffer.from(text, "utf8");
  const metadata = {
    kind: "say",
    backend: "comfyui",
    workflow: workflowName,
    inputSha256: sha256(inputBytes),
    outputSha256: sha256(audioBytes),
    format: "wav",
    streaming: false
  };
  const metadataText = canonicalJsonStringify(metadata);
  await fs.writeFile(metadataPath, metadataText, "utf8");
  recordArtifact({
    locator: metadataPath,
    producer,
    bytes: Buffer.from(metadataText, "utf8"),
    kind: "metadata"
  });

  if (artifact?.su?.name) {
    return { ob: { name: artifact.su.name }, be: "say" };
  }
  return { ob: { text: outputPath }, be: "say" };
}

export default qwenSay;

export const signatures = [
  { signatureWords: ["be", "qwen say", "ob", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "num"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "bool"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "hollow"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "num"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "bool"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "hollow"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "vec"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "vec"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "num", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "bool", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "hollow", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "num", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "bool", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "hollow", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "name", "vec", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "ob", "vec", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "name", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "name", "text", "to", "filename"], handler: qwenSay }
];
