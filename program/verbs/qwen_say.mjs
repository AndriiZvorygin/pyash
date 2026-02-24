import fs from "node:fs/promises";
import os from "node:os";
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
  return resolveConfigText("say workflow default", { rememberFn }) || "andrii_teaching_voice_qwen3_TTS";
}

function resolveHost({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    "http://localhost:8188"
  );
}

function resolveWorkflowRoot({ rememberFn = remember } = {}) {
  return resolveConfigText("say workflow root", { rememberFn }) || "./say/";
}

function countWords(text = "") {
  const matches = String(text ?? "").trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function splitSentences(paragraph = "") {
  const normalized = String(paragraph ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g);
  const out = (matches ?? [normalized]).map(s => String(s ?? "").trim()).filter(Boolean);
  return out.length ? out : [normalized];
}

function splitByWordBudget(text = "", maxWords = 90) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords).join(" ").trim();
    if (chunk) out.push(chunk);
  }
  return out;
}

export function splitQwenSayTextChunks(text = "") {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const words = countWords(source);
  const shouldChunk = source.length > 800 || words > 130;
  if (!shouldChunk) return [source];

  const paragraphs = source
    .split(/\n\s*\n+/)
    .map(p => String(p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const units = paragraphs.length ? paragraphs : [source.replace(/\s+/g, " ").trim()];

  const chunks = [];
  for (const paragraph of units) {
    const sentences = splitSentences(paragraph);
    if (sentences.length <= 4) {
      if (countWords(paragraph) > 95) {
        chunks.push(...splitByWordBudget(paragraph, 90));
      } else {
        chunks.push(paragraph);
      }
      continue;
    }

    let group = [];
    let groupWords = 0;
    for (const sentence of sentences) {
      group.push(sentence);
      groupWords += countWords(sentence);
      const flushByCount = group.length >= 4;
      const flushBySize = group.length >= 3 && groupWords >= 65;
      if (flushByCount || flushBySize) {
        const chunk = group.join(" ").replace(/\s+/g, " ").trim();
        if (chunk) chunks.push(chunk);
        group = [];
        groupWords = 0;
      }
    }
    if (group.length) {
      const chunk = group.join(" ").replace(/\s+/g, " ").trim();
      if (chunk) chunks.push(chunk);
    }
  }

  return chunks.length ? chunks : [source];
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

async function concatAudioChunks({ inputs = [], output }) {
  if (!Array.isArray(inputs) || !inputs.length) {
    throw new Error("qwen say defective: no chunk audio to concatenate");
  }
  if (inputs.length === 1) {
    await fs.copyFile(inputs[0], output);
    return;
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-say-concat-"));
  const listFile = path.join(tempDir, "list.txt");
  try {
    const lines = inputs.map((filename) => `file '${path.resolve(String(filename ?? "")).replace(/'/g, "'\\''")}'`);
    await fs.writeFile(listFile, `${lines.join("\n")}\n`, "utf8");
    await new Promise((resolve, reject) => {
      let stderr = "";
      const proc = spawn("ffmpeg", [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c:a", "pcm_s16le",
        output
      ], { stdio: ["ignore", "ignore", "pipe"] });
      proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else {
          const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
          reject(new Error(`qwen say defective: concat failed status=${code}: ${clipped}`));
        }
      });
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function qwenSay(
  sentence,
  {
    remember: rememberFn = remember,
    runSayFn = runQwenSay,
    concatAudioFn = concatAudioChunks
  } = {}
) {
  await enforceAutoDischarge({ activatingClass: "qwen say", rememberFn });
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
  const chunks = splitQwenSayTextChunks(text);

  if (chunks.length <= 1) {
    await runSayFn({
      text: chunks[0] ?? text,
      workflowName,
      workflowRoot,
      host,
      output: outputPath
    });
  } else {
    const chunkDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-say-chunks-"));
    const chunkFiles = [];
    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunkText = chunks[i];
        const chunkOutput = path.join(chunkDir, `chunk-${String(i + 1).padStart(3, "0")}.wav`);
        await runSayFn({
          text: chunkText,
          workflowName,
          workflowRoot,
          host,
          output: chunkOutput
        });
        chunkFiles.push(chunkOutput);
      }
      await concatAudioFn({ inputs: chunkFiles, output: outputPath });
    } finally {
      await fs.rm(chunkDir, { recursive: true, force: true });
    }
  }

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
    streaming: false,
    chunks: chunks.length
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
