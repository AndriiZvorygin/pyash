import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractFinalResult } from "./extract_learn_pipeline_result.mjs";

export const DEFAULT_CHUNK_SIZE = 16 * 1024;
export const DEFAULT_CHUNK_OVERLAP = 1800;
const PARAGRAPH_BOUNDARY = /\n\s*\n/gmu;
const CHILD_OLLAMA_TIMEOUT_MS = "600000";
const START_MARKER = "[learn pipeline] final result start";
const END_MARKER = "[learn pipeline] final result end";

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
  const raw = String(text ?? "").replace(/\r\n?/gu, "\n");
  const lines = raw.split("\n");
  const sourceIdx = lines.findIndex((line) => line.trim() === "SOURCE_FILENAME:");
  const focusIdx = lines.findIndex((line) => line.trim() === "LEARNING_FOCUS:");
  if (sourceIdx === -1 || focusIdx === -1 || focusIdx <= sourceIdx) {
    throw new Error("learn filename pipeline defective: malformed request");
  }
  const sourceFilename = (lines.slice(sourceIdx + 1, focusIdx).find((line) => line.trim().length > 0) ?? "").trim();
  const focusBlock = lines.slice(focusIdx + 1).join("\n").trim();
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

function streamChildText(text, { traceLabel = "stage", channel = "stdout" } = {}) {
  if (!isVerbose()) return;
  const normalized = String(text ?? "").replace(/\r\n?/gu, "\n");
  if (!normalized) return;
  const prefix = `[learn pipeline][${traceLabel}][${channel}] `;
  const endsWithNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (endsWithNewline) lines.pop();
  for (const line of lines) {
    process.stderr.write(`${prefix}${line}\n`);
  }
}

function resolvePipelineArtifactRoot() {
  const runId = String(process.env.PYA_RUN_ID ?? "").trim();
  if (!runId) return "";
  return path.resolve(process.cwd(), "artifacts", runId, "learn-pipeline");
}

export function resolveRunProgramPath(cwd = process.cwd()) {
  return path.resolve(String(cwd ?? process.cwd()), "run");
}

async function runPyashExample(examplePath, args, envOverrides = {}, { traceDir = "", traceLabel = "stage" } = {}) {
  const runArgs = [examplePath, ...args];
  if (isVerbose()) {
    runArgs.push("--verbose", "--run-id", `learn-pipeline-${traceLabel}`);
  }
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
      if (code === 0) {
        resolve({ stdoutText: stdout, stderrText: stderr });
        return;
      }
      const err = new Error(`child run defective: status=${code ?? 0} signal=${signal ?? ""}`);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
  const combinedText = [stdoutText, stderrText].filter(Boolean).join("\n");
  let traceFilename = "";
  let resultText = extractFinalResult(stdoutText);
  if (isVerbose() && traceDir) {
    traceFilename = path.join(traceDir, `${traceLabel}.trace.txt`);
    await fsp.writeFile(traceFilename, combinedText, "utf8");
  }
  const produceFile = parseProduceFilePath(combinedText);
  if (produceFile) {
    const producedText = await fsp.readFile(produceFile, "utf8");
    resultText = producedText.trim();
  } else if (!resultText) {
    resultText = extractFinalResult(combinedText);
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
  runDirectFn = ({ sourceFilename: file, learningFocus: focus, envOverrides, traceDir, traceLabel }) => runPyashExample("examples/pyash/learn-direct-from-filename.pya", [file, focus], envOverrides, { traceDir, traceLabel }),
  runExtractFn = ({ sourceFilename: file, learningFocus: focus, envOverrides, traceDir, traceLabel }) => runPyashExample("examples/pyash/learn-extract-card-from-filename.pya", [file, focus], envOverrides, { traceDir, traceLabel }),
  runMergeRefineFn = ({ sourceFilename: source, cardsFilename: cards, learningFocus: focus, envOverrides, traceDir, traceLabel }) => runPyashExample("examples/pyash/learn-merge-refine-cards-from-filename.pya", [source, cards, focus], envOverrides, { traceDir, traceLabel })
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
    const direct = normalizeStageResult(await runDirectFn({
      sourceFilename,
      learningFocus,
      envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(4) ?? process.env.PYA_MIND_RESPONSE },
      traceDir: tempRoot,
      traceLabel: "direct"
    }));
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
    const card = normalizeStageResult(await runExtractFn({
      sourceFilename: chunkFilename,
      learningFocus,
      envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(1) ?? process.env.PYA_MIND_RESPONSE },
      traceDir: tempRoot,
      traceLabel: `chunk-${String(idx + 1).padStart(3, "0")}`
    }));
    if (card.traceFilename) logVerbose(`[learn pipeline] chunk ${idx + 1}/${chunks.length} trace: ${card.traceFilename}`);
    logVerbose(`[learn pipeline] chunk ${idx + 1}/${chunks.length} ok`);
    chunkCards.push(card.resultText);
  }

  const cardsText = chunkCards
    .map((card, idx) => `CHUNK CARD ${idx + 1}\n${card}`)
    .join("\n\n=====\n\n");
  const cardsFilename = path.join(tempRoot, "chunk-cards.txt");
  await writeFileFn(cardsFilename, cardsText);
  logVerbose("[learn pipeline] merge/refine starting");
  const finalCard = normalizeStageResult(await runMergeRefineFn({
    sourceFilename,
    cardsFilename,
    learningFocus,
    envOverrides: { PYA_MIND_RESPONSE: takeFixtureResponses(4) ?? process.env.PYA_MIND_RESPONSE },
    traceDir: tempRoot,
    traceLabel: "merge-refine"
  }));
  if (finalCard.traceFilename) logVerbose(`[learn pipeline] merge/refine trace: ${finalCard.traceFilename}`);
  logVerbose(`[learn pipeline] final card: ${summarizeCard(finalCard.resultText)}`);
  return finalCard.resultText;
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
