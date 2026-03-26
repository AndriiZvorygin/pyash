import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractFinalResult } from "./extract_learn_pipeline_result.mjs";

export const DEFAULT_CHUNK_SIZE = 8 * 1024;
export const DEFAULT_CHUNK_OVERLAP = 1800;
export const DEFAULT_MERGE_GROUP_SIZE = 4;
export const DEFAULT_STAGE_RETRIES = 3;
const PARAGRAPH_BOUNDARY = /\n\s*\n/gmu;
const CHILD_OLLAMA_TIMEOUT_MS = "600000";
const VERBOSE_STREAM_MAX_LINES = 24;
const VERBOSE_STREAM_MAX_LINE_CHARS = 260;
const VERBOSE_STREAM_SNIPPET_HEAD_LINES = 3;
const VERBOSE_STREAM_SNIPPET_TAIL_LINES = 3;
const verboseStreamLineCount = new Map();
const verboseStreamSuppressed = new Set();
const verboseSnippetHeadCount = new Map();
const verboseSnippetTailBuffer = new Map();
const verboseSnippetTailEnabled = new Set();

function isVerbose() {
  return process.env.PYA_RUN_VERBOSE === "1";
}

function logVerbose(line = "") {
  if (!isVerbose()) return;
  process.stderr.write(`${line}\n`);
}

function oneLine(text) {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
}

function summarizeCard(text) {
  const raw = String(text ?? "");
  const lines = raw.split("\n").map(line => line.trim());
  const seedIndex = lines.findIndex(line => line === "SEED CONCEPT");
  const memoryIndex = lines.findIndex(line => line === "BRIEF MEMORY PHRASES");
  const seed = seedIndex !== -1 ? oneLine(lines[seedIndex + 1] ?? "") : "";
  let memory = "";
  if (memoryIndex !== -1) {
    const memoryLine = lines.slice(memoryIndex + 1).find(line => line.startsWith("- "));
    memory = oneLine(memoryLine ?? "");
  }
  const parts = [];
  if (seed) parts.push(`seed=${seed}`);
  if (memory) parts.push(`memory=${memory}`);
  return parts.join(" | ") || "(empty)";
}

export function buildMergeGroups(items = [], groupSize = DEFAULT_MERGE_GROUP_SIZE) {
  const size = Math.max(2, Math.floor(Number(groupSize) || DEFAULT_MERGE_GROUP_SIZE));
  const groups = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

export function planMergeLayers(items = [], groupSize = DEFAULT_MERGE_GROUP_SIZE) {
  const layers = [];
  let count = Array.isArray(items) ? items.length : 0;
  let layerIndex = 0;
  while (count > 1) {
    const groups = buildMergeGroups(new Array(count).fill(null), groupSize).map((group, index) => ({
      index: index + 1,
      size: group.length
    }));
    layers.push({
      index: layerIndex + 1,
      groups
    });
    count = groups.length;
    layerIndex += 1;
  }
  return layers;
}

function normalizeStageResult(result) {
  if (result && typeof result === "object" && "resultText" in result) {
    return {
      resultText: String(result.resultText ?? ""),
      traceFilename: String(result.traceFilename ?? "")
    };
  }
  return {
    resultText: String(result ?? ""),
    traceFilename: ""
  };
}

function stageRetryCount() {
  const raw = Number(process.env.PYA_LEARN_STAGE_RETRIES);
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  return DEFAULT_STAGE_RETRIES;
}

function shouldRetryStageError(error) {
  const message = String(error?.message ?? "");
  const stderr = String(error?.stderr ?? "");
  const combined = `${message}\n${stderr}`;
  return /learn card defective:/u.test(combined)
    || /learning source support defective/u.test(combined);
}

function parseSupportScoreFromError(error) {
  const message = String(error?.message ?? "");
  const stderr = String(error?.stderr ?? "");
  const combined = `${message}\n${stderr}`;
  const direct = combined.match(/learning source support defective:\s*score\s*=\s*([0-9]*\.?[0-9]+)/iu);
  if (direct?.[1]) return Number(direct[1]);
  return Number.NaN;
}

async function runStageWithRetries(stageLabel, runStage) {
  const retries = stageRetryCount();
  let attempt = 0;
  let lastError = null;
  let bestFailed = null;
  while (attempt < retries) {
    attempt += 1;
    try {
      return await runStage({ attempt, retries });
    } catch (error) {
      lastError = error;
      if (/learning source support defective/u.test(String(error?.message ?? ""))) {
        const score = parseSupportScoreFromError(error);
        const candidateText = String(error?.resultText ?? "").trim();
        if (candidateText && looksLikeLearnCard(candidateText)) {
          const numericScore = Number.isFinite(score) ? score : 0;
          if (!bestFailed || numericScore > bestFailed.score) {
            bestFailed = { score: numericScore, resultText: candidateText };
          }
        }
      }
      const canRetry = attempt < retries && shouldRetryStageError(error);
      if (!canRetry) {
        if (shouldRetryStageError(error)) break;
        throw error;
      }
      logVerbose(`[learn pipeline] ${stageLabel} retry ${attempt}/${retries} after: ${oneLine(error?.message ?? error)}`);
    }
  }
  if (bestFailed?.resultText) {
    logVerbose(`[learn pipeline] ${stageLabel} using best scored fallback after retries (score=${bestFailed.score.toFixed(3)})`);
    return { resultText: bestFailed.resultText, traceFilename: "" };
  }
  throw lastError ?? new Error(`learn filename pipeline defective: stage failed without error (${stageLabel})`);
}

function createMindFixtureAllocator(raw) {
  const source = String(raw ?? "").trim();
  if (!source) {
    return () => null;
  }
  let queue = null;
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      queue = parsed;
    }
  } catch {
    // Leave queue null so the caller can use the raw fixture unchanged.
  }
  if (!queue) {
    return () => source;
  }
  let index = 0;
  return (count) => {
    const needed = Math.max(0, Number(count) || 0);
    if (needed === 0) return JSON.stringify([]);
    if (queue.length === 0) return JSON.stringify([]);
    const taken = [];
    for (let i = 0; i < needed; i += 1) {
      const item = queue[Math.min(index, queue.length - 1)];
      taken.push(item);
      if (index < queue.length - 1) index += 1;
    }
    return JSON.stringify(taken);
  };
}

export function parseLearningPipelineRequest(text) {
  const raw = String(text ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\\r\\n/gu, "\n")
    .replace(/\\n/gu, "\n");
  const compact = raw.replace(/[ \t]+/gu, " ").trim();
  const blockMatch = compact.match(/SOURCE_FILENAME:\s*([\s\S]*?)\s*LEARNING_FOCUS:\s*([\s\S]*)$/u);
  if (!blockMatch) {
    throw new Error("learn filename pipeline defective: malformed request");
  }
  const sourceFilename = String(blockMatch[1] ?? "").trim();
  const focusBlock = String(blockMatch[2] ?? "").trim();
  if (!sourceFilename) {
    throw new Error("learn filename pipeline defective: missing source filename");
  }
  if (!focusBlock) {
    throw new Error("learn filename pipeline defective: missing learning focus");
  }
  return {
    sourceFilename,
    learningFocus: focusBlock.trim()
  };
}

function findBoundaryNear(text, target, min, max) {
  let best = null;
  for (const match of text.matchAll(PARAGRAPH_BOUNDARY)) {
    const idx = match.index ?? -1;
    if (idx < min || idx > max) continue;
    const end = idx + match[0].length;
    const distance = Math.abs(end - target);
    if (!best || distance < best.distance) {
      best = { end, distance };
    }
  }
  return best?.end ?? null;
}

export function splitIntoOverlappingChunks(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  const source = String(text ?? "");
  if (!source.length) return [""];
  if (source.length <= chunkSize) return [source];
  const chunks = [];
  const tolerance = Math.min(2000, Math.max(600, Math.floor(overlap)));
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + chunkSize);
    if (end < source.length) {
      const minBoundary = Math.max(start + Math.floor(chunkSize * 0.6), end - tolerance);
      const maxBoundary = Math.min(source.length, end + tolerance);
      const boundaryEnd = findBoundaryNear(source, end, minBoundary, maxBoundary);
      if (boundaryEnd && boundaryEnd > start) {
        end = boundaryEnd;
      }
    }
    const chunk = source.slice(start, end);
    chunks.push(chunk);
    if (end >= source.length) break;
    let nextStart = Math.max(0, end - overlap);
    if (nextStart <= start) {
      nextStart = Math.min(source.length, start + Math.max(1, chunkSize - overlap));
    }
    start = nextStart;
  }
  return chunks;
}

function parseProduceFilePath(outputText) {
  const matches = [...String(outputText ?? "").matchAll(/^produce file:\s+(.+)$/gmu)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

function looksLikeLearnCard(text) {
  const raw = String(text ?? "");
  return raw.includes("SEED CONCEPT\n") && raw.includes("\nCARDINAL TRAINING SENTENCE\n");
}

export function extractChildDefect(text) {
  const raw = String(text ?? "");
  const guaranteeMatch = raw.match(/(?:^|\n)su name guarantee defective ob text "([^"]+)"/u);
  if (guaranteeMatch?.[1]) return guaranteeMatch[1];
  const commandMatch = raw.match(/(?:^|\n)command defective:[^\n]*/u);
  if (commandMatch?.[0]) return commandMatch[0];
  const pipelineMatch = raw.match(/(?:^|\n)(learn filename pipeline defective:[^\n]*)/u);
  if (pipelineMatch?.[1]) return pipelineMatch[1];
  return "";
}

export function buildChildRunId(parentRunId, traceLabel, fallbackStem = "") {
  const parent = String(parentRunId ?? "").trim();
  const label = String(traceLabel ?? "stage").trim();
  const fallback = String(fallbackStem ?? "").trim();
  if (parent) return `${parent}/learn-pipeline/${label}`;
  if (fallback) return `${fallback}-${label}`;
  return label;
}

export function resolveChildArtifactProduceFilename({ cwd = process.cwd(), runId }) {
  return path.resolve(String(cwd ?? process.cwd()), "artifacts", String(runId ?? "").trim(), "produce.txt");
}

export async function resolveChildArtifactResult({
  cwd = process.cwd(),
  runId,
  readFileFn = (file) => fsp.readFile(file, "utf8")
} = {}) {
  const filename = resolveChildArtifactProduceFilename({ cwd, runId });
  return String(await readFileFn(filename)).trim();
}

export async function resolvePyashExampleResult({ stdoutText = "", stderrText = "", readFileFn = (file) => fsp.readFile(file, "utf8") } = {}) {
  const combinedText = [stdoutText, stderrText].filter(Boolean).join("\n");
  let resultText = extractFinalResult(stdoutText);
  if (!resultText) {
    resultText = extractFinalResult(combinedText);
  }
  if (!resultText || !looksLikeLearnCard(resultText)) {
    const produceFile = parseProduceFilePath(combinedText);
    if (produceFile) {
      const producedText = await readFileFn(produceFile);
      const producedResult = extractFinalResult(producedText);
      if (producedResult && (!resultText || looksLikeLearnCard(producedResult))) {
        resultText = producedResult;
      }
    }
  }
  return String(resultText ?? "");
}

function streamChildText(text, { traceLabel = "stage", channel = "stdout" } = {}) {
  if (!isVerbose()) return;
  const normalized = String(text ?? "").replace(/\r\n?/gu, "\n");
  if (!normalized) return;
  const prefix = `[learn pipeline][${traceLabel}][${channel}] `;
  const clipLine = (line) => {
    const raw = String(line ?? "");
    return raw.length > VERBOSE_STREAM_MAX_LINE_CHARS
      ? `${raw.slice(0, VERBOSE_STREAM_MAX_LINE_CHARS)}...`
      : raw;
  };
  const isSignalLine = (line) => {
    const t = String(line ?? "").trim();
    if (!t) return false;
    if (t.startsWith("exists su name command audit ")) return false;
    if (t.startsWith("su name tool event ")) return false;
    return (
      /^exists su name \d{8}-/u.test(t) ||
      /^ob filename .* be run root ya$/u.test(t) ||
      /^su name run (start|end) time /u.test(t) ||
      /^su name run duration ms /u.test(t) ||
      /^result file:\s+/u.test(t) ||
      /^run start:\s+/u.test(t) ||
      /^run end:\s+/u.test(t) ||
      /^run duration:\s+/u.test(t) ||
      /^artifacts folder:\s+/u.test(t) ||
      /^su name command defective /u.test(t) ||
      /^command defective:/u.test(t) ||
      /^su name guarantee defective /u.test(t) ||
      /^FINAL_RESULT_FILE:\s+/u.test(t) ||
      /\batindex num \d+ toindex num \d+/u.test(t)
    );
  };
  const isScaffoldingLine = (line) => {
    const t = String(line ?? "").trim();
    if (!t) return true;
    return (
      /command audit/u.test(t) ||
      /\|\s*tr\s+-d/u.test(t) ||
      /file --mime-type/u.test(t) ||
      /\.text\.quoted/u.test(t) ||
      /^text\/plain$/u.test(t) ||
      /^text$/u.test(t) ||
      /^exists su name evoke-\d+\b/u.test(t) ||
      /^exists su name .* since name .* be run ya$/u.test(t) ||
      /^from filename .* be import do$/u.test(t) ||
      /^ob ve filename text source text text learning_focus be input ya$/u.test(t) ||
      /^ob filename .* be run root ya$/u.test(t)
    );
  };
  const endsWithNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (endsWithNewline) lines.pop();
  const key = `${traceLabel}:${channel}`;
  let count = verboseStreamLineCount.get(key) ?? 0;
  let headCount = verboseSnippetHeadCount.get(key) ?? 0;
  const tail = verboseSnippetTailBuffer.get(key) ?? [];
  for (const rawLine of lines) {
    if (count >= VERBOSE_STREAM_MAX_LINES) {
      if (!verboseStreamSuppressed.has(key)) {
        verboseStreamSuppressed.add(key);
        process.stderr.write(`${prefix}... compact verbose: additional lines suppressed for ${traceLabel} ${channel} (see trace file)\n`);
      }
      break;
    }
    const line = String(rawLine ?? "");
    const signal = isSignalLine(line);
    if (signal) {
      process.stderr.write(`${prefix}${clipLine(line)}\n`);
      count += 1;
      continue;
    }
    if (isScaffoldingLine(line)) continue;
    if (headCount < VERBOSE_STREAM_SNIPPET_HEAD_LINES) {
      process.stderr.write(`${prefix}[snippet head] ${clipLine(line)}\n`);
      headCount += 1;
      count += 1;
      continue;
    }
    if (!verboseSnippetTailEnabled.has(key)) {
      verboseSnippetTailEnabled.add(key);
      process.stderr.write(`${prefix}... compact verbose: middle snippets suppressed for ${traceLabel} ${channel} (showing tail at stage end)\n`);
      count += 1;
    }
    if (tail.length >= VERBOSE_STREAM_SNIPPET_TAIL_LINES) tail.shift();
    tail.push(line);
  }
  verboseStreamLineCount.set(key, count);
  verboseSnippetHeadCount.set(key, headCount);
  verboseSnippetTailBuffer.set(key, tail);
}

function flushChildTextSnippetTail({ traceLabel = "stage", channel = "stdout" } = {}) {
  if (!isVerbose()) return;
  const key = `${traceLabel}:${channel}`;
  const tail = verboseSnippetTailBuffer.get(key) ?? [];
  if (tail.length > 0 && verboseSnippetTailEnabled.has(key)) {
    const prefix = `[learn pipeline][${traceLabel}][${channel}] `;
    for (const line of tail) {
      const clipped = String(line ?? "").length > VERBOSE_STREAM_MAX_LINE_CHARS
        ? `${String(line).slice(0, VERBOSE_STREAM_MAX_LINE_CHARS)}...`
        : String(line ?? "");
      process.stderr.write(`${prefix}[snippet tail] ${clipped}\n`);
    }
  }
  verboseSnippetTailBuffer.delete(key);
  verboseSnippetTailEnabled.delete(key);
  verboseSnippetHeadCount.delete(key);
  verboseStreamLineCount.delete(key);
  verboseStreamSuppressed.delete(key);
}

function resolvePipelineArtifactRoot() {
  const runId = String(process.env.PYA_RUN_ID ?? "").trim();
  if (!runId) return "";
  return path.resolve(process.cwd(), "artifacts", runId, "learn-pipeline");
}

export function resolveRunProgramPath(cwd = process.cwd()) {
  return path.resolve(String(cwd ?? process.cwd()), "run");
}

async function runPyashExample(examplePath, args, envOverrides = {}, { traceDir = "", traceLabel = "stage", childRunId = "" } = {}) {
  const effectiveRunId = String(childRunId ?? "").trim() || buildChildRunId(process.env.PYA_RUN_ID, traceLabel);
  const runArgs = ["--verbose", "--run-id", effectiveRunId, examplePath, ...args];
  runArgs.push("--no-checkpoint");
  const childEnv = {
    ...process.env,
    PYA_OLLAMA_REQUEST_TIMEOUT_MS: process.env.PYA_OLLAMA_REQUEST_TIMEOUT_MS || CHILD_OLLAMA_TIMEOUT_MS,
    ...envOverrides
  };
  const { stdoutText, stderrText } = await new Promise((resolve, reject) => {
    const runPath = resolveRunProgramPath(process.cwd());
    const proc = spawn(runPath, runArgs, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      const text = data.toString("utf8");
      stdout += text;
      streamChildText(text, { traceLabel, channel: "stdout" });
    });
    proc.stderr.on("data", (data) => {
      const text = data.toString("utf8");
      stderr += text;
      streamChildText(text, { traceLabel, channel: "stderr" });
    });
    proc.on("error", reject);
    proc.on("close", (code, signal) => {
      flushChildTextSnippetTail({ traceLabel, channel: "stdout" });
      flushChildTextSnippetTail({ traceLabel, channel: "stderr" });
      if (code === 0) {
        resolve({ stdoutText: stdout, stderrText: stderr });
        return;
      }
      const err = new Error(`child run defective: status=${code ?? 0} signal=${signal ?? ""}`);
      err.stdout = stdout;
      err.stderr = stderr;
      err.resultText = extractFinalResult([stdout, stderr].filter(Boolean).join("\n"));
      reject(err);
    });
  });
  let traceFilename = "";
  const combinedText = [stdoutText, stderrText].filter(Boolean).join("\n");
  const childDefect = extractChildDefect(combinedText);
  if (childDefect) {
    const err = new Error(`learn filename pipeline defective: child stage failed: ${childDefect}`);
    err.stdout = stdoutText;
    err.stderr = stderrText;
    throw err;
  }
  let resultText = "";
  try {
    resultText = await resolveChildArtifactResult({ cwd: process.cwd(), runId: effectiveRunId });
  } catch {
    resultText = await resolvePyashExampleResult({ stdoutText, stderrText });
  }
  if (isVerbose() && traceDir) {
    traceFilename = path.join(traceDir, `${traceLabel}.trace.txt`);
    await fsp.writeFile(traceFilename, combinedText, "utf8");
  }
  if (traceDir) {
    const produceCopyFilename = path.join(traceDir, `${traceLabel}.produce.txt`);
    await fsp.writeFile(produceCopyFilename, resultText.endsWith("\n") ? resultText : `${resultText}\n`, "utf8");
  }
  return { resultText, traceFilename };
}

export async function runLearnFilenamePipeline({
  sourceFilename,
  learningFocus,
  readFileFn = (file) => fsp.readFile(file, "utf8"),
  mkdtempFn = (prefix) => fsp.mkdtemp(prefix),
  writeFileFn = (file, text) => fsp.writeFile(file, text),
  runDirectFn = ({ sourceFilename: file, learningFocus: focus, envOverrides, traceDir, traceLabel, childRunId }) => runPyashExample("examples/pyash/learn-direct-from-filename.pya", [file, focus], envOverrides, { traceDir, traceLabel, childRunId }),
  runExtractFn = ({ sourceFilename: file, learningFocus: focus, envOverrides, traceDir, traceLabel, childRunId }) => runPyashExample("examples/pyash/learn-extract-card-from-filename.pya", [file, focus], envOverrides, { traceDir, traceLabel, childRunId }),
  runMergeRefineFn = ({ sourceFilename: source, cardsFilename: cards, learningFocus: focus, envOverrides, traceDir, traceLabel, childRunId }) => runPyashExample("examples/pyash/learn-merge-refine-cards-from-filename.pya", [source, cards, focus], envOverrides, { traceDir, traceLabel, childRunId })
}) {
  if (!String(sourceFilename ?? "").trim()) {
    throw new Error("learn filename pipeline defective: missing source filename");
  }
  if (!String(learningFocus ?? "").trim()) {
    throw new Error("learn filename pipeline defective: missing learning focus");
  }
  const takeFixtureResponses = createMindFixtureAllocator(process.env.PYA_MIND_RESPONSE);
  const sourceText = await readFileFn(sourceFilename);
  const artifactRoot = resolvePipelineArtifactRoot();
  logVerbose(`[learn pipeline] source filename: ${sourceFilename}`);
  logVerbose(`[learn pipeline] learning focus: ${learningFocus || "(empty)"}`);
  logVerbose(`[learn pipeline] source chars: ${sourceText.length}`);
  const tempRoot = artifactRoot || await mkdtempFn(path.join(os.tmpdir(), "pyash-learn-chunks-"));
  await fsp.mkdir(tempRoot, { recursive: true });
  logVerbose(`[learn pipeline] trace root: ${tempRoot}`);
  if (sourceText.length <= DEFAULT_CHUNK_SIZE) {
    logVerbose("[learn pipeline] mode: single-pass");
    const direct = normalizeStageResult(await runStageWithRetries("direct", async () => runDirectFn({
      sourceFilename,
      learningFocus,
      envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(4) ?? process.env.PYA_MIND_RESPONSE },
      traceDir: tempRoot,
      traceLabel: "direct",
      childRunId: buildChildRunId(process.env.PYA_RUN_ID, "direct", path.basename(tempRoot))
    })));
    if (direct.traceFilename) logVerbose(`[learn pipeline] direct trace: ${direct.traceFilename}`);
    logVerbose(`[learn pipeline] refined card: ${summarizeCard(direct.resultText)}`);
    return direct.resultText;
  }

  const chunks = splitIntoOverlappingChunks(sourceText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP);
  logVerbose("[learn pipeline] mode: chunked");
  logVerbose(`[learn pipeline] chunk target chars: ${DEFAULT_CHUNK_SIZE}`);
  logVerbose(`[learn pipeline] chunk overlap chars: ${DEFAULT_CHUNK_OVERLAP}`);
  logVerbose(`[learn pipeline] chunk count: ${chunks.length}`);
  logVerbose(`[learn pipeline] chunk sizes: first=${chunks[0]?.length ?? 0} last=${chunks.at(-1)?.length ?? 0}`);
  const chunkCards = [];
  for (let idx = 0; idx < chunks.length; idx += 1) {
    const chunkFilename = path.join(tempRoot, `chunk-${String(idx + 1).padStart(3, "0")}.txt`);
    await writeFileFn(chunkFilename, chunks[idx]);
    logVerbose(`[learn pipeline] extracting chunk ${idx + 1}/${chunks.length} (${chunks[idx].length} chars)`);
    const card = normalizeStageResult(await runStageWithRetries(`chunk ${idx + 1}/${chunks.length}`, async () => runExtractFn({
      sourceFilename: chunkFilename,
      learningFocus,
      envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(1) ?? process.env.PYA_MIND_RESPONSE },
      traceDir: tempRoot,
      traceLabel: `chunk-${String(idx + 1).padStart(3, "0")}`,
      childRunId: buildChildRunId(process.env.PYA_RUN_ID, `chunk-${String(idx + 1).padStart(3, "0")}`, path.basename(tempRoot))
    })));
    if (card.traceFilename) logVerbose(`[learn pipeline] chunk ${idx + 1}/${chunks.length} trace: ${card.traceFilename}`);
    logVerbose(`[learn pipeline] chunk ${idx + 1}/${chunks.length} ok`);
    chunkCards.push(card.resultText);
  }
  const mergePlan = planMergeLayers(chunkCards, DEFAULT_MERGE_GROUP_SIZE);
  if (mergePlan.length) {
    logVerbose(`[learn pipeline] merge layers: ${mergePlan.length}`);
    for (const layer of mergePlan) {
      logVerbose(`[learn pipeline] merge layer ${layer.index}: groups=${layer.groups.length} sizes=${layer.groups.map(group => group.size).join(",")}`);
    }
  }

  let currentCards = chunkCards;
  for (let layerIndex = 0; layerIndex < mergePlan.length; layerIndex += 1) {
    const layerNumber = layerIndex + 1;
    const layerLabel = `merge-layer-${String(layerNumber).padStart(2, "0")}`;
    const layerDir = path.join(tempRoot, layerLabel);
    await fsp.mkdir(layerDir, { recursive: true });
    const groups = buildMergeGroups(currentCards, DEFAULT_MERGE_GROUP_SIZE);
    const mergedCards = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const groupNumber = groupIndex + 1;
      const groupLabel = `group-${String(groupNumber).padStart(3, "0")}`;
      const groupDir = path.join(layerDir, groupLabel);
      await fsp.mkdir(groupDir, { recursive: true });
      const cardsText = groups[groupIndex]
        .map((card, idx) => `CHUNK CARD ${idx + 1}\n${card}`)
        .join("\n\n=====\n\n");
      const cardsFilename = path.join(groupDir, "chunk-cards.txt");
      await writeFileFn(cardsFilename, cardsText);
      logVerbose(`[learn pipeline] ${layerLabel} ${groupLabel} starting (${groups[groupIndex].length} cards)`);
      const merged = normalizeStageResult(await runStageWithRetries(`${layerLabel} ${groupLabel}`, async () => runMergeRefineFn({
        sourceFilename,
        cardsFilename,
        learningFocus,
        envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(4) ?? process.env.PYA_MIND_RESPONSE },
        traceDir: groupDir,
        traceLabel: "merge-refine",
        childRunId: buildChildRunId(process.env.PYA_RUN_ID, `${layerLabel}/${groupLabel}`, path.basename(tempRoot))
      })));
      if (merged.traceFilename) logVerbose(`[learn pipeline] ${layerLabel} ${groupLabel} trace: ${merged.traceFilename}`);
      logVerbose(`[learn pipeline] ${layerLabel} ${groupLabel} ok`);
      mergedCards.push(merged.resultText);
    }
    currentCards = mergedCards;
  }

  const finalCardText = String(currentCards[0] ?? "").trim();
  logVerbose(`[learn pipeline] final card: ${summarizeCard(finalCardText)}`);
  return finalCardText;
}

async function main() {
  const argvSource = process.argv[2];
  const argvFocus = process.argv.slice(3).join(" ").trim();
  const parsed = argvSource
    ? { sourceFilename: argvSource, learningFocus: argvFocus }
    : parseLearningPipelineRequest(fs.readFileSync(0, "utf8"));
  const output = await runLearnFilenamePipeline(parsed);
  if (isVerbose()) {
    const finalRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pyash-learn-final-"));
    const finalFilename = path.join(finalRoot, "teaching.txt");
    await fsp.writeFile(finalFilename, output, "utf8");
    logVerbose(`[learn pipeline] final result file: ${finalFilename}`);
    process.stdout.write(`FINAL_RESULT_FILE: ${finalFilename}\n`);
    return;
  }
  process.stdout.write(output);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
