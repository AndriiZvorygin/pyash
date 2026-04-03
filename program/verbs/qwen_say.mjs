import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";

import { remember } from "../remember/index.mjs";
import { renderSayValue } from "./say.mjs";
import { emitExchangeSentence, recordArtifact } from "../bridge/exchange.mjs";
import { throwErrorSentence } from "../error.mjs";
import { canonicalJsonStringify, metadataPathForOutput, resolveOutputPath, sha256 } from "./piper_utils.mjs";
import { resolveConfigBool, resolveConfigMapText, resolveConfigNum, resolveConfigText } from "../configure/env.mjs";
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

function resolveKeepChunkArtifacts({ rememberFn = remember } = {}) {
  return resolveConfigBool("qwen say keep chunks", { rememberFn }) === true;
}

function resolveClipVerifyEnabled({ rememberFn = remember } = {}) {
  return resolveConfigBool("qwen say clip verify enabled", { rememberFn }) === true;
}

function resolveClipVerifyAllChunks({ rememberFn = remember } = {}) {
  const configured = resolveConfigBool("qwen say clip verify all chunks", { rememberFn });
  if (configured === false) return false;
  return true;
}

function resolveClipVerifyMaxRetries({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify max retries", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Math.trunc(configured);
  return 3;
}

function resolveClipVerifyTailWords({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify tail words", { rememberFn });
  if (Number.isFinite(configured) && configured >= 1) return Math.trunc(configured);
  return 2;
}

function resolveClipVerifyWindowMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify window ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 60) return Number(configured);
  return 120;
}

function resolveClipVerifyPeakDb({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify peak db", { rememberFn });
  if (Number.isFinite(configured)) return Number(configured);
  return -12;
}

function resolveClipVerifyDeltaDb({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify delta db", { rememberFn });
  if (Number.isFinite(configured)) return Number(configured);
  return 1;
}

function resolveClipVerifyMinTailMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say clip verify min tail ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Number(configured);
  return 40;
}

function resolveTailPadMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say tail pad ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Number(configured);
  return 160;
}

function resolveChunkTailPadMs({ rememberFn = remember } = {}) {
  const configured = resolveConfigNum("qwen say chunk tail pad ms", { rememberFn });
  if (Number.isFinite(configured) && configured >= 0) return Number(configured);
  return 120;
}

function resolveTailPauseMarkup({ rememberFn = remember } = {}) {
  return String(resolveConfigText("qwen say tail pause markup", { rememberFn }) ?? "").trim();
}

function resolveClipVerifyHost({ rememberFn = remember } = {}) {
  return (
    resolveConfigText("hear qwen host", { rememberFn }) ||
    resolveConfigText("say host", { rememberFn }) ||
    resolveConfigText("draw host", { rememberFn }) ||
    "http://localhost:8188"
  );
}

function resolveClipVerifyWorkflowRoot({ rememberFn = remember } = {}) {
  return resolveConfigText("hear workflow root", { rememberFn }) || "./hear/";
}

function resolveClipVerifyWorkflowName({ rememberFn = remember } = {}) {
  return resolveConfigText("hear workflow default", { rememberFn }) || "qwen3-asr-timestamps-attn2";
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

function hasSpeakableContent(text = "") {
  return /[\p{L}\p{N}]/u.test(String(text ?? ""));
}

function splitSentences(paragraph = "") {
  const normalized = String(paragraph ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const protectedRefs = normalized
    .replace(/(\d)\s*\.\s*(\d)/g, "$1§$2")
    .replace(/(\d)\s*:\s*(\d)/g, "$1§$2")
    // Keep common initialism dots (e.g., A.D., U.S.) from being treated as sentence boundaries.
    .replace(/\b((?:[A-Za-z]\.){2,})/g, (m) => m.replaceAll(".", "§"));
  const matches = protectedRefs.match(/[^.!?]+(?:[.!?]+(?:["'”’)\]]+)?(?=\s|$)|$)/g);
  const out = (matches ?? [protectedRefs])
    .map(s => String(s ?? "").replace(/§/g, ".").trim())
    .filter((entry) => /[\p{L}\p{N}]/u.test(entry))
    .filter(Boolean);
  return out.length ? out : [normalized];
}

function wordTokens(text = "") {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function assertChunkIntegrity(text = "", chunks = []) {
  const source = wordTokens(text);
  const merged = wordTokens((Array.isArray(chunks) ? chunks : []).join(" "));
  if (!source.length || !merged.length) return;
  const sourceHead = source.slice(0, 6).join(" ");
  const mergedHead = merged.slice(0, 6).join(" ");
  const coverage = merged.length / Math.max(1, source.length);
  if (mergedHead !== sourceHead || coverage < 0.9) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: chunk integrity mismatch",
      from: { name: "qwen say" },
      raw: {
        sourceHead,
        mergedHead,
        sourceWords: source.length,
        mergedWords: merged.length,
        coverage
      }
    });
  }
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

function numberToWords(numRaw) {
  const num = Number(numRaw);
  if (!Number.isFinite(num) || num < 0) return String(numRaw ?? "");
  const n = Math.trunc(num);
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 10) return ones[n];
  if (n < 20) return teens[n - 10];
  if (n < 100) {
    const t = Math.trunc(n / 10);
    const o = n % 10;
    return o ? `${tens[t]} ${ones[o]}` : tens[t];
  }
  if (n < 1000) {
    const h = Math.trunc(n / 100);
    const rest = n % 100;
    return rest ? `${ones[h]} hundred ${numberToWords(rest)}` : `${ones[h]} hundred`;
  }
  if (n < 1000000) {
    const th = Math.trunc(n / 1000);
    const rest = n % 1000;
    return rest ? `${numberToWords(th)} thousand ${numberToWords(rest)}` : `${numberToWords(th)} thousand`;
  }
  return String(n);
}

function twoDigitWords(num) {
  const n = Math.max(0, Math.trunc(Number(num) || 0));
  if (n < 10) return numberToWords(n);
  if (n < 20) return numberToWords(n);
  const tens = Math.trunc(n / 10) * 10;
  const ones = n % 10;
  if (!ones) return numberToWords(tens);
  return `${numberToWords(tens)}-${numberToWords(ones)}`;
}

function yearToWords(valueRaw) {
  const value = Math.trunc(Number(valueRaw));
  if (!Number.isFinite(value) || value < 100) return "";
  if (value >= 1000) {
    const high = Math.trunc(value / 100);
    const low = value % 100;
    if (low === 0) return `${twoDigitWords(high)}-hundred`;
    return `${twoDigitWords(high)}-${twoDigitWords(low)}`;
  }
  const high = Math.trunc(value / 100);
  const low = value % 100;
  if (!low) return `${numberToWords(high)}-hundred`;
  return `${numberToWords(high)}-${twoDigitWords(low)}`;
}

function integerToWordsHyphenated(valueRaw) {
  const value = Math.trunc(Number(valueRaw));
  if (!Number.isFinite(value) || value < 0) return String(valueRaw ?? "");
  if (value < 100) return twoDigitWords(value);
  const scales = [
    { size: 1000000000, name: "billion" },
    { size: 1000000, name: "million" },
    { size: 1000, name: "thousand" }
  ];
  for (const scale of scales) {
    if (value >= scale.size) {
      const high = Math.trunc(value / scale.size);
      const rem = value % scale.size;
      const left = integerToWordsHyphenated(high);
      if (!rem) return `${left}-${scale.name}`;
      return `${left}-${scale.name}-${integerToWordsHyphenated(rem)}`;
    }
  }
  const hundreds = Math.trunc(value / 100);
  const rem = value % 100;
  if (!rem) return `${numberToWords(hundreds)}-hundred`;
  return `${numberToWords(hundreds)}-hundred-${twoDigitWords(rem)}`;
}

export function normalizeQwenSayChunkText(text = "") {
  const chunk = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!chunk) return "";
  if (hasTerminalSentencePunctuation(chunk)) return `${chunk}.`;
  return `${chunk}..`;
}

function ensureTrailingDoublePeriod(text = "") {
  const chunk = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!chunk) return "";
  if (chunk.endsWith("..")) return chunk;
  if (chunk.endsWith(".")) return `${chunk}.`;
  return `${chunk}..`;
}

function applyTailPauseMarkup(text = "", markup = "") {
  const source = String(text ?? "").trim();
  const token = String(markup ?? "").trim();
  if (!source || !token) return source;
  if (source.includes(token)) return source;
  return `${source} ${token}`.trim();
}

function resolveQwenSaySanitizeMap({ rememberFn = remember } = {}) {
  return {
    percent: resolveConfigMapText("qwen say sanitize map", "percent", { rememberFn }) || "percent",
    referenceSeparator: resolveConfigMapText("qwen say sanitize map", "reference separator", { rememberFn }) || ".",
    ordinal1st: resolveConfigMapText("qwen say sanitize map", "ordinal 1st", { rememberFn }) || "first",
    ordinal2nd: resolveConfigMapText("qwen say sanitize map", "ordinal 2nd", { rememberFn }) || "second",
    ordinal3rd: resolveConfigMapText("qwen say sanitize map", "ordinal 3rd", { rememberFn }) || "third",
    pointWord: resolveConfigMapText("qwen say sanitize map", "point word", { rememberFn }) || "point"
  };
}

export function sanitizeQwenSayScriptText(text = "", mapConfig = {}) {
  const source = String(text ?? "");
  if (!source) return "";
  const percentWord = String(mapConfig?.percent ?? "percent").trim() || "percent";
  const referenceSeparatorRaw = String(mapConfig?.referenceSeparator ?? ".").trim() || ".";
  const referenceSeparator = /[A-Za-z]/.test(referenceSeparatorRaw) && !/\s/.test(referenceSeparatorRaw)
    ? ` ${referenceSeparatorRaw} `
    : referenceSeparatorRaw;
  const ordinal1st = String(mapConfig?.ordinal1st ?? "first").trim() || "first";
  const ordinal2nd = String(mapConfig?.ordinal2nd ?? "second").trim() || "second";
  const ordinal3rd = String(mapConfig?.ordinal3rd ?? "third").trim() || "third";
  const pointWord = String(mapConfig?.pointWord ?? "point").trim() || "point";

  let sanitized = source;
  sanitized = sanitized.replace(/\r\n/g, "\n").replace(/\n+/g, " ");
  sanitized = sanitized.replace(/\b1st\b/gi, ordinal1st);
  sanitized = sanitized.replace(/\b2nd\b/gi, ordinal2nd);
  sanitized = sanitized.replace(/\b3rd\b/gi, ordinal3rd);
  sanitized = sanitized.replace(/(\d+)\s*:\s*(\d+)/g, `$1${referenceSeparator}$2`);
  sanitized = sanitized.replace(/(\d+)\s*\.\s*(\d+)/g, `$1${referenceSeparator}$2`);
  sanitized = sanitized.replace(/(\d+)\.(\d+)/g, (_, left, right) => {
    return `${numberToWords(left)} ${pointWord} ${numberToWords(right)}`;
  });
  // Qwen TTS can clip lead-ins around colons; normalize remaining colons to commas.
  sanitized = sanitized.replace(/:/g, ",");
  sanitized = sanitized.replace(/%/g, ` ${percentWord}`);
  sanitized = sanitized.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, grouped) => {
    const numeric = Number(String(grouped).replace(/,/g, ""));
    return integerToWordsHyphenated(numeric);
  });
  sanitized = sanitized.replace(/\b(\d{3,4})\b/g, (_, yearToken) => yearToWords(yearToken));
  sanitized = sanitized.replace(/\b(\d+)\b/g, (_, digits) => integerToWordsHyphenated(digits));
  // Keep apostrophes and common punctuation; only normalize typographic variants.
  sanitized = sanitized.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  return sanitized;
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

async function runQwenSay({ text, instruct = "", workflowName, workflowRoot, host, output, returnTranscript = false, seed = null }) {
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
  if (returnTranscript) {
    args.push("--return-transcript", "true");
  }
  if (Number.isFinite(seed)) {
    args.push("--seed", String(Math.trunc(seed)));
  }
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        const trimmed = stdout.trim();
        const lines = trimmed.split(/\r?\n/u).filter(Boolean);
        const lastLine = lines.length ? lines[lines.length - 1] : "";
        let outputPath = trimmed;
        let transcript = "";
        let timestamps = "";
        try {
          const payload = JSON.parse(lastLine);
          if (payload && typeof payload === "object") {
            outputPath = String(payload.output ?? outputPath);
            transcript = String(payload.transcript ?? "");
            timestamps = String(payload.timestamps ?? "");
          }
        } catch {
          // Plain text mode is still supported for non-JSON callers.
        }
        resolve({ stdout: trimmed, outputPath, transcript, timestamps });
      }
      else reject(new Error(stderr.trim() || `qwen say defective: status=${code}`));
    });
  });
}

function randomChunkSeed() {
  // Qwen seed expects positive 32-bit-ish ints; keep within signed 31-bit range.
  return randomInt(1, 2147483647);
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

async function padAudioTail({ input = "", output = "", padMs = 0 } = {}) {
  const padSeconds = Math.max(0, Number(padMs) / 1000);
  if (!Number.isFinite(padSeconds) || padSeconds <= 0) {
    await fs.copyFile(input, output);
    return;
  }
  let duration = 0;
  try {
    duration = await probeDurationSeconds(input);
  } catch {
    // Test stubs may use non-audio bytes; keep original output in that case.
    await fs.copyFile(input, output);
    return;
  }
  const targetDuration = duration + padSeconds;
  return await new Promise((resolve, reject) => {
    let stderr = "";
    const proc = spawn("ffmpeg", [
      "-y",
      "-i",
      input,
      "-af",
      `apad=pad_dur=${padSeconds.toFixed(3)}`,
      "-t",
      targetDuration.toFixed(3),
      output
    ], { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
        reject(new Error(`qwen say defective: tail pad failed status=${code}: ${clipped}`));
      }
    });
  });
}

async function runToolWithStderr(tool, args = []) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(String(tool), args.map((entry) => String(entry)), { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
        reject(new Error(`qwen say defective: ${tool} failed status=${code}: ${clipped}`));
      }
    });
  });
}

async function probeDurationSeconds(input = "") {
  const { stdout } = await runToolWithStderr("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nokey=1:noprint_wrappers=1",
    input
  ]);
  const duration = Number(String(stdout ?? "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("qwen say defective: invalid chunk duration");
  }
  return duration;
}

function parseLastAstatsMetric(stderr = "", metric = "") {
  const rx = new RegExp(`${String(metric)}:\\s*(-?\\d+(?:\\.\\d+)?)`, "gu");
  let found = null;
  for (const match of String(stderr ?? "").matchAll(rx)) found = match;
  if (!found) throw new Error(`qwen say defective: astats metric missing ${metric}`);
  return Number(found[1]);
}

function normalizeWordToken(value = "") {
  return String(value ?? "").toLowerCase().replace(/[`'’]/gu, "").replace(/[^a-z0-9]+/gu, "");
}

function tokenizedWords(value = "") {
  return String(value ?? "")
    .split(/\s+/u)
    .map((token) => normalizeWordToken(token))
    .filter(Boolean);
}

function expectedTailTokens(text = "", count = 2) {
  const tokens = tokenizedWords(text);
  const n = Math.max(1, Number(count) || 2);
  return tokens.slice(-n);
}

function verifyAsrTailMatch({ expectedTail = [], transcript = "" } = {}) {
  const expected = Array.isArray(expectedTail) ? expectedTail.filter(Boolean) : [];
  if (!expected.length) return { pass: true, matched: 0, expected: 0 };
  const tokens = tokenizedWords(transcript);
  if (!tokens.length) return { pass: false, matched: 0, expected: expected.length };
  const searchFrom = Math.max(0, tokens.length - Math.max(16, expected.length * 8));
  let cursor = searchFrom;
  let matched = 0;
  for (const want of expected) {
    let found = -1;
    for (let i = cursor; i < tokens.length; i += 1) {
      if (tokens[i] === want) {
        found = i;
        break;
      }
    }
    if (found < 0) return { pass: false, matched, expected: expected.length };
    matched += 1;
    cursor = found + 1;
  }
  return { pass: true, matched, expected: expected.length };
}

function parseTimestampWordStream(timestampsRaw = "") {
  const text = String(timestampsRaw ?? "").trim();
  if (!text) return "";
  const jsonCandidates = [text];
  if (!text.startsWith("[") && !text.startsWith("{")) {
    const firstBracket = text.indexOf("[");
    if (firstBracket >= 0) jsonCandidates.push(text.slice(firstBracket));
    const firstBrace = text.indexOf("{");
    if (firstBrace >= 0) jsonCandidates.push(text.slice(firstBrace));
  }
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const queue = [parsed];
      const words = [];
      while (queue.length) {
        const cur = queue.shift();
        if (Array.isArray(cur)) {
          queue.push(...cur);
          continue;
        }
        if (cur && typeof cur === "object") {
          if (typeof cur.text === "string" && cur.text.trim()) words.push(cur.text.trim());
          for (const value of Object.values(cur)) queue.push(value);
        }
      }
      if (words.length) return words.join(" ");
    } catch {
      // ignore and use plain-line fallback
    }
  }
  const words = [];
  const lines = text.split(/\r?\n/u);
  for (const line of lines) {
    const match = /^\s*-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?\s*:\s*(.+)$/u.exec(line);
    if (!match) continue;
    const word = String(match[1] ?? "").trim();
    if (word) words.push(word);
  }
  return words.join(" ");
}

function verifyAsrTailMatchUsingTranscriptAndTimestamps({
  expectedTail = [],
  transcript = "",
  timestamps = ""
} = {}) {
  const transcriptVerdict = verifyAsrTailMatch({ expectedTail, transcript });
  if (transcriptVerdict.pass) {
    return { ...transcriptVerdict, source: "transcript" };
  }
  const timestampWordStream = parseTimestampWordStream(timestamps);
  if (!timestampWordStream) {
    return { ...transcriptVerdict, source: "transcript" };
  }
  const timestampVerdict = verifyAsrTailMatch({ expectedTail, transcript: timestampWordStream });
  if (timestampVerdict.pass) {
    return { ...timestampVerdict, source: "timestamps" };
  }
  return { ...transcriptVerdict, source: "transcript" };
}

function applyTailGapGuard({
  verificationRecord = {},
  durationSeconds = NaN,
  isLastChunk = false,
  clipVerifyMinTailMs = 120
} = {}) {
  if (!isLastChunk) return;
  const duration = Number(durationSeconds);
  const tailEnd = Number(verificationRecord?.asrTailEndSeconds);
  if (!Number.isFinite(duration) || !Number.isFinite(tailEnd)) return;
  const overshootMs = (tailEnd - duration) * 1000;
  verificationRecord.asrTailOvershootMs = overshootMs;
  if (overshootMs > 0) {
    verificationRecord.asrTailGapMs = 0;
    verificationRecord.asrTailGapClamped = true;
    return;
  }
  const tailGapMs = (duration - tailEnd) * 1000;
  verificationRecord.asrTailGapMs = tailGapMs;
  if (tailGapMs < clipVerifyMinTailMs) {
    verificationRecord.asrPass = false;
    verificationRecord.asrTailGapFail = true;
  }
}

function tightenRetryChunkText(text = "") {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (raw.endsWith("...")) return raw.slice(0, -3).trimEnd() + ".";
  if (raw.endsWith("..")) return raw.slice(0, -2).trimEnd() + ".";
  return raw;
}

function parseTailEndSeconds(timestampsRaw = "") {
  const text = String(timestampsRaw ?? "").trim();
  if (!text) return null;
  const jsonCandidates = [text];
  if (!text.startsWith("[") && !text.startsWith("{")) {
    const firstBracket = text.indexOf("[");
    if (firstBracket >= 0) jsonCandidates.push(text.slice(firstBracket));
    const firstBrace = text.indexOf("{");
    if (firstBrace >= 0) jsonCandidates.push(text.slice(firstBrace));
  }
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const queue = [parsed];
      let best = null;
      while (queue.length) {
        const cur = queue.shift();
        if (Array.isArray(cur)) {
          queue.push(...cur);
          continue;
        }
        if (cur && typeof cur === "object") {
          const end = Number(cur.end);
          if (Number.isFinite(end)) best = best === null ? end : Math.max(best, end);
          for (const value of Object.values(cur)) queue.push(value);
        }
      }
      if (Number.isFinite(best)) return best;
    } catch {
      // ignore and try regex fallback
    }
  }
  const matches = [...text.matchAll(/"end"\s*:\s*(-?\d+(?:\.\d+)?)/gu)];
  if (matches.length) {
    const end = Number(matches[matches.length - 1]?.[1] ?? "");
    if (Number.isFinite(end)) return end;
  }
  const rangeMatches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/gu)];
  if (rangeMatches.length) {
    let best = null;
    for (const match of rangeMatches) {
      const end = Number(match?.[2] ?? "");
      if (Number.isFinite(end)) best = best === null ? end : Math.max(best, end);
    }
    if (Number.isFinite(best)) return best;
  }
  return null;
}

async function detectHotTailSuspect({
  input = "",
  windowMs = 120,
  peakDbThreshold = -12,
  deltaDbThreshold = 1
} = {}) {
  const duration = await probeDurationSeconds(input);
  const windowSeconds = Math.max(0.06, Number(windowMs) / 1000);
  const prevStart = Math.max(0, duration - (windowSeconds * 2));
  const prevEnd = Math.max(0, duration - windowSeconds);
  const tailStart = prevEnd;
  const tailEnd = duration;
  const prev = await runToolWithStderr("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-v",
    "info",
    "-i",
    input,
    "-af",
    `atrim=start=${prevStart.toFixed(6)}:end=${prevEnd.toFixed(6)},astats=metadata=1:reset=1`,
    "-f",
    "null",
    "-"
  ]);
  const tail = await runToolWithStderr("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-v",
    "info",
    "-i",
    input,
    "-af",
    `atrim=start=${tailStart.toFixed(6)}:end=${tailEnd.toFixed(6)},astats=metadata=1:reset=1`,
    "-f",
    "null",
    "-"
  ]);
  const prevRmsDb = parseLastAstatsMetric(prev.stderr, "RMS level dB");
  const tailRmsDb = parseLastAstatsMetric(tail.stderr, "RMS level dB");
  const tailPeakDb = parseLastAstatsMetric(tail.stderr, "Peak level dB");
  const deltaDb = tailRmsDb - prevRmsDb;
  const suspect = tailPeakDb > Number(peakDbThreshold) && deltaDb > Number(deltaDbThreshold);
  return {
    suspect,
    durationSeconds: duration,
    prevRmsDb,
    tailRmsDb,
    tailPeakDb,
    deltaDb,
    windowMs: Number(windowMs),
    peakDbThreshold: Number(peakDbThreshold),
    deltaDbThreshold: Number(deltaDbThreshold)
  };
}

async function verifyChunkTailWithQwenAsr({
  input = "",
  host = "",
  workflowRoot = "",
  workflowName = "",
  expectedTail = []
} = {}) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../command/hear_comfyui_runner.mjs");
  const args = [
    runner,
    "--input",
    input,
    "--host",
    host,
    "--workflow-root",
    workflowRoot,
    "--workflow-name",
    workflowName,
    "--return-timestamps",
    "true"
  ];
  const { stdout } = await runToolWithStderr(process.execPath, args);
  const lines = String(stdout ?? "").trim().split(/\r?\n/u).filter(Boolean);
  const payloadText = lines[lines.length - 1] ?? "{}";
  let payload = {};
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = {};
  }
  const transcript = String(payload?.transcript ?? "").trim();
  const timestamps = String(payload?.timestamps ?? "").trim();
  const verdict = verifyAsrTailMatchUsingTranscriptAndTimestamps({ expectedTail, transcript, timestamps });
  const tailEndSeconds = parseTailEndSeconds(timestamps);
  return {
    pass: verdict.pass,
    transcript,
    timestamps,
    tailEndSeconds,
    matched: verdict.matched,
    expected: verdict.expected,
    matchSource: verdict.source
  };
}

export async function qwenSay(
  sentence,
  {
    remember: rememberFn = remember,
    runSayFn = runQwenSay,
    concatAudioFn = concatAudioChunks,
    pathExistsFn = pathExists,
    postProcessFn = postProcessQwenSayAudio,
    planChunkInstructsFn = planChunkInstructs,
    detectHotTailFn = detectHotTailSuspect,
    verifyChunkTailFn = verifyChunkTailWithQwenAsr
  } = {}
) {
  if (sentence?.ob?.hollow) {
    throwErrorSentence({
      name: "qwen say input hollow error",
      message: "qwen say input hollow error",
      from: { name: "qwen say" },
      raw: { sentence }
    });
  }
  const text = String(renderSayValue(sentence.ob ?? {}, { rememberFn }) ?? "");
  if (!text.trim()) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: missing text",
      from: { name: "qwen say" },
      raw: { sentence }
    });
  }
  if (!hasSpeakableContent(text)) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: empty speakable text",
      from: { name: "qwen say" },
      raw: { sentence, text }
    });
  }

  const outputPath = resolveOutputPath(sentence, { ext: ".wav" });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const { workflowName, workflowRoot, toneDefault, toneOverride } = await resolveWorkflowAndTone(sentence, { rememberFn, pathExistsFn });
  const host = resolveHost({ rememberFn });
  const toneStrategy = resolveToneStrategy({ rememberFn });
  const manifestInstructs = await resolveToneManifestInstructs(sentence, { rememberFn });
  const sanitizeMap = resolveQwenSaySanitizeMap({ rememberFn });
  const chunks = splitQwenSayTextChunks(text, { forceSentenceChunks: manifestInstructs.length > 0 });
  assertChunkIntegrity(text, chunks);
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
  const keepChunkArtifacts = resolveKeepChunkArtifacts({ rememberFn });
  const clipVerifyEnabled = resolveClipVerifyEnabled({ rememberFn });
  const clipVerifyAllChunks = resolveClipVerifyAllChunks({ rememberFn });
  const clipVerifyMaxRetries = resolveClipVerifyMaxRetries({ rememberFn });
  const clipVerifyTailWords = resolveClipVerifyTailWords({ rememberFn });
  const clipVerifyWindowMs = resolveClipVerifyWindowMs({ rememberFn });
  const clipVerifyPeakDb = resolveClipVerifyPeakDb({ rememberFn });
  const clipVerifyDeltaDb = resolveClipVerifyDeltaDb({ rememberFn });
  const clipVerifyMinTailMs = resolveClipVerifyMinTailMs({ rememberFn });
  const tailPadMs = resolveTailPadMs({ rememberFn });
  const chunkTailPadMs = resolveChunkTailPadMs({ rememberFn });
  const tailPauseMarkup = resolveTailPauseMarkup({ rememberFn });
  const clipVerifyHost = resolveClipVerifyHost({ rememberFn });
  const clipVerifyWorkflowRoot = resolveClipVerifyWorkflowRoot({ rememberFn });
  const clipVerifyWorkflowName = resolveClipVerifyWorkflowName({ rememberFn });
  let postProcessApplied = false;
  let chunkArtifactsDir = "";
  const chunkVerification = [];
  const preparedChunks = chunks.map((chunk, index) => ({
    index,
    raw: String(chunk ?? ""),
    text: ensureTrailingDoublePeriod(
      sanitizeQwenSayScriptText(normalizeQwenSayChunkText(chunk), sanitizeMap)
    ),
    speakText: applyTailPauseMarkup(
      ensureTrailingDoublePeriod(
        sanitizeQwenSayScriptText(normalizeQwenSayChunkText(chunk), sanitizeMap)
      ),
      tailPauseMarkup
    )
  }));
  const emptyChunk = preparedChunks.find((entry) => !hasSpeakableContent(entry.text));
  if (emptyChunk) {
    throwErrorSentence({
      name: "qwen say defective",
      message: "qwen say defective: empty speakable chunk",
      from: { name: "qwen say" },
      raw: { sentence, atindex: emptyChunk.index, chunk: emptyChunk.raw, text: emptyChunk.text }
    });
  }

  if (chunks.length <= 1) {
    await runSayFn({
      text: preparedChunks[0]?.speakText ?? preparedChunks[0]?.text ?? "",
      instruct: chunkInstructs[0] ?? toneDefault,
      workflowName,
      workflowRoot,
      host,
      output: outputPath
    });
  } else {
    const outputParsed = path.parse(outputPath);
    const chunkDir = keepChunkArtifacts
      ? path.join(outputParsed.dir, `${outputParsed.name}.qwen-say-chunks`)
      : await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-say-chunks-"));
    const chunkFiles = [];
    try {
      if (keepChunkArtifacts) {
        await fs.rm(chunkDir, { recursive: true, force: true });
        await fs.mkdir(chunkDir, { recursive: true });
      }
      for (let i = 0; i < chunks.length; i += 1) {
        let chunkText = preparedChunks[i]?.text ?? "";
        let chunkSpeakText = preparedChunks[i]?.speakText ?? chunkText;
        const chunkOutput = path.join(chunkDir, `chunk-${String(i + 1).padStart(3, "0")}.wav`);
        const isLastChunk = i === (chunks.length - 1);
        const verificationRecord = {
          index: i,
          retries: 0,
          suspect: false,
          asrChecked: false,
          asrPass: null,
          expectedTail: expectedTailTokens(chunkText, clipVerifyTailWords),
          hotTail: null
        };
        while (true) {
          const runResult = await runSayFn({
            text: chunkSpeakText,
            instruct: chunkInstructs[i] ?? toneDefault,
            workflowName,
            workflowRoot,
            host,
            output: chunkOutput,
            returnTranscript: clipVerifyEnabled,
            seed: randomChunkSeed()
          });
          verificationRecord.asrTailGapFail = false;
          verificationRecord.asrTailGapClamped = false;
          verificationRecord.asrTailOvershootMs = null;
          verificationRecord.asrTailGapMs = null;
          if (!clipVerifyEnabled) break;
          let suspect = false;
          try {
            verificationRecord.hotTail = await detectHotTailFn({
              input: chunkOutput,
              windowMs: clipVerifyWindowMs,
              peakDbThreshold: clipVerifyPeakDb,
              deltaDbThreshold: clipVerifyDeltaDb
            });
            suspect = verificationRecord.hotTail?.suspect === true;
          } catch (err) {
            verificationRecord.hotTail = { suspect: true, error: String(err?.message ?? err) };
            suspect = true;
          }
          verificationRecord.suspect = suspect;
          const shouldAsrCheck = clipVerifyAllChunks || suspect || isLastChunk;
          if (!shouldAsrCheck) break;
          verificationRecord.asrChecked = true;
          const inlineTranscript = String(runResult?.transcript ?? "").trim();
          const inlineTimestamps = String(runResult?.timestamps ?? "").trim();
          if (inlineTranscript) {
            const inlineVerdict = verifyAsrTailMatchUsingTranscriptAndTimestamps({
              expectedTail: verificationRecord.expectedTail,
              transcript: inlineTranscript,
              timestamps: inlineTimestamps
            });
            verificationRecord.asrPass = inlineVerdict?.pass === true;
            verificationRecord.asrMatched = Number(inlineVerdict?.matched ?? 0);
            verificationRecord.asrExpected = Number(inlineVerdict?.expected ?? verificationRecord.expectedTail.length);
            verificationRecord.asrMatchSource = String(inlineVerdict?.source ?? "transcript");
            verificationRecord.asrTranscript = inlineTranscript;
            verificationRecord.asrTimestamps = inlineTimestamps;
            verificationRecord.asrTailEndSeconds = parseTailEndSeconds(inlineTimestamps);
            verificationRecord.asrSource = "inline";
            const durationSeconds = Number(verificationRecord?.hotTail?.durationSeconds ?? NaN);
            if (verificationRecord.asrPass) {
              applyTailGapGuard({
                verificationRecord,
                durationSeconds,
                isLastChunk,
                clipVerifyMinTailMs
              });
            }
            if (!verificationRecord.asrPass) {
              const asrResult = await verifyChunkTailFn({
                input: chunkOutput,
                host: clipVerifyHost,
                workflowRoot: clipVerifyWorkflowRoot,
                workflowName: clipVerifyWorkflowName,
                expectedTail: verificationRecord.expectedTail
              });
              if (asrResult?.pass === true) {
                verificationRecord.asrPass = true;
                verificationRecord.asrMatched = Number(asrResult?.matched ?? 0);
                verificationRecord.asrExpected = Number(asrResult?.expected ?? verificationRecord.expectedTail.length);
                verificationRecord.asrMatchSource = String(asrResult?.matchSource ?? "transcript");
                verificationRecord.asrTranscript = String(asrResult?.transcript ?? "");
                verificationRecord.asrTimestamps = String(asrResult?.timestamps ?? "");
                const fallbackTailEnd = Number(asrResult?.tailEndSeconds);
                verificationRecord.asrTailEndSeconds = Number.isFinite(fallbackTailEnd) ? fallbackTailEnd : null;
                verificationRecord.asrSource = "external-fallback";
                const durationSeconds = Number(verificationRecord?.hotTail?.durationSeconds ?? NaN);
                applyTailGapGuard({
                  verificationRecord,
                  durationSeconds,
                  isLastChunk,
                  clipVerifyMinTailMs
                });
              }
            }
          } else {
            const asrResult = await verifyChunkTailFn({
              input: chunkOutput,
              host: clipVerifyHost,
              workflowRoot: clipVerifyWorkflowRoot,
              workflowName: clipVerifyWorkflowName,
              expectedTail: verificationRecord.expectedTail
            });
            verificationRecord.asrPass = asrResult?.pass === true;
            verificationRecord.asrMatched = Number(asrResult?.matched ?? 0);
            verificationRecord.asrExpected = Number(asrResult?.expected ?? verificationRecord.expectedTail.length);
            verificationRecord.asrMatchSource = String(asrResult?.matchSource ?? "transcript");
            verificationRecord.asrTranscript = String(asrResult?.transcript ?? "");
            verificationRecord.asrTimestamps = String(asrResult?.timestamps ?? "");
            const externalTailEnd = Number(asrResult?.tailEndSeconds);
            verificationRecord.asrTailEndSeconds = Number.isFinite(externalTailEnd) ? externalTailEnd : null;
            verificationRecord.asrSource = "external";
            const durationSeconds = Number(verificationRecord?.hotTail?.durationSeconds ?? NaN);
            if (verificationRecord.asrPass) {
              applyTailGapGuard({
                verificationRecord,
                durationSeconds,
                isLastChunk,
                clipVerifyMinTailMs
              });
            }
          }
          if (verificationRecord.asrPass) break;
          if (verificationRecord.retries >= clipVerifyMaxRetries) {
            throwErrorSentence({
              name: "qwen say defective",
              message: `qwen say defective: clipped chunk retries exhausted at chunk ${i + 1}`,
              from: { name: "qwen say" },
              raw: {
                chunkIndex: i + 1,
                retries: verificationRecord.retries,
                expectedTail: verificationRecord.expectedTail,
                transcript: verificationRecord.asrTranscript
              }
            });
          }
          verificationRecord.retries += 1;
          chunkText = tightenRetryChunkText(chunkText);
          chunkSpeakText = applyTailPauseMarkup(chunkText, tailPauseMarkup);
        }
        verificationRecord.text = chunkSpeakText;
        verificationRecord.verifyText = chunkText;
        if (chunkTailPadMs > 0) {
          const parsedChunk = path.parse(chunkOutput);
          const paddedChunkPath = path.join(parsedChunk.dir, `${parsedChunk.name}.padded${parsedChunk.ext || ".wav"}`);
          await padAudioTail({
            input: chunkOutput,
            output: paddedChunkPath,
            padMs: chunkTailPadMs
          });
          await fs.rename(paddedChunkPath, chunkOutput);
        }
        chunkVerification.push(verificationRecord);
        chunkFiles.push(chunkOutput);
      }
      if (keepChunkArtifacts) {
        const manifestPath = path.join(chunkDir, "chunks.metadata.json");
        const manifest = {
          kind: "qwen say chunk artifacts",
          output: outputPath,
          chunks: chunkFiles.map((filename, index) => ({
            index,
            filename,
            text: chunkVerification[index]?.text ?? preparedChunks[index]?.speakText ?? preparedChunks[index]?.text ?? "",
            instruct: chunkInstructs[index] ?? toneDefault,
            verification: chunkVerification[index] ?? null
          }))
        };
        await fs.writeFile(manifestPath, canonicalJsonStringify(manifest), "utf8");
        chunkArtifactsDir = chunkDir;
      }
      await concatAudioFn({ inputs: chunkFiles, output: outputPath });
    } finally {
      if (!keepChunkArtifacts) {
        await fs.rm(chunkDir, { recursive: true, force: true });
      }
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

  if (tailPadMs > 0) {
    const parsed = path.parse(outputPath);
    const paddedPath = path.join(parsed.dir, `${parsed.name}.padded${parsed.ext || ".wav"}`);
    await padAudioTail({
      input: outputPath,
      output: paddedPath,
      padMs: tailPadMs
    });
    await fs.rename(paddedPath, outputPath);
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
    keepChunkArtifacts,
    chunkArtifactsDir: chunkArtifactsDir || undefined,
    clipVerifyEnabled,
    clipVerifyAllChunks,
    clipVerifyMaxRetries,
    clipVerifyTailWords,
    clipVerifyWindowMs,
    clipVerifyPeakDb,
    clipVerifyDeltaDb,
    clipVerifyMinTailMs,
    tailPadMs,
    chunkTailPadMs,
    tailPauseMarkup,
    clipVerifyHost,
    clipVerifyWorkflowName,
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
