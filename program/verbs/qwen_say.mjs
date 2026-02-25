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
import { resolveConfigBool, resolveConfigText } from "../configure/env.mjs";
import { parseItineraryPya } from "../../command/itinerary_io.mjs";

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

function quotePyashText(value) {
  return JSON.stringify(String(value ?? ""));
}

function renderSayPromptSeries(chunks = [], instructs = []) {
  const lines = ["su name section say prompts be series def"];
  for (let i = 0; i < chunks.length; i += 1) {
    const idx = String(i + 1).padStart(3, "0");
    const since = Number(i).toFixed(3);
    const until = Number(i + 1).toFixed(3);
    const chunkText = quotePyashText(chunks[i] ?? "");
    const instructText = quotePyashText(instructs[i] ?? "");
    lines.push(`su name cut ${idx} since num ${since} until num ${until} ob text ${chunkText} fromtext text ${instructText} ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

function resolveSayPromptSeriesPath(outputPath = "") {
  return path.join(path.dirname(String(outputPath ?? "")), "section-say-prompts.series.pya");
}

async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

function resolveFilenameFromCase(value = {}, rememberFn = remember) {
  if (typeof value?.filename === "string" && value.filename.trim()) return value.filename.trim();
  const fromName = String(value?.name ?? "").trim();
  if (!fromName) return "";
  const fact = rememberFn?.(fromName);
  return String(fact?.ob?.filename ?? "").trim();
}

async function resolveToneManifestInstructs(sentence, { rememberFn = remember } = {}) {
  const filename = resolveFilenameFromCase(sentence?.from, rememberFn);
  if (!filename) return [];
  try {
    const text = await fs.readFile(filename, "utf8");
    const parsed = parseItineraryPya(text);
    const cuts = Array.isArray(parsed?.cuts) ? parsed.cuts : [];
    return cuts.map((cut) => String(cut?.obText ?? "").trim()).filter(Boolean);
  } catch {
    return [];
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

function hasTerminalSentencePunctuation(text = "") {
  return /[.!?…]["')\]]*$/u.test(String(text ?? "").trim());
}

export function normalizeQwenSayChunkText(text = "") {
  const chunk = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!chunk) return "";
  if (hasTerminalSentencePunctuation(chunk)) return `${chunk}.`;
  return `${chunk}..`;
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
      chunks.push(...splitByWordBudget(paragraph, 90).map(normalizeQwenSayChunkText).filter(Boolean));
      continue;
    }
    for (const sentence of sentences) {
      if (countWords(sentence) > 95) {
        chunks.push(...splitByWordBudget(sentence, 90).map(normalizeQwenSayChunkText).filter(Boolean));
      } else {
        const chunk = normalizeQwenSayChunkText(sentence);
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
    concatAudioFn = concatAudioChunks,
    pathExistsFn = pathExists,
    postProcessFn = postProcessQwenSayAudio,
    planChunkInstructsFn = planChunkInstructs
  } = {}
) {
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
  const manifestInstructs = await resolveToneManifestInstructs(sentence, { rememberFn });
  const chunks = splitQwenSayTextChunks(text, { forceSentenceChunks: manifestInstructs.length > 0 });
  let chunkInstructs = [];
  let toneStrategyResolved = "";
  if (String(toneOverride ?? "").trim()) {
    chunkInstructs = chunks.map(() => String(toneOverride).trim());
    toneStrategyResolved = "override";
  } else if (manifestInstructs.length > 0) {
    chunkInstructs = chunks.map((chunk, i) => {
      const fromManifest = normalizeToneInstruction(manifestInstructs[i] ?? "", toneDefault);
      if (fromManifest) return fromManifest;
      return inferChunkTone(chunk, toneDefault);
    });
    toneStrategyResolved = manifestInstructs.length === chunks.length ? "manifest" : "manifest-fallback";
  } else {
    const tonePlan = await planChunkInstructsFn(chunks, {
      rememberFn,
      toneOverride,
      toneDefault,
      toneStrategy
    });
    chunkInstructs = Array.isArray(tonePlan?.instructs) && tonePlan.instructs.length === chunks.length
      ? tonePlan.instructs
      : resolveChunkInstructs(chunks, { toneDefault, toneOverride });
    toneStrategyResolved = String(tonePlan?.strategy ?? "").trim() || toneStrategy;
  }
  const postProcessEnabled = resolvePostProcessEnabled({ rememberFn });
  const postProcessFilter = resolvePostProcessFilter({ rememberFn });
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
          text: normalizeQwenSayChunkText(chunkText),
          instruct: chunkInstructs[i] ?? toneDefault,
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

  const promptSeriesPath = resolveSayPromptSeriesPath(outputPath);
  const promptSeriesText = renderSayPromptSeries(chunks, chunkInstructs);
  await fs.writeFile(promptSeriesPath, promptSeriesText, "utf8");
  recordArtifact({
    locator: promptSeriesPath,
    producer: `${producer} prompts`,
    bytes: Buffer.from(promptSeriesText, "utf8"),
    kind: "series"
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
  { signatureWords: ["be", "qwen say", "from", "filename", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "from", "filename", "ob", "name", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "name", "text"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "as", "text", "ob", "name", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "from", "filename", "as", "text", "ob", "text", "to", "filename"], handler: qwenSay },
  { signatureWords: ["be", "qwen say", "from", "filename", "as", "text", "ob", "name", "text", "to", "filename"], handler: qwenSay }
];
