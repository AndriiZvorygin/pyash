import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";
import { emitExchangeSentence, recordArtifact } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { canonicalJsonStringify, metadataPathForOutput, resolveOutputPath, sha256 } from "./piper_utils.mjs";
import { resolveConfigBool, resolveConfigNum, resolveConfigText } from "../configure/env.mjs";
import { enforceAutoDischarge } from "../motor/provider_auto_discharge.mjs";
import { buildPromptifyPacket, callPromptMind } from "../../command/itinerary_promptify.mjs";

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

function resolveWorkflowDefault({ rememberFn = remember } = {}) {
  return resolveConfigText("say workflow default", { rememberFn }) || "andrii_teaching_voice_qwen3_TTS";
}

function resolveToneDefault({ rememberFn = remember } = {}) {
  return resolveConfigText("qwen say tone default", { rememberFn }) || "speak as a compassionate teacher";
}

function resolveToneStrategy({ rememberFn = remember } = {}) {
  const mode = String(resolveConfigText("qwen say tone strategy", { rememberFn }) || "heuristic").trim().toLowerCase();
  return mode || "heuristic";
}

function resolveTonePromptifyHost({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("qwen say tone host", { rememberFn }) ||
    resolveConfigText("mind host", { rememberFn }) ||
    process.env.OLLAMA_HOST ||
    "http://localhost:11434"
  );
}

function resolveTonePromptifyModel({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("qwen say tone model", { rememberFn }) ||
    process.env.PYA_MIND_MODEL ||
    "qwen3-vl:8b-instruct"
  );
}

function resolveTonePromptifySystem({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("qwen say tone promptify system prompt", { rememberFn }) ||
    "You are a narration tone planner for text to speech. Return only one short speaking instruction for the current sentence."
  );
}

function resolveTonePromptifyInstruction({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("qwen say tone promptify instruction", { rememberFn }) ||
    "Choose the best speaking instruction for this sentence. Return only concise tone text like: professional tone, urgent tone, reflective tone, warm encouraging tone."
  );
}

function resolvePostProcessEnabled({ rememberFn = remember } = {}) {
  const configured = resolveConfigBool("qwen say post process", { rememberFn });
  return configured !== false;
}

function resolvePostProcessFilter({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("qwen say post process filter", { rememberFn }) ||
    "highpass=f=60,acompressor=threshold=-20dB:ratio=3,alimiter=limit=-2dB"
  );
}

function resolveConcatGapSeconds({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say concat gap seconds", { rememberFn });
  if (!Number.isFinite(configured)) return 0.06;
  return Math.max(0, Math.min(0.25, Number(configured)));
}

async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkflowAndTone(
  sentence,
  { rememberFn = remember, pathExistsFn = pathExists } = {}
) {
  const workflowRoot = resolveWorkflowRoot({ rememberFn });
  const workflowDefault = resolveWorkflowDefault({ rememberFn });
  const toneDefault = resolveToneDefault({ rememberFn });
  const explicit = String(sentence?.as?.text ?? "").trim();
  if (!explicit) {
    return {
      workflowRoot,
      workflowName: workflowDefault,
      toneOverride: "",
      toneDefault
    };
  }

  const workflowCandidate = explicit.replace(/\.json$/i, "").trim();
  const workflowPaths = [
    path.resolve(workflowRoot, "comfyui", `${workflowCandidate}.json`),
    path.resolve(workflowRoot, `${workflowCandidate}.json`)
  ];
  for (const workflowPath of workflowPaths) {
    if (await pathExistsFn(workflowPath)) {
      return {
        workflowRoot,
        workflowName: workflowCandidate,
        toneOverride: "",
        toneDefault
      };
    }
  }

  return {
    workflowRoot,
    workflowName: workflowDefault,
    toneOverride: explicit,
    toneDefault
  };
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

export function splitQwenSayTextChunks(text = "", { forceSentenceChunks = false } = {}) {
  const source = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];
  const words = countWords(source);
  const shouldChunk = source.length > 800 || words > 130;
  if (!forceSentenceChunks && !shouldChunk) return [source];

  const paragraphs = source
    .split(/\n\s*\n+/)
    .map(p => String(p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const units = paragraphs.length ? paragraphs : [source.replace(/\s+/g, " ").trim()];

  const chunks = [];
  for (const paragraph of units) {
    const sentences = splitSentences(paragraph);
    if (!sentences.length) {
      chunks.push(...splitByWordBudget(paragraph, 90));
      continue;
    }
    for (const sentence of sentences) {
      if (countWords(sentence) > 95) {
        chunks.push(...splitByWordBudget(sentence, 90));
      } else {
        const chunk = String(sentence ?? "").replace(/\s+/g, " ").trim();
        if (chunk) chunks.push(chunk);
      }
    }
  }

  return chunks.length ? chunks : [source];
}

function inferChunkTone(chunk = "", fallback = "") {
  const text = String(chunk ?? "");
  if (!text.trim()) return fallback;
  if (/[?]/.test(text)) return "speak in a curious, professional tone";
  if (/\b(crisis|collapse|warning|debt|foreclosure|danger|harm|desperate|loss)\b/i.test(text)) {
    return "speak in an urgent, serious tone";
  }
  if (/\b(restore|build|hope|future|solution|reform|can|together|opportunity|thrive)\b/i.test(text)) {
    return "speak in an optimistic, confident tone";
  }
  return fallback;
}

function resolveChunkInstructs(chunks = [], { toneOverride = "", toneDefault = "" } = {}) {
  const override = String(toneOverride ?? "").trim();
  if (override) return chunks.map(() => override);
  return chunks.map((chunk) => inferChunkTone(chunk, toneDefault));
}

function normalizeToneInstruction(value = "", fallback = "") {
  const tone = String(value ?? "").replace(/[`"'*]/g, "").replace(/\s+/g, " ").trim();
  if (tone) return tone.slice(0, 140);
  return String(fallback ?? "").trim();
}

async function promptifyToneInstructs(
  chunks = [],
  {
    rememberFn = remember,
    toneDefault = ""
  } = {}
) {
  const host = resolveTonePromptifyHost({ rememberFn });
  const model = resolveTonePromptifyModel({ rememberFn });
  const systemPrompt = resolveTonePromptifySystem({ rememberFn });
  const instruction = resolveTonePromptifyInstruction({ rememberFn });
  const cuts = chunks.map((chunk, index) => ({ index, obText: String(chunk ?? "") }));
  const fullScript = chunks.map(chunk => String(chunk ?? "").trim()).filter(Boolean).join(" ");
  const previousPrompts = [];
  const tones = [];
  for (let i = 0; i < cuts.length; i += 1) {
    const index = i + 1;
    const packet = buildPromptifyPacket({
      cuts,
      index: i,
      instruction,
      fullScript,
      previousPrompts: previousPrompts.slice(-2)
    });
    emitExchangeSentence({
      mood: "do",
      su: { name: `qwen say tone request ${String(index).padStart(3, "0")}` },
      ob: { text: packet },
      fromtext: { text: systemPrompt },
      fromstate: { text: host },
      as: { text: model },
      by: { num: index },
      be: "promptify"
    });
    const rawTone = await callPromptMind({
      host,
      model,
      systemPrompt,
      cutText: packet
    });
    const tone = normalizeToneInstruction(rawTone, toneDefault);
    emitExchangeSentence({
      mood: "ya",
      su: { name: `qwen say tone result ${String(index).padStart(3, "0")}` },
      ob: { text: String(rawTone ?? "") || tone },
      fromstate: { text: host },
      as: { text: model },
      by: { num: index },
      be: "promptify"
    });
    tones.push(tone);
    previousPrompts.push(tone);
  }
  return tones;
}

async function planChunkInstructs(
  chunks = [],
  {
    rememberFn = remember,
    toneOverride = "",
    toneDefault = "",
    toneStrategy = "heuristic"
  } = {}
) {
  const override = String(toneOverride ?? "").trim();
  if (override) {
    return { instructs: chunks.map(() => override), strategy: "override" };
  }

  const mode = String(toneStrategy ?? "").trim().toLowerCase();
  if (mode === "promptify") {
    try {
      const instructs = await promptifyToneInstructs(chunks, {
        rememberFn,
        toneDefault
      });
      if (instructs.length === chunks.length && instructs.every(value => String(value ?? "").trim())) {
        return { instructs, strategy: "promptify" };
      }
    } catch {
      // fallback below
    }
    return {
      instructs: chunks.map(() => toneDefault),
      strategy: "default-fallback"
    };
  }

  return {
    instructs: resolveChunkInstructs(chunks, { toneOverride: "", toneDefault }),
    strategy: "heuristic"
  };
}

async function runQwenSay({ text, instruct = "", workflowName, workflowRoot, host, output }) {
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
  if (String(instruct ?? "").trim()) {
    args.push("--instruct", String(instruct).trim());
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
      else reject(new Error(stderr.trim() || `qwen say defective: status=${code}`));
    });
  });
}

async function postProcessQwenSayAudio({ input, output, filter }) {
  const args = [
    "-y",
    "-i",
    input,
    "-af",
    String(filter ?? ""),
    output
  ];
  return new Promise((resolve, reject) => {
    let stderr = "";
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
        reject(new Error(`qwen say defective: post process failed status=${code}: ${clipped}`));
      }
    });
  });
}

async function probeAudioFormat(filename = "") {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=sample_rate,channels",
      "-of", "default=noprint_wrappers=1:nokey=1",
      String(filename ?? "")
    ], { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk) => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", () => resolve({ sampleRate: 24000, channels: 1 }));
    proc.on("close", (code) => {
      if (code !== 0) {
        void stderr;
        resolve({ sampleRate: 24000, channels: 1 });
        return;
      }
      const lines = String(stdout ?? "").split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
      const sampleRate = Number(lines[0]);
      const channels = Number(lines[1]);
      resolve({
        sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : 24000,
        channels: Number.isFinite(channels) && channels > 0 ? Math.floor(channels) : 1
      });
    });
  });
}

function resolveChannelLayout(channels = 1) {
  if (channels <= 1) return "mono";
  if (channels === 2) return "stereo";
  return "stereo";
}

async function writeSilenceWav({ output, sampleRate = 24000, channels = 1, seconds = 0.06 }) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const proc = spawn("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", `anullsrc=r=${Math.max(8000, Math.floor(sampleRate))}:cl=${resolveChannelLayout(channels)}`,
      "-t", String(Math.max(0.005, seconds)),
      "-c:a", "pcm_s16le",
      output
    ], { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
        reject(new Error(`qwen say defective: silence generation failed status=${code}: ${clipped}`));
      }
    });
  });
}

async function concatAudioChunks({ inputs = [], output, gapSeconds = 0.06 }) {
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
    const gap = Number(gapSeconds);
    const useGap = Number.isFinite(gap) && gap > 0 && inputs.length > 1;
    let gapFile = "";
    if (useGap) {
      const format = await probeAudioFormat(inputs[0]);
      gapFile = path.join(tempDir, "gap.wav");
      await writeSilenceWav({
        output: gapFile,
        sampleRate: format.sampleRate,
        channels: format.channels,
        seconds: gap
      });
    }
    const lines = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const filename = inputs[i];
      lines.push(`file '${path.resolve(String(filename ?? "")).replace(/'/g, "'\\''")}'`);
      if (gapFile && i < inputs.length - 1) {
        lines.push(`file '${path.resolve(gapFile).replace(/'/g, "'\\''")}'`);
      }
    }
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
    concatAudioFn = concatAudioChunks,
    pathExistsFn = pathExists,
    postProcessFn = postProcessQwenSayAudio,
    planChunkInstructsFn = planChunkInstructs
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
  const { workflowName, workflowRoot, toneDefault, toneOverride } = await resolveWorkflowAndTone(sentence, { rememberFn, pathExistsFn });
  const host = resolveHost({ rememberFn });
  const toneStrategy = resolveToneStrategy({ rememberFn });
  const forceSentenceChunks = !String(toneOverride ?? "").trim() && toneStrategy === "promptify";
  const chunks = splitQwenSayTextChunks(text, { forceSentenceChunks });
  const tonePlan = await planChunkInstructsFn(chunks, {
    rememberFn,
    toneOverride,
    toneDefault,
    toneStrategy
  });
  const chunkInstructs = Array.isArray(tonePlan?.instructs) && tonePlan.instructs.length === chunks.length
    ? tonePlan.instructs
    : resolveChunkInstructs(chunks, { toneDefault, toneOverride });
  const toneStrategyResolved = String(tonePlan?.strategy ?? "").trim() || (toneOverride ? "override" : toneStrategy);
  const postProcessEnabled = resolvePostProcessEnabled({ rememberFn });
  const postProcessFilter = resolvePostProcessFilter({ rememberFn });
  const concatGapSeconds = resolveConcatGapSeconds({ rememberFn });
  let postProcessApplied = false;

  if (chunks.length <= 1) {
    await runSayFn({
      text: chunks[0] ?? text,
      instruct: chunkInstructs[0] ?? toneDefault,
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
          instruct: chunkInstructs[i] ?? toneDefault,
          workflowName,
          workflowRoot,
          host,
          output: chunkOutput
        });
        chunkFiles.push(chunkOutput);
      }
      await concatAudioFn({ inputs: chunkFiles, output: outputPath, gapSeconds: concatGapSeconds });
    } finally {
      await fs.rm(chunkDir, { recursive: true, force: true });
    }
  }

  if (postProcessEnabled && String(postProcessFilter ?? "").trim()) {
    const parsed = path.parse(outputPath);
    const cleanedPath = path.join(parsed.dir, `${parsed.name}.cleaned${parsed.ext || ".wav"}`);
    try {
      await postProcessFn({
        input: outputPath,
        output: cleanedPath,
        filter: postProcessFilter
      });
      await fs.rename(cleanedPath, outputPath);
      postProcessApplied = true;
    } catch {
      await fs.rm(cleanedPath, { force: true });
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
    chunks: chunks.length,
    concatGapSeconds: chunks.length > 1 ? concatGapSeconds : 0,
    tone: toneOverride || chunkInstructs[0] || toneDefault,
    toneStrategy: toneStrategyResolved,
    postProcess: postProcessEnabled,
    postProcessApplied,
    postProcessFilter
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
